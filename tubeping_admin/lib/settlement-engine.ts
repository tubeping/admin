import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 정산 공용 엔진
 * ------------------------------------------------------------------
 * 판매사 정산(settlements/calculate)·공급사 정산(supplier-settlements)·
 * 공급사 요약(settlements/supplier-summary)이 **동일한 주문(orders) 데이터**를
 * 기준으로 같은 공급가/매출 계산을 쓰도록 추출한 단일 소스.
 *
 * - 두 정산은 서로 독립적으로 orders 를 직접 집계한다.
 *   (공급사 정산이 판매사 정산 결과 settlement_items 에 종속되지 않는다)
 * - 공급가 산정·면세 VAT·샘플/취소/증정 특수처리는 여기 한 곳에만 둔다.
 */

type OrderRow = Record<string, any>;

export interface SupplyContext {
  optMap: Record<string, { supply_price: number; retail_price: number; supply_shipping_fee: number; tax_type: string }>;
  supMap: Record<string, { supply_price: number; supply_shipping_fee: number; tax_type: string }>;
  prodMap: Record<string, { supply_price: number; supply_shipping_fee: number; tax_type: string }>;
  /** key: `${store_id}|${cafe24_product_no}` */
  cafe24ToProductId: Record<string, string>;
  nameToProductId: Record<string, string>;
}

/** settlement_items 컬럼과 1:1 대응 (insert 시 그대로 spread 가능) */
export interface ComputedItem {
  order_id: string;
  cafe24_order_id: string;
  cafe24_order_item_code: string;
  order_date: string;
  product_name: string;
  option_text: string;
  quantity: number;
  product_price: number;
  order_amount: number;
  shipping_fee: number;
  discount_amount: number;
  coupon_discount: number;
  app_discount: number;
  additional_discount: number;
  settled_amount: number;
  supply_price: number;
  supply_total: number;
  supply_shipping: number;
  tax_type: string;
  item_type: string;
  sales_channel: string;
  supplier_id: string | null;
  supplier_name: string;
  store_name: string;
}

/** 주문번호 접두사로 판매방식 추론 (sales_channel 없는 기존 데이터용) */
export function inferSalesChannel(orderId: string): string {
  if (orderId.startsWith("C24-")) return "cafe24";
  if (orderId.startsWith("TEL")) return "phone";
  if (orderId.startsWith("SMS")) return "sms";
  if (orderId.startsWith("SPL")) return "sample";
  if (orderId.startsWith("GFT")) return "gift";
  if (orderId.startsWith("JP")) return "group";
  return "phone";
}

/**
 * 주어진 주문들에 필요한 공급가 lookup 맵을 모두 적재한다.
 * 단일 store(판매사 정산)·전체 store(공급사 정산) 양쪽에서 동일하게 동작한다.
 * cafe24_product_no 매핑은 store 별로 다르므로 `${store_id}|${no}` 로 키잉한다.
 */
export async function loadSupplyContext(sb: SupabaseClient, orders: OrderRow[]): Promise<SupplyContext> {
  const productIds: string[] = [...new Set(orders.map((o) => o.product_id).filter(Boolean))] as string[];

  // supplier_products: supplier_id + product_id → 공급가
  const { data: supProducts } = await sb
    .from("supplier_products")
    .select("supplier_id, product_id, supply_price, supply_shipping_fee, tax_type");
  const supMap: SupplyContext["supMap"] = {};
  for (const sp of supProducts || []) {
    supMap[`${sp.supplier_id}|${sp.product_id}`] = {
      supply_price: sp.supply_price || 0,
      supply_shipping_fee: sp.supply_shipping_fee || 0,
      tax_type: sp.tax_type || "과세",
    };
  }

  // product_options: 옵션별 공급가
  const { data: prodOptions } = await sb
    .from("product_options")
    .select("product_id, option_text, supply_price, retail_price, supply_shipping_fee, tax_type");
  const optMap: SupplyContext["optMap"] = {};
  for (const po of prodOptions || []) {
    optMap[`${po.product_id}|${po.option_text}`] = {
      supply_price: po.supply_price || 0,
      retail_price: po.retail_price || 0,
      supply_shipping_fee: po.supply_shipping_fee || 0,
      tax_type: po.tax_type || "과세",
    };
  }

  // cafe24_product_no → product_id (product_id 없는 주문용, store 스코프)
  const cafe24ToProductId: Record<string, string> = {};
  const needCafe24 = orders.filter((o) => !o.product_id && o.cafe24_product_no);
  if (needCafe24.length > 0) {
    const storeIds = [...new Set(needCafe24.map((o) => o.store_id))];
    const nos = [...new Set(needCafe24.map((o) => o.cafe24_product_no))];
    const { data: mappings } = await sb
      .from("product_cafe24_mappings")
      .select("store_id, cafe24_product_no, product_id")
      .in("store_id", storeIds)
      .in("cafe24_product_no", nos);
    for (const m of mappings || []) {
      cafe24ToProductId[`${m.store_id}|${m.cafe24_product_no}`] = m.product_id;
      if (!productIds.includes(m.product_id)) productIds.push(m.product_id);
    }
  }

  // 상품명 → product_id (product_id·cafe24 매핑 모두 없는 주문용)
  const nameToProductId: Record<string, string> = {};
  const unmatchedNames = [...new Set(
    orders
      .filter((o) => !o.product_id && !cafe24ToProductId[`${o.store_id}|${o.cafe24_product_no}`] && o.product_name)
      .map((o) => (o.product_name as string).trim())
  )];
  if (unmatchedNames.length > 0) {
    const { data: byName } = await sb
      .from("products")
      .select("id, product_name")
      .in("product_name", unmatchedNames);
    for (const p of byName || []) {
      if (p.product_name) {
        nameToProductId[p.product_name.trim()] = p.id;
        if (!productIds.includes(p.id)) productIds.push(p.id);
      }
    }
  }

  // products 테이블 기본 공급가 (최종 폴백)
  const { data: prodList } = productIds.length > 0
    ? await sb.from("products").select("id, supply_price, supply_shipping_fee, tax_type").in("id", productIds)
    : { data: [] };
  const prodMap: SupplyContext["prodMap"] = {};
  for (const p of prodList || []) {
    prodMap[p.id] = {
      supply_price: p.supply_price || 0,
      supply_shipping_fee: p.supply_shipping_fee || 0,
      tax_type: p.tax_type || "과세",
    };
  }

  return { optMap, supMap, prodMap, cafe24ToProductId, nameToProductId };
}

/** 주문의 product_id 결정 (직접 → cafe24 매핑 → 상품명 매칭) */
export function resolveProductId(order: OrderRow, ctx: SupplyContext): string | null {
  if (order.product_id) return order.product_id as string;
  if (order.cafe24_product_no) {
    const pid = ctx.cafe24ToProductId[`${order.store_id}|${order.cafe24_product_no}`];
    if (pid) return pid;
  }
  if (order.product_name) {
    return ctx.nameToProductId[(order.product_name as string).trim()] || null;
  }
  return null;
}

/** 공급가 lookup: ①옵션별 → ②공급사+상품 → ③상품 기본 */
export function getSupplyInfo(order: OrderRow, ctx: SupplyContext): { supply_price: number; supply_shipping_fee: number; tax_type: string } {
  const pid = resolveProductId(order, ctx);
  const optText = ((order.option_text as string) || "").trim();
  if (pid && optText) {
    const o = ctx.optMap[`${pid}|${optText}`];
    if (o) return { supply_price: o.supply_price, supply_shipping_fee: o.supply_shipping_fee, tax_type: o.tax_type };
  }
  if (order.supplier_id && pid) {
    const key = `${order.supplier_id}|${pid}`;
    if (ctx.supMap[key]) return ctx.supMap[key];
  }
  if (pid && ctx.prodMap[pid]) return ctx.prodMap[pid];
  return { supply_price: 0, supply_shipping_fee: 0, tax_type: "과세" };
}

/**
 * 주문 1건 → 정산 항목 1건 계산.
 * 증정(매출0)·취소(역산)·샘플(순익0)·면세(10% VAT 가산) 특수처리 포함.
 */
export function computeItem(order: OrderRow, ctx: SupplyContext, store_name = ""): ComputedItem {
  const qty = order.quantity || 1;
  const isCancelled = order.shipping_status === "cancelled";
  const channel = order.sales_channel || inferSalesChannel(order.cafe24_order_id || "");
  const isGift = channel === "gift";
  const isSample = channel === "sample";

  // 정산매출: order_amount 기준 / 증정 0 / 취소 역산
  let settledAmount: number;
  if (isGift) {
    settledAmount = 0;
  } else if (isCancelled) {
    settledAmount = -(order.order_amount || 0);
  } else {
    settledAmount = order.order_amount || 0;
  }

  // 공급가 조회 + 면세 VAT 가산
  const supInfo = getSupplyInfo(order, ctx);
  let supplyPrice = supInfo.supply_price;
  let supplyShipping = supInfo.supply_shipping_fee;
  if (supInfo.tax_type === "면세") {
    if (supplyPrice > 0) supplyPrice = Math.round(supplyPrice * 1.1);
    if (supplyShipping > 0) supplyShipping = Math.round(supplyShipping * 1.1);
  }

  // 샘플: 공급가 = 정산매출, 공급배송비 = 0 (순익 0)
  const supplyTotal = isCancelled ? 0 : isSample ? settledAmount : supplyPrice * qty;
  const supShipFinal = isCancelled || isSample ? 0 : supplyShipping;
  const itemType = isCancelled ? "취소" : "매출";
  const supplierData = (order.suppliers as { id: string; name: string } | null) || null;

  return {
    order_id: order.id,
    cafe24_order_id: order.cafe24_order_id || "",
    cafe24_order_item_code: order.cafe24_order_item_code || "",
    order_date: order.order_date || "",
    product_name: order.product_name || "",
    option_text: order.option_text || "",
    quantity: qty,
    product_price: order.product_price || 0,
    order_amount: order.order_amount || 0,
    shipping_fee: order.shipping_fee || 0,
    discount_amount: order.discount_amount || 0,
    coupon_discount: order.coupon_discount || 0,
    app_discount: order.app_discount || 0,
    additional_discount: order.additional_discount || 0,
    settled_amount: settledAmount,
    supply_price: isSample && !isCancelled ? order.product_price || 0 : supplyPrice,
    supply_total: supplyTotal,
    supply_shipping: supShipFinal,
    tax_type: supInfo.tax_type,
    item_type: itemType,
    sales_channel: channel,
    supplier_id: order.supplier_id || null,
    supplier_name: supplierData?.name || "",
    store_name,
  };
}

/** "YYYY-MM" → { startDate, endDate } (해당 월 1일~말일) */
export function periodToRange(period: string): { startDate: string; endDate: string } | null {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return null;
  const lastDay = new Date(year, month, 0).getDate();
  return {
    startDate: `${period}-01`,
    endDate: `${period}-${String(lastDay).padStart(2, "0")}`,
  };
}
