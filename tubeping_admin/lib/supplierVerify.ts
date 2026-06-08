// 공급사 정산 대조(검증) — 공급사가 보낸 거래명세서/엑셀을 튜핑 집계와 대조한다.
//
// 핵심 설계
// - 파싱과 대조 로직을 순수 함수로 분리해 단위 테스트 가능하게 한다 (API 라우트는 파일·DB만 연결).
// - 적응형 매칭: 파일에 주문상품고유번호/주문번호가 있으면 주문단위 정밀 대조,
//   없으면 상품·총액 단위 대조로 자연스럽게 강등(degrade)된다.
// - 금액 비교 기준은 "튜핑이 공급사 정산표에 표기하는 값"과 동일하게 둔다:
//   공급가 = supply_total(=공급단가×수량, 면세는 엔진이 이미 ×1.1 가산), 배송비 = supply_shipping.
//   → 튜핑이 공급사에 보낸 정산표를 공급사가 확인·회신하는 운영 흐름과 apples-to-apples.
import * as XLSX from "xlsx";

// ─── 입력 타입 ───

/** 튜핑이 집계한 출고 아이템 (computeItem 결과의 필요한 필드만) */
export interface TupingItem {
  cafe24_order_id: string;
  cafe24_order_item_code: string;
  product_name: string;
  quantity: number;
  supply_total: number; // 공급가 (공급단가 × 수량)
  supply_shipping: number; // 공급배송비 (박스당 × 수량)
  tax_type: string; // 과세 | 면세
}

/** 파일에서 추출한 공급사 자료 1행 (정규화 후) */
export interface SupplierRow {
  order_id: string; // 주문번호 (없으면 "")
  item_code: string; // 주문상품고유번호 (없으면 "")
  product_name: string;
  qty: number;
  supply: number; // 공급가(액). 단가만 있으면 단가×수량
  shipping: number; // 배송비
  amount: number; // 합계/정산금액 (없으면 supply+shipping)
}

// ─── 컬럼 별칭 (유연 매칭) ───
const ALIASES = {
  item_code: ["주문상품고유번호", "상품고유번호", "고유번호", "item_code", "옵션고유번호", "품목코드"],
  order_id: ["주문번호", "주문 번호", "order_no", "order_id", "주문no", "주문 no"],
  product: ["상품명", "품목명", "품목", "품명", "제품명", "상품", "내역", "품목내역", "item", "product"],
  recipient: ["수령인명", "수령인", "수취인", "받는분", "받는사람", "고객명", "주문자"],
  qty: ["수량", "qty", "수 량", "박스", "박스수", "박스개수", "출고수량", "주문수량", "갯수", "개수"],
  // 공급가(액) — 라인 합계 우선
  supply: ["공급가액", "공급가", "공급금액", "공급대금", "공급단가합", "납품가", "납품금액", "매입가", "매입금액"],
  unit: ["단가", "공급단가", "매입단가", "납품단가"],
  shipping: ["배송비", "택배비", "운임", "배송료", "출고비"],
  amount: ["정산금액", "합계금액", "합계", "총액", "총금액", "공급대가", "청구금액", "금액"],
  tax: ["세액", "부가세", "vat"],
};

function norm(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

/** 상품명 정규화 — 공백/괄호/특수문자 제거 후 비교용 키 */
export function normProduct(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .replace(/[\[\]()（）·,./_-]/g, "")
    .toLowerCase()
    .trim();
}

/** 주문번호 정규화 — 공백 제거, 끝의 "-0"류 단일 접미는 보존(고유번호 구분 위해 별도 처리) */
function normOrder(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, "").trim();
}

/** 숫자 파싱 — ₩, 콤마, 원, 괄호(음수) 등 제거 */
export function parseNum(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-") || s.startsWith("△") || s.startsWith("▲");
  s = s.replace(/[₩,원\s()△▲]/g, "").replace(/-/g, "");
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}

// ─── 파싱 ───

export interface ParseResult {
  ok: boolean;
  error?: string;
  sheetName?: string;
  headerRow?: number; // 0-based 행 인덱스
  columns?: Record<string, number>; // 논리컬럼 → 열 인덱스
  rows: SupplierRow[];
  totalDataRows?: number; // 헤더 이후 전체 행 수 (스킵 포함)
  skippedRows?: number; // 상품명/수량 없어 스킵된 행 수
}

/** 헤더 행 후보 점수: 알려진 별칭과 매칭되는 셀 개수 */
function scoreHeaderRow(cells: unknown[]): { score: number; cols: Record<string, number> } {
  const cols: Record<string, number> = {};
  let score = 0;
  const tryAssign = (key: keyof typeof ALIASES, idx: number, cell: string) => {
    if (cols[key] !== undefined) return false;
    if (ALIASES[key].some((a) => cell.includes(norm(a)))) {
      cols[key] = idx;
      return true;
    }
    return false;
  };
  for (let i = 0; i < cells.length; i++) {
    const cell = norm(cells[i]);
    if (!cell) continue;
    // 더 구체적인 컬럼을 먼저 시도 (고유번호 > 주문번호, 공급가 > 단가, 정산금액/합계 > 금액)
    if (
      tryAssign("item_code", i, cell) ||
      tryAssign("order_id", i, cell) ||
      tryAssign("product", i, cell) ||
      tryAssign("qty", i, cell) ||
      tryAssign("supply", i, cell) ||
      tryAssign("unit", i, cell) ||
      tryAssign("shipping", i, cell) ||
      tryAssign("amount", i, cell) ||
      tryAssign("recipient", i, cell) ||
      tryAssign("tax", i, cell)
    ) {
      score++;
    }
  }
  // 핵심 컬럼 가중치: 상품명+수량이 있어야 의미 있는 헤더
  if (cols.product !== undefined) score += 2;
  if (cols.qty !== undefined) score += 1;
  return { score, cols };
}

/**
 * 엑셀/CSV 버퍼를 파싱해 SupplierRow[] 로 정규화한다.
 * 헤더 행을 자동 탐지(상위 20행 중 별칭 매칭 최다 행)한다.
 */
export function parseSupplierFile(buffer: ArrayBuffer | Buffer): ParseResult {
  let wb: XLSX.WorkBook;
  try {
    const buf: Buffer = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(new Uint8Array(buffer));
    wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  } catch (e) {
    return { ok: false, error: "파일을 읽을 수 없습니다 (xlsx/xls/csv 만 지원)", rows: [] };
  }
  if (!wb.SheetNames.length) return { ok: false, error: "시트가 없습니다", rows: [] };

  // 데이터가 가장 많은 시트 선택
  let best: { name: string; grid: unknown[][] } | null = null;
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: "",
    });
    if (!best || grid.length > best.grid.length) best = { name, grid };
  }
  if (!best || best.grid.length < 2) {
    return { ok: false, error: "데이터가 없습니다 (헤더 + 최소 1행 필요)", rows: [] };
  }

  // 헤더 행 탐지
  const scanLimit = Math.min(best.grid.length, 20);
  let headerRow = -1;
  let columns: Record<string, number> = {};
  let bestScore = 0;
  for (let r = 0; r < scanLimit; r++) {
    const { score, cols } = scoreHeaderRow(best.grid[r] as unknown[]);
    if (score > bestScore) {
      bestScore = score;
      headerRow = r;
      columns = cols;
    }
  }

  if (headerRow < 0 || columns.product === undefined) {
    return {
      ok: false,
      error:
        "상품명 컬럼을 찾을 수 없습니다. 헤더에 '상품명/품목' 과 '수량', '공급가' 컬럼이 포함돼야 합니다.",
      rows: [],
    };
  }

  const rows: SupplierRow[] = [];
  let skipped = 0;
  let totalData = 0;
  for (let r = headerRow + 1; r < best.grid.length; r++) {
    const cells = best.grid[r] as unknown[];
    const get = (key: string) =>
      columns[key] !== undefined ? cells[columns[key]] : undefined;

    const product = String(get("product") ?? "").trim();
    const orderId = normOrder(get("order_id"));
    const itemCode = normOrder(get("item_code"));
    const qty = parseNum(get("qty"));

    // 합계/소계 행 스킵 (상품명 없음 또는 "합계/소계/총계" 텍스트)
    const looksTotal = /합계|소계|총계|total|합 계/i.test(product);
    if ((!product && !orderId && !itemCode) || looksTotal) {
      continue;
    }
    totalData++;
    if (!product) {
      skipped++;
      continue;
    }

    // 공급가: supply 컬럼 우선, 없으면 단가×수량
    let supply = parseNum(get("supply"));
    if (columns.supply === undefined && columns.unit !== undefined) {
      supply = parseNum(get("unit")) * (qty || 1);
    }
    const shipping = parseNum(get("shipping"));
    let amount = parseNum(get("amount"));
    if (columns.amount === undefined) amount = supply + shipping;

    rows.push({
      order_id: orderId,
      item_code: itemCode,
      product_name: product,
      qty: qty || 0,
      supply,
      shipping,
      amount,
    });
  }

  return {
    ok: true,
    sheetName: best.name,
    headerRow,
    columns,
    rows,
    totalDataRows: totalData,
    skippedRows: skipped,
  };
}

// ─── 대조 ───

const TOL = 1; // 금액 허용 오차 (반올림 ₩1)

export interface DiffCell {
  tuping: number;
  supplier: number;
  diff: number; // supplier - tuping
}
export type MatchStatus = "match" | "qty" | "amount" | "onlyTuping" | "onlySupplier";

export interface KeyCompare {
  key: string;
  label: string; // 표시용 (주문번호/상품명)
  product_name: string;
  qty: DiffCell;
  supply: DiffCell;
  shipping: DiffCell;
  status: MatchStatus;
}

export interface VerifyResult {
  mode: "item_code" | "order_id" | "product"; // 매칭 기준
  modeLabel: string;
  summary: {
    tuping: { count: number; qty: number; supply: number; shipping: number; amount: number };
    supplier: { count: number; qty: number; supply: number; shipping: number; amount: number };
    diff: { qty: number; supply: number; shipping: number; amount: number };
    status: "match" | "mismatch";
  };
  products: KeyCompare[]; // 상품별 대조 (항상)
  details: KeyCompare[]; // 주문단위 대조 (mode가 item_code/order_id 일 때)
  counts: { match: number; mismatch: number; onlyTuping: number; onlySupplier: number };
}

interface Agg {
  key: string;
  label: string;
  product_name: string;
  qty: number;
  supply: number;
  shipping: number;
}

function emptyAgg(key: string, label: string, product = ""): Agg {
  return { key, label, product_name: product, qty: 0, supply: 0, shipping: 0 };
}

function aggregate<T>(
  items: T[],
  keyFn: (t: T) => string,
  labelFn: (t: T) => string,
  productFn: (t: T) => string,
  qtyFn: (t: T) => number,
  supplyFn: (t: T) => number,
  shippingFn: (t: T) => number
): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const it of items) {
    const key = keyFn(it);
    if (!key) continue;
    let a = m.get(key);
    if (!a) {
      a = emptyAgg(key, labelFn(it), productFn(it));
      m.set(key, a);
    }
    a.qty += qtyFn(it) || 0;
    a.supply += supplyFn(it) || 0;
    a.shipping += shippingFn(it) || 0;
  }
  return m;
}

function classify(t: Agg | undefined, s: Agg | undefined): MatchStatus {
  if (t && !s) return "onlyTuping";
  if (!t && s) return "onlySupplier";
  if (!t || !s) return "onlySupplier";
  if (t.qty !== s.qty) return "qty";
  if (Math.abs(t.supply - s.supply) > TOL || Math.abs(t.shipping - s.shipping) > TOL)
    return "amount";
  return "match";
}

function joinCompare(tMap: Map<string, Agg>, sMap: Map<string, Agg>): KeyCompare[] {
  const keys = new Set([...tMap.keys(), ...sMap.keys()]);
  const out: KeyCompare[] = [];
  for (const k of keys) {
    const t = tMap.get(k);
    const s = sMap.get(k);
    out.push({
      key: k,
      label: t?.label || s?.label || k,
      product_name: t?.product_name || s?.product_name || "",
      qty: { tuping: t?.qty || 0, supplier: s?.qty || 0, diff: (s?.qty || 0) - (t?.qty || 0) },
      supply: {
        tuping: t?.supply || 0,
        supplier: s?.supply || 0,
        diff: (s?.supply || 0) - (t?.supply || 0),
      },
      shipping: {
        tuping: t?.shipping || 0,
        supplier: s?.shipping || 0,
        diff: (s?.shipping || 0) - (t?.shipping || 0),
      },
      status: classify(t, s),
    });
  }
  // 불일치 우선 정렬: 한쪽만 > 수량 > 금액 > 일치, 그 안에서 금액차 큰 순
  const rank: Record<MatchStatus, number> = {
    onlySupplier: 0,
    onlyTuping: 1,
    qty: 2,
    amount: 3,
    match: 4,
  };
  out.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return Math.abs(b.supply.diff) - Math.abs(a.supply.diff);
  });
  return out;
}

/**
 * 튜핑 집계와 공급사 파일을 대조한다.
 * 매칭 기준은 파일 컬럼에 따라 자동 결정:
 *   주문상품고유번호 있음 → item_code, 주문번호 있음 → order_id, 둘 다 없음 → 상품명(product)
 */
export function verify(
  tupingItems: TupingItem[],
  supplierRows: SupplierRow[],
  fileColumns: Record<string, number>
): VerifyResult {
  const hasItemCode =
    fileColumns.item_code !== undefined && supplierRows.some((r) => r.item_code);
  const hasOrderId =
    !hasItemCode && fileColumns.order_id !== undefined && supplierRows.some((r) => r.order_id);

  const mode: VerifyResult["mode"] = hasItemCode
    ? "item_code"
    : hasOrderId
      ? "order_id"
      : "product";
  const modeLabel =
    mode === "item_code"
      ? "주문상품고유번호 단위 정밀 대조"
      : mode === "order_id"
        ? "주문번호 단위 대조"
        : "상품·총액 단위 대조";

  // 매칭 키 선택자
  const tKey =
    mode === "item_code"
      ? (t: TupingItem) => normOrder(t.cafe24_order_item_code)
      : mode === "order_id"
        ? (t: TupingItem) => normOrder(t.cafe24_order_id) + "|" + normProduct(t.product_name)
        : (t: TupingItem) => normProduct(t.product_name);
  const sKey =
    mode === "item_code"
      ? (s: SupplierRow) => s.item_code
      : mode === "order_id"
        ? (s: SupplierRow) => s.order_id + "|" + normProduct(s.product_name)
        : (s: SupplierRow) => normProduct(s.product_name);
  const tLabel =
    mode === "product"
      ? (t: TupingItem) => t.product_name
      : (t: TupingItem) => t.cafe24_order_id || t.cafe24_order_item_code;
  const sLabel =
    mode === "product"
      ? (s: SupplierRow) => s.product_name
      : (s: SupplierRow) => s.order_id || s.item_code;

  // 주문단위(상세) 집계
  const tDetail = aggregate(
    tupingItems,
    tKey,
    tLabel,
    (t) => t.product_name,
    (t) => t.quantity,
    (t) => t.supply_total,
    (t) => t.supply_shipping
  );
  const sDetail = aggregate(
    supplierRows,
    sKey,
    sLabel,
    (s) => s.product_name,
    (s) => s.qty,
    (s) => s.supply,
    (s) => s.shipping
  );
  const details = mode === "product" ? [] : joinCompare(tDetail, sDetail);

  // 상품별 집계 (항상)
  const tProd = aggregate(
    tupingItems,
    (t) => normProduct(t.product_name),
    (t) => t.product_name,
    (t) => t.product_name,
    (t) => t.quantity,
    (t) => t.supply_total,
    (t) => t.supply_shipping
  );
  const sProd = aggregate(
    supplierRows,
    (s) => normProduct(s.product_name),
    (s) => s.product_name,
    (s) => s.product_name,
    (s) => s.qty,
    (s) => s.supply,
    (s) => s.shipping
  );
  const products = joinCompare(tProd, sProd);

  // 총계 요약
  const sum = (arr: { qty: number; supply: number; shipping: number }[]) =>
    arr.reduce(
      (a, b) => ({
        qty: a.qty + b.qty,
        supply: a.supply + b.supply,
        shipping: a.shipping + b.shipping,
      }),
      { qty: 0, supply: 0, shipping: 0 }
    );
  const tSum = sum(
    tupingItems.map((t) => ({
      qty: t.quantity,
      supply: t.supply_total,
      shipping: t.supply_shipping,
    }))
  );
  const sSum = sum(
    supplierRows.map((s) => ({ qty: s.qty, supply: s.supply, shipping: s.shipping }))
  );
  const tAmount = tSum.supply + tSum.shipping;
  const sAmount = sSum.supply + sSum.shipping;

  const diffSummary = {
    qty: sSum.qty - tSum.qty,
    supply: sSum.supply - tSum.supply,
    shipping: sSum.shipping - tSum.shipping,
    amount: sAmount - tAmount,
  };

  // counts — 상세가 있으면 상세 기준, 없으면 상품 기준
  const basis = mode === "product" ? products : details;
  const counts = {
    match: basis.filter((c) => c.status === "match").length,
    mismatch: basis.filter((c) => c.status === "qty" || c.status === "amount").length,
    onlyTuping: basis.filter((c) => c.status === "onlyTuping").length,
    onlySupplier: basis.filter((c) => c.status === "onlySupplier").length,
  };

  const overall: "match" | "mismatch" =
    counts.mismatch === 0 &&
    counts.onlyTuping === 0 &&
    counts.onlySupplier === 0 &&
    Math.abs(diffSummary.amount) <= TOL &&
    diffSummary.qty === 0
      ? "match"
      : "mismatch";

  return {
    mode,
    modeLabel,
    summary: {
      tuping: {
        count: tupingItems.length,
        qty: tSum.qty,
        supply: tSum.supply,
        shipping: tSum.shipping,
        amount: tAmount,
      },
      supplier: {
        count: supplierRows.length,
        qty: sSum.qty,
        supply: sSum.supply,
        shipping: sSum.shipping,
        amount: sAmount,
      },
      diff: diffSummary,
      status: overall,
    },
    products,
    details,
    counts,
  };
}
