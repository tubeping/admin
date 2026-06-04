/**
 * 신산애널리틱스 재무제표 표준 항목 + 자동분류 룰.
 *
 * 사용자(최준)가 1,112건 수동 분류한 패턴(엑셀 입출금 내역_계산.xlsx 의 '수정' 시트)을
 * 그대로 표준 chart of accounts 로 굳히고, 빈도 높은 키워드로 자동 분류한다.
 *
 * - ACCOUNTS: 트리(depth 로 들여쓰기). 최상위 7개 그룹: 매출/매출원가/판매비/일반관리비/세금/이음로직스/영업외 + 미분류
 * - RULES: keyword → account code. 위에서 아래로 첫 match 적용. 'for' 가 'in'/'out'/'both'
 * - classify(row, side): 분류 시도, 매칭 없으면 sales.misc(입금) 또는 unclassified(출금)
 *
 * DB 저장: fin_bank_in/out/card_tx 의 기존 `category` 컬럼에 account code 를 저장한다.
 * 자동 분류는 statement API 가 응답 시 계산하고, 사용자가 UI 에서 수동 수정하면
 * /api/finance/classify 가 category 컬럼을 update 한다.
 */

export type AccountSide = "in" | "out" | "both";

export interface Account {
  code: string;
  label: string;
  side: AccountSide;
  depth: 0 | 1 | 2;
}

export const ACCOUNTS: Account[] = [
  // ─── 매출 ───
  { code: "sales", label: "매출", side: "in", depth: 0 },
  { code: "sales.pg", label: "자사몰 PG", side: "in", depth: 1 },
  { code: "sales.pg.cafe24", label: "카페24", side: "in", depth: 2 },
  { code: "sales.pg.toss", label: "토스페이먼츠", side: "in", depth: 2 },
  { code: "sales.pg.coupang", label: "쿠팡페이", side: "in", depth: 2 },
  { code: "sales.pg.naver", label: "네이버페이", side: "in", depth: 2 },
  { code: "sales.offline", label: "오프라인 매출", side: "in", depth: 1 },
  { code: "sales.offline.acts", label: "액츠", side: "in", depth: 2 },
  { code: "sales.offline.other", label: "기타 오프라인 거래처", side: "in", depth: 2 },
  { code: "sales.channel", label: "채널/인플루언서", side: "in", depth: 1 },
  { code: "sales.misc", label: "기타 입금(미분류)", side: "in", depth: 1 },

  // ─── 매출원가 ───
  { code: "cogs", label: "매출원가", side: "out", depth: 0 },
  { code: "cogs.supplier", label: "공급사 정산", side: "out", depth: 1 },
  { code: "cogs.purchase", label: "직사입", side: "out", depth: 1 },

  // ─── 판매비 ───
  { code: "selling", label: "판매비", side: "out", depth: 0 },
  { code: "selling.ad", label: "광고/마케팅", side: "out", depth: 1 },
  { code: "selling.pg_fee", label: "PG 수수료 (정산내장)", side: "out", depth: 1 },
  { code: "selling.tpl", label: "3PL 물류 (정산내장)", side: "out", depth: 1 },
  { code: "selling.influencer", label: "유튜브/인플루언서 정산", side: "out", depth: 1 },

  // ─── 일반관리비 ───
  { code: "ga", label: "일반관리비", side: "out", depth: 0 },
  { code: "ga.salary", label: "급여", side: "out", depth: 1 },
  { code: "ga.insurance4", label: "4대보험", side: "out", depth: 1 },
  { code: "ga.parttime", label: "알바/외주", side: "out", depth: 1 },
  { code: "ga.rent", label: "임차료", side: "out", depth: 1 },
  { code: "ga.maintenance", label: "관리비", side: "out", depth: 1 },
  { code: "ga.telecom", label: "통신료", side: "out", depth: 1 },
  { code: "ga.taxservice", label: "세무대리인", side: "out", depth: 1 },
  { code: "ga.card", label: "법인카드 결제 (세부 미분류)", side: "out", depth: 1 },
  { code: "ga.misc", label: "기타 운영비", side: "out", depth: 1 },

  // ─── 세금 ───
  { code: "tax", label: "세금/공과", side: "out", depth: 0 },
  { code: "tax.gov", label: "국세/지방세", side: "out", depth: 1 },
  { code: "tax.vat", label: "부가세", side: "out", depth: 1 },

  // ─── 이음로직스 (별도 트랙) ───
  { code: "eumlogics", label: "이음로직스 (위탁운영)", side: "both", depth: 0 },

  // ─── 영업외 ───
  { code: "nonop", label: "영업외", side: "both", depth: 0 },
  { code: "nonop.interest", label: "이자", side: "both", depth: 1 },
  { code: "nonop.refund", label: "환불/취소", side: "both", depth: 1 },

  // ─── 미분류 ───
  { code: "unclassified", label: "미분류 (수동 분류 필요)", side: "both", depth: 0 },
];

export const ACCOUNT_BY_CODE: Record<string, Account> = Object.fromEntries(ACCOUNTS.map((a) => [a.code, a]));

export function isValidAccountCode(code: string): boolean {
  return code in ACCOUNT_BY_CODE;
}

/** depth 1·2 코드 입력 시 depth 0 (최상위 그룹) 반환 */
export function rootOf(code: string): string {
  return code.split(".")[0];
}

// ─────────────────────────────────────────────────────
// 자동분류 룰 (순서대로 첫 match 적용)
// ─────────────────────────────────────────────────────

export interface Rule {
  /** 매칭 키워드 — 거래처(partner) + 적요(descr) + 메모(memo)를 한 문자열로 합쳐 includes 검사 (대소문자 무시) */
  kw: string[];
  code: string;
  /** 적용 거래 방향. 'both' 면 입/출금 모두 */
  for: AccountSide;
}

export const RULES: Rule[] = [
  // ─── 매출 (입금) ───
  { kw: ["카페24페이먼", "카페24"], code: "sales.pg.cafe24", for: "in" },
  { kw: ["tosspaymen", "tosspay", "토스페이"], code: "sales.pg.toss", for: "in" },
  { kw: ["쿠팡페이"], code: "sales.pg.coupang", for: "in" },
  { kw: ["npay정산", "네이버페이"], code: "sales.pg.naver", for: "in" },
  { kw: ["액츠_물품대", "액츠"], code: "sales.offline.acts", for: "in" },
  { kw: ["엄정호(제이드"], code: "sales.offline.other", for: "in" },
  // 채널/인플루언서 (등록된 store명)
  { kw: ["뉴스엔진"], code: "sales.channel", for: "in" },
  { kw: ["뉴스반장"], code: "sales.channel", for: "in" },
  { kw: ["신사임당"], code: "sales.channel", for: "in" },
  { kw: ["떠먹"], code: "sales.channel", for: "in" },
  { kw: ["당뇨딸"], code: "sales.channel", for: "in" },
  { kw: ["완선"], code: "sales.channel", for: "in" },
  { kw: ["빵시기"], code: "sales.channel", for: "in" },
  { kw: ["킬링타임"], code: "sales.channel", for: "in" },
  { kw: ["캡틴"], code: "sales.channel", for: "in" },
  { kw: ["comicmart"], code: "sales.channel", for: "in" },

  // ─── 매출원가 (출금) ───
  { kw: ["뉴퍼마켓", "전시몰닷컴", "선우프레시", "사입", "가구매"], code: "cogs.purchase", for: "out" },

  // ─── 판매비 (출금) ───
  { kw: ["가로세로연", "가세연"], code: "selling.ad", for: "out" },
  { kw: ["아튜브"], code: "selling.ad", for: "out" },
  { kw: ["카카오"], code: "selling.ad", for: "out" },

  // ─── 일반관리비 (출금) ───
  { kw: ["bz급여", "급여_", "급여 "], code: "ga.salary", for: "out" },
  { kw: ["국민건강", "국민연금", "의보", "연금", "4대보험"], code: "ga.insurance4", for: "out" },
  { kw: ["알바", "스님"], code: "ga.parttime", for: "out" },
  { kw: ["임차료"], code: "ga.rent", for: "out" },
  { kw: ["관리비", "vip텔관리", "풍림"], code: "ga.maintenance", for: "out" },
  { kw: ["kt통신", "통신료", "skt", "lgu", "kt요금"], code: "ga.telecom", for: "out" },
  { kw: ["세무회계", "세무법인", "세무대리"], code: "ga.taxservice", for: "out" },
  { kw: ["신한카드", "국민카드", "하나카드", "삼성카드", "현대카드", "bc카드", "롯데카드", "우리카드", "농협카드"], code: "ga.card", for: "out" },

  // ─── 세금 ───
  { kw: ["서울시지방세", "지방세", "국세납부", "bz공과", "취득세", "재산세"], code: "tax.gov", for: "out" },
  { kw: ["부가세", "부가가치세"], code: "tax.vat", for: "out" },

  // ─── 이음로직스 ───
  { kw: ["이음로직스", "(주)이음로직스", "주식회사 이음로직스"], code: "eumlogics", for: "both" },

  // ─── 영업외 ───
  { kw: ["이자"], code: "nonop.interest", for: "both" },
  { kw: ["환불", "취소"], code: "nonop.refund", for: "both" },
];

export interface Classifiable {
  partner?: string | null;
  descr?: string | null;
  memo?: string | null;
  category?: string | null;
}

/** 우리 admin DB 에 이미 등록된 이름들을 동적 매칭에 활용 (정적 RULES 보다 뒤 순위) */
export interface ClassifyContext {
  /** suppliers.name 목록 — 출금 매칭 시 cogs.supplier 로 분류 */
  supplierNames?: string[];
  /** stores.name 목록 — 입금 매칭 시 sales.channel 로 분류 */
  storeNames?: string[];
  /** stores.bank_holder 목록 — 출금 매칭 시 selling.influencer (인플루언서 정산 지급) */
  storeBankHolders?: string[];
  /** fin_purchases.partner 목록 — 출금 매칭 시 cogs.purchase (세금계산서 발행된 매입처) */
  fpPartners?: string[];
  /** fin_sales.partner 목록 — 입금 매칭 시 sales.channel (세금계산서 발행한 거래처) */
  fsPartners?: string[];
}

export interface ClassifyResult {
  code: string;
  /** true = 자동(룰/동적), false = 사용자가 DB 에 직접 지정 */
  auto: boolean;
  /** 어떤 경로로 분류됐는지 (user/rule:키워드/공급사:X/판매사:X/인플루언서:X/세계매입:X/세계매출:X/fallback) */
  via: string;
}

function normalizeForMatch(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\s/g, "").replace(/\(주\)|㈜|주식회사/g, "").toLowerCase();
}

/**
 * 자동분류 (context 가 있으면 DB 동적 매칭까지 시도).
 * 우선순위:
 *   1) row.category 가 유효한 account code → 사용자가 직접 지정한 것 우선 (auto=false)
 *   2) 정적 RULES (keyword)
 *   3) 동적: 출금이면 suppliers → bank_holder → fin_purchases, 입금이면 stores → fin_sales
 *   4) fallback: 입금=sales.misc, 출금=unclassified
 *
 * 길이 < 2 토큰은 노이즈 방지를 위해 매칭 skip.
 */
export function classify(row: Classifiable, side: "in" | "out", ctx: ClassifyContext = {}): ClassifyResult {
  if (row.category && isValidAccountCode(row.category)) {
    return { code: row.category, auto: false, via: "user" };
  }
  const haystack = normalizeForMatch(`${row.partner || ""} ${row.descr || ""} ${row.memo || ""}`);

  // 1) 정적 RULES
  for (const rule of RULES) {
    if (rule.for !== "both" && rule.for !== side) continue;
    for (const k of rule.kw) {
      const nk = normalizeForMatch(k);
      if (nk.length >= 2 && haystack.includes(nk)) return { code: rule.code, auto: true, via: `rule:${k}` };
    }
  }

  // 2) 동적: 출금 — 공급사 이름 → cogs.supplier
  if (side === "out" && ctx.supplierNames) {
    for (const name of ctx.supplierNames) {
      const tok = normalizeForMatch(name);
      if (tok.length >= 2 && haystack.includes(tok)) return { code: "cogs.supplier", auto: true, via: `공급사:${name}` };
    }
  }

  // 3) 동적: 입금 — 판매사(스토어) 이름 → sales.channel
  if (side === "in" && ctx.storeNames) {
    for (const name of ctx.storeNames) {
      const tok = normalizeForMatch(name);
      if (tok.length >= 2 && haystack.includes(tok)) return { code: "sales.channel", auto: true, via: `판매사:${name}` };
    }
  }

  // 4) 동적: 출금 — 판매사 bank_holder (인플루언서 정산 지급) → selling.influencer
  if (side === "out" && ctx.storeBankHolders) {
    for (const name of ctx.storeBankHolders) {
      const tok = normalizeForMatch(name);
      if (tok.length >= 2 && haystack.includes(tok)) return { code: "selling.influencer", auto: true, via: `인플루언서:${name}` };
    }
  }

  // 5) 동적: 출금 — fin_purchases partner (세금계산서 발행받은 매입처) → cogs.purchase
  if (side === "out" && ctx.fpPartners) {
    for (const name of ctx.fpPartners) {
      const tok = normalizeForMatch(name);
      if (tok.length >= 2 && haystack.includes(tok)) return { code: "cogs.purchase", auto: true, via: `세계매입:${name}` };
    }
  }

  // 6) 동적: 입금 — fin_sales partner (세금계산서 발행한 매출처) → sales.channel
  if (side === "in" && ctx.fsPartners) {
    for (const name of ctx.fsPartners) {
      const tok = normalizeForMatch(name);
      if (tok.length >= 2 && haystack.includes(tok)) return { code: "sales.channel", auto: true, via: `세계매출:${name}` };
    }
  }

  return { code: side === "in" ? "sales.misc" : "unclassified", auto: true, via: "fallback" };
}

/** UI 드롭다운 옵션용 — depth 0 (그룹 헤더) 제외, depth 1·2 만, 보기 좋게 들여쓰기 */
export const CLASSIFY_OPTIONS = ACCOUNTS
  .filter((a) => a.depth >= 1 || a.code === "unclassified" || a.code === "eumlogics")
  .map((a) => ({
    value: a.code,
    label: (a.depth === 2 ? "    " : a.depth === 1 ? "  " : "") + a.label,
    side: a.side,
  }));
