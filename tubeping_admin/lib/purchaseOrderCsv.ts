import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface POConfig { [key: string]: any }

export interface OrderRow {
  cafe24_order_id: string;
  cafe24_order_item_code: string;
  cafe24_product_no: number;
  tp_code?: string;
  product_name: string;
  option_text: string;
  quantity: number;
  order_date: string;
  buyer_name: string;
  buyer_phone: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  receiver_zipcode: string;
  memo: string;
  shipping_company: string;
  tracking_number: string;
}

// 판매사 키워드 제거 (공급사에게 노출되면 안 되는 판매처 이름)
const SELLER_KEYWORDS = ["뉴스엔진", "완선", "캡틴", "빵시기", "킬링타임", "shinsan", "comicmart", "뉴스반장"];
export function cleanProductName(name: string): string {
  let cleaned = name;
  for (const kw of SELLER_KEYWORDS) {
    cleaned = cleaned.replace(new RegExp(kw, "gi"), "");
  }
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

// Excel에서 CSV 열 때 숫자로 자동변환 방지 (앞자리 0 유지용)
// ="010..." 수식으로 감싸면 Excel이 텍스트로 표시
function csvTextForce(val: string): string {
  if (!val) return "";
  return `="${val.replace(/"/g, '""')}"`;
}

// 텍스트 강제가 필요한 필드명 (연락처/우편번호/송장번호 등 앞자리 0이 있을 수 있는 숫자형 문자열)
const TEXT_FORCE_FIELDS = new Set([
  "receiver_phone", "buyer_phone", "receiver_zipcode", "tracking_number",
]);

export function generateOrderCsv(orders: OrderRow[], poConfig?: POConfig | null): string {
  const BOM = "\uFEFF";
  const hideSeller = poConfig?.hide_seller ?? true;

  // 커스텀 양식
  if (poConfig?.columns && poConfig?.column_map) {
    const columns: string[] = poConfig.columns;
    const columnMap: Record<string, string> = poConfig.column_map;

    const header = columns.map(csvEscape).join(",");
    const rows = orders.map((o) => {
      const productName = hideSeller ? cleanProductName(o.product_name || "") : (o.product_name || "");
      const fieldMap: Record<string, string> = {
        cafe24_order_id: o.cafe24_order_id || "",
        cafe24_order_item_code: o.cafe24_order_item_code || "",
        cafe24_product_no: String(o.cafe24_product_no || ""),
        tp_code: o.tp_code || "",
        product_name: productName,
        option_text: o.option_text || "",
        quantity: String(o.quantity || 1),
        order_date: o.order_date?.slice(0, 10) || "",
        buyer_name: o.buyer_name || "",
        buyer_phone: o.buyer_phone || "",
        receiver_name: o.receiver_name || "",
        receiver_phone: o.receiver_phone || "",
        receiver_address: o.receiver_address || "",
        receiver_zipcode: o.receiver_zipcode || "",
        memo: o.memo || "",
        shipping_company: o.shipping_company || "",
        tracking_number: o.tracking_number || "",
      };

      const values = columns.map((col) => {
        const mapping = columnMap[col] || "";
        if (mapping.startsWith("_fixed:")) return csvEscape(mapping.slice(7));
        if (mapping === "_today") return new Date().toISOString().slice(0, 10);
        const val = fieldMap[mapping] || "";
        return TEXT_FORCE_FIELDS.has(mapping) ? csvTextForce(val) : csvEscape(val);
      });
      return values.join(",");
    });

    return BOM + header + "\n" + rows.join("\n");
  }

  // 기본 양식 (po_config 없는 공급사)
  const baseColumns = [
    "주문번호", "주문상품고유번호", "상품코드", "상품명", "옵션", "수량",
    "수령자", "연락처", "배송지", "우편번호", "배송메시지", "택배사", "배송번호",
  ];
  const header = baseColumns.join(",");

  const rows = orders.map((o) => {
    const productName = hideSeller ? cleanProductName(o.product_name || "") : (o.product_name || "");
    return [
      o.cafe24_order_id || "",
      o.cafe24_order_item_code || "",
      o.tp_code || String(o.cafe24_product_no || ""),
      csvEscape(productName),
      csvEscape(o.option_text || ""),
      String(o.quantity || 1),
      o.receiver_name || "",
      csvTextForce(o.receiver_phone || ""),
      csvEscape(o.receiver_address || ""),
      csvTextForce(o.receiver_zipcode || ""),
      csvEscape(o.memo || ""),
      o.shipping_company || "",
      csvTextForce(o.tracking_number || ""),
    ].join(",");
  });

  return BOM + header + "\n" + rows.join("\n");
}

/**
 * 주문 목록에 tp_code를 채워넣는다.
 * (store_id, cafe24_product_no) → product_cafe24_mappings → products.tp_code 경로로 조회.
 * cafe24_product_no는 스토어 간 중복되므로 store_id로 반드시 disambiguate 필요.
 */
export async function enrichWithTpCode<T extends { store_id?: string | null; cafe24_product_no: number; tp_code?: string }>(
  sb: SupabaseClient,
  orders: T[]
): Promise<T[]> {
  const productNos = [...new Set(orders.map((o) => o.cafe24_product_no).filter((n) => n > 0))];
  if (productNos.length === 0) return orders;

  const { data: mappings } = await sb
    .from("product_cafe24_mappings")
    .select("store_id, cafe24_product_no, product_id")
    .in("cafe24_product_no", productNos);

  const storeProductKey = (storeId: string, no: number) => `${storeId}::${no}`;
  const keyToProductId: Record<string, string> = {};
  for (const m of mappings || []) {
    keyToProductId[storeProductKey(m.store_id, m.cafe24_product_no)] = m.product_id;
  }

  const productIds = [...new Set(Object.values(keyToProductId))];
  const productIdToTpCode: Record<string, string> = {};
  if (productIds.length > 0) {
    const { data: products } = await sb
      .from("products")
      .select("id, tp_code")
      .in("id", productIds);
    for (const p of products || []) {
      if (p.tp_code) productIdToTpCode[p.id] = p.tp_code;
    }
  }

  return orders.map((o) => {
    if (!o.store_id) return o;
    const pid = keyToProductId[storeProductKey(o.store_id, o.cafe24_product_no)];
    const tp = pid ? productIdToTpCode[pid] : undefined;
    return tp ? { ...o, tp_code: tp } : o;
  });
}

