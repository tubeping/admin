import ExcelJS from "exceljs";
import type { OrderRow, POConfig } from "./purchaseOrderCsv";

/**
 * 공급사별 엑셀(.xlsx) 발주서 생성.
 *
 * 크리스탈리(젤리백)처럼 "카카오톡으로 엑셀 발주서를 보내달라"는 공급사를 위한 모듈.
 * 공급사 고유 양식(컬럼 순서 + 옵션 문자열 포맷)을 supplier.po_config 로 구동한다.
 *
 *   po_config = {
 *     format: "xlsx",
 *     template: "crystalli_supply",   // 양식 식별자 (현재 1종)
 *     delivery: "kakao",              // 발주 전달방식 (이메일 대신 카톡)
 *     hide_seller: true,
 *     catalog: { option_format, products[] }  // 옵션 문자열 매핑 카탈로그 (없으면 기본값)
 *   }
 *
 * 카탈로그를 코드에 박지 않고 po_config 에서 읽으므로, 공급사 색상/사이즈가 늘어도
 * 재배포 없이 DB 수정만으로 대응할 수 있다.
 */

// ── 크리스탈리 "Supply" 시트 헤더 (업로드된 공식 양식과 1:1 동일, 공백/** 포함) ──
export const CRYSTALLI_HEADER: string[] = [
  "주문일자", "고객명", "수령인연락처", "우편번호", "주소", "배송메세지", "품명 ", "옵션", "수량",
  "택배사**", "배송번호", "(공백)", "공급가", "배송비", "토탈",
  "카페24 주문번호", "카페24 품목별주문번호", "입금일자", "주문자명", "주문자연락처", "결제금액",
  "배송비2", "추가배송비", "배송비합계", "배송비타입", "주문번호", "상품코드", "주문상품고유번호", "카페24 품목코드",
];

export interface CatalogProduct {
  label: string;        // 옵션 문자열에 들어갈 상품명 (예: "01 젤리백 35")
  type_keywords: string[]; // 주문 상품명/옵션에서 이 상품을 식별할 키워드
  size: string;         // 사이즈 값 (예: "35")
  colors: string[];     // 이 상품의 유효 색상 목록
}

export interface OptionCatalog {
  option_format: string; // 예: "상품명={label}, 색상={color}, 사이즈={size}"
  products: CatalogProduct[];
}

// po_config.catalog 가 없을 때 쓰는 기본 카탈로그 (업로드 양식 H열 기준)
export const DEFAULT_CRYSTALLI_CATALOG: OptionCatalog = {
  option_format: "상품명={label}, 색상={color}, 사이즈={size}",
  products: [
    {
      label: "01 젤리백 35", type_keywords: ["젤리백"], size: "35",
      colors: ["그린", "네온", "레드", "민트", "베이비핑크", "블랙", "스카이블루", "오렌지", "화이트"],
    },
    {
      label: "02 젤리백 40", type_keywords: ["젤리백"], size: "40",
      colors: ["블랙", "옐로우", "퍼플", "핑크", "화이트"],
    },
    {
      label: "03 드래곤백", type_keywords: ["드래곤백", "드래곤"], size: "32",
      colors: ["그린", "다크브라운", "블랙", "블루", "초콜릿", "크림"],
    },
  ],
};

export interface ResolvedOption {
  label: string;     // 매칭된 상품명 (품명 열)
  option: string;    // 완성된 옵션 문자열 (옵션 열)
  matched: boolean;  // 카탈로그로 정확히 해석됐는지
  reason?: string;   // 미매칭 사유
}

/**
 * 주문 1건을 카탈로그에 비춰 크리스탈리 옵션 문자열로 변환.
 * - 상품 식별: type_keywords + 사이즈(35/40/32)로 디스앰비규에이션
 * - 색상 추출: 해당 상품의 색상 목록에서 긴 것부터 매칭 (베이비핑크 ⊃ 핑크 충돌 방지)
 * - 미매칭이면 matched=false 로 표시 → 호출측이 셀을 빨갛게 강조
 */
export function resolveCrystalliOption(
  productName: string,
  optionText: string,
  catalog: OptionCatalog
): ResolvedOption {
  const text = `${productName || ""} ${optionText || ""}`;

  // 1) 키워드로 후보 상품 추리기
  const candidates = catalog.products.filter((p) =>
    p.type_keywords.some((k) => text.includes(k))
  );
  if (candidates.length === 0) {
    return { label: "", option: "", matched: false, reason: "상품 키워드 미매칭" };
  }

  // 2) 사이즈로 상품 확정 (후보 여럿이면 사이즈가 텍스트에 있는 것)
  let product: CatalogProduct | undefined;
  if (candidates.length === 1) {
    product = candidates[0];
  } else {
    product = candidates.find((p) => text.includes(p.size));
  }
  if (!product) {
    return { label: "", option: "", matched: false, reason: "사이즈 구분 불가" };
  }

  // 3) 색상 추출 (긴 것 우선)
  const color = [...product.colors]
    .sort((a, b) => b.length - a.length)
    .find((c) => text.includes(c));
  if (!color) {
    return { label: product.label, option: "", matched: false, reason: "색상 미매칭" };
  }

  const option = catalog.option_format
    .replace("{label}", product.label)
    .replace("{color}", color)
    .replace("{size}", product.size);

  return { label: product.label, option, matched: true };
}

const RED_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFCE8E6" }, // 연한 빨강 (미매칭 강조)
};

// 앞자리 0 보존이 필요한 텍스트형 숫자 컬럼 인덱스 (0-base, CRYSTALLI_HEADER 기준)
// C 수령인연락처(2), D 우편번호(3), T 주문자연락처(19)
const TEXT_COL_INDICES = new Set([2, 3, 19]);

/**
 * 크리스탈리 발주서 .xlsx 버퍼 생성.
 * @returns { buffer, unmatched } unmatched = 옵션 해석 실패 건수
 */
export async function generateCrystalliXlsx(
  orders: OrderRow[],
  poConfig?: POConfig | null
): Promise<{ buffer: ArrayBuffer; unmatched: number }> {
  const catalog: OptionCatalog = poConfig?.catalog || DEFAULT_CRYSTALLI_CATALOG;

  const wb = new ExcelJS.Workbook();
  wb.creator = "TubePing";
  const ws = wb.addWorksheet("Supply");

  // 헤더
  const headerRow = ws.addRow(CRYSTALLI_HEADER);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  let unmatched = 0;

  for (const o of orders) {
    const resolved = resolveCrystalliOption(o.product_name || "", o.option_text || "", catalog);
    if (!resolved.matched) unmatched++;

    const qty = o.quantity || 1;
    const supply = o.supply_price || 0;
    const shipping = o.supply_shipping_fee || 0;

    // 옵션 셀: 미매칭이면 원본 옵션을 ⚠️ 표시로 남겨 사용자가 직접 수정
    const optionCell = resolved.matched
      ? resolved.option
      : `⚠️확인필요: ${o.option_text || o.product_name || ""}`;

    const values: (string | number)[] = [
      o.order_date?.slice(0, 10) || "", // A 주문일자
      o.receiver_name || "",            // B 고객명(수령인)
      o.receiver_phone || "",           // C 수령인연락처
      o.receiver_zipcode || "",         // D 우편번호
      o.receiver_address || "",         // E 주소
      o.memo || "",                     // F 배송메세지
      resolved.label,                   // G 품명
      optionCell,                       // H 옵션
      qty,                              // I 수량
      "",                               // J 택배사** (공급사 회신)
      "",                               // K 배송번호 (공급사 회신)
      "",                               // L (공백)
      supply,                           // M 공급가
      shipping,                         // N 배송비
      supply * qty + shipping,          // O 토탈
      o.cafe24_order_id || "",          // P 카페24 주문번호
      o.cafe24_order_item_code || "",   // Q 카페24 품목별주문번호
      "",                               // R 입금일자
      o.buyer_name || "",               // S 주문자명
      o.buyer_phone || "",              // T 주문자연락처
      "",                               // U 결제금액 (마진 노출 방지 — 비움)
      "",                               // V 배송비2
      "",                               // W 추가배송비
      "",                               // X 배송비합계
      "",                               // Y 배송비타입
      o.cafe24_order_id || "",          // Z 주문번호
      o.tp_code || String(o.cafe24_product_no || ""), // AA 상품코드
      o.cafe24_order_item_code || "",   // AB 주문상품고유번호
      String(o.cafe24_product_no || ""), // AC 카페24 품목코드
    ];

    const row = ws.addRow(values);

    // 텍스트형 숫자 컬럼: 앞자리 0 보존
    row.eachCell((cell, colNumber) => {
      if (TEXT_COL_INDICES.has(colNumber - 1)) cell.numFmt = "@";
    });

    // 미매칭 강조: 품명+옵션 셀 빨강
    if (!resolved.matched) {
      row.getCell(7).fill = RED_FILL;  // 품명
      row.getCell(8).fill = RED_FILL;  // 옵션
    }
  }

  // 컬럼 폭 (가독성)
  const widths = [12, 10, 15, 9, 40, 18, 14, 34, 6, 10, 14, 6, 9, 8, 9, 16, 20, 11, 10, 15, 10, 8, 9, 9, 9, 16, 12, 20, 14];
  ws.columns.forEach((col, i) => { col.width = widths[i] || 12; });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, unmatched };
}
