import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { generateOrderCsv, enrichWithTpCode } from "@/lib/purchaseOrderCsv";

// 주문에 fulfillment warehouse supplier id를 채워넣는다.
// (store_id, cafe24_product_no) → products.fulfillment_warehouse_supplier_id
type SBClient = ReturnType<typeof getServiceClient>;
async function enrichWithWarehouse<T extends { store_id?: string | null; cafe24_product_no: number }>(
  sb: SBClient,
  orders: T[]
): Promise<(T & { warehouse_supplier_id?: string | null })[]> {
  const productNos = [...new Set(orders.map((o) => o.cafe24_product_no).filter((n) => n > 0))];
  if (productNos.length === 0) return orders;
  const { data: mappings } = await sb
    .from("product_cafe24_mappings")
    .select("store_id, cafe24_product_no, product_id")
    .in("cafe24_product_no", productNos);
  const keyToProductId: Record<string, string> = {};
  for (const m of mappings || []) keyToProductId[`${m.store_id}::${m.cafe24_product_no}`] = m.product_id;
  const productIds = [...new Set(Object.values(keyToProductId))];
  const productIdToWarehouse: Record<string, string | null> = {};
  if (productIds.length > 0) {
    const { data: products } = await sb
      .from("products")
      .select("id, fulfillment_warehouse_supplier_id")
      .in("id", productIds);
    for (const p of products || []) {
      productIdToWarehouse[p.id] = p.fulfillment_warehouse_supplier_id || null;
    }
  }
  return orders.map((o) => {
    if (!o.store_id) return o;
    const pid = keyToProductId[`${o.store_id}::${o.cafe24_product_no}`];
    const wh = pid ? productIdToWarehouse[pid] : null;
    return { ...o, warehouse_supplier_id: wh };
  });
}

/**
 * GET /api/purchase-orders/preview — 공급사별 발주서 CSV 미리보기 (DB 변경 없음)
 * ?days=30 (기본)
 *
 * 최근 N일 주문 중 supplier_id 배정된 주문을 공급사별로 묶어서
 * 각 공급사의 po_config로 CSV를 생성해 반환. purchase_orders 테이블은 건드리지 않음.
 */
export async function GET(request: NextRequest) {
  const days = Number(request.nextUrl.searchParams.get("days") || "30");
  const sb = getServiceClient();

  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: orders, error } = await sb
    .from("orders")
    .select(
      "store_id, supplier_id, cafe24_order_id, cafe24_order_item_code, cafe24_product_no, product_name, option_text, quantity, order_date, buyer_name, buyer_phone, receiver_name, receiver_phone, receiver_address, receiver_zipcode, memo, shipping_company, tracking_number, shipping_status"
    )
    .gte("order_date", since)
    .not("supplier_id", "is", null)
    .neq("shipping_status", "cancelled")
    .order("order_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const withTp = await enrichWithTpCode(sb, orders || []);
  const enriched = await enrichWithWarehouse(sb, withTp);

  // 발주 대상(fulfillment target) = warehouse_supplier_id ?? supplier_id
  // 창고 상품은 원 supplier_id(정산용)와 별도로 묶여서 창고로 발주 나감
  const byFulfillment: Record<string, typeof enriched> = {};
  for (const o of enriched) {
    const target = o.warehouse_supplier_id || o.supplier_id;
    if (!target) continue;
    if (!byFulfillment[target]) byFulfillment[target] = [];
    byFulfillment[target]!.push(o);
  }

  const targetIds = Object.keys(byFulfillment);
  const { data: suppliers } = await sb
    .from("suppliers")
    .select("id, name, short_code, po_config")
    .in("id", targetIds);

  // 창고인지 판단: 주문 중에 warehouse_supplier_id가 set이고 그게 이 target과 같으면 창고
  const result = (suppliers || []).map((s) => {
    const supOrders = byFulfillment[s.id] || [];
    const isWarehouse = supOrders.some((o) => o.warehouse_supplier_id === s.id);
    // 원 공급사(정산용) 다양성 파악 — 창고 발주서에만 의미 있음
    const sourceSupplierIds = isWarehouse
      ? [...new Set(supOrders.map((o) => o.supplier_id).filter(Boolean))]
      : [];
    const csv = generateOrderCsv(supOrders, s.po_config);
    return {
      supplier_id: s.id,
      supplier_name: s.name,
      short_code: s.short_code,
      has_custom_format: !!s.po_config,
      is_warehouse: isWarehouse,
      source_supplier_count: sourceSupplierIds.length,
      order_count: supOrders.length,
      total_quantity: supOrders.reduce((sum, o) => sum + (o.quantity || 0), 0),
      csv,
    };
  }).sort((a, b) => b.order_count - a.order_count);

  return NextResponse.json({
    period_days: days,
    total_orders: orders?.length || 0,
    supplier_count: result.length,
    suppliers: result,
  });
}
