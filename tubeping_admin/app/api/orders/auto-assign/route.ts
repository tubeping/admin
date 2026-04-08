import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/orders/auto-assign — TubePing 자체 상품-공급사 매핑으로 주문에 공급사 자동 배정
 *
 * 흐름:
 * 1. 공급사 미배정 주문 조회
 * 2. order.cafe24_product_no → product_cafe24_mappings → product_id
 * 3. products.supplier (공급사명) → suppliers.name 매칭
 * 4. 주문에 supplier_id 업데이트
 */
export async function POST() {
  const sb = getServiceClient();

  // 1. 공급사 미배정 주문
  const { data: orders } = await sb
    .from("orders")
    .select("id, store_id, cafe24_product_no")
    .is("supplier_id", null)
    .neq("cafe24_product_no", 0);

  if (!orders || orders.length === 0) {
    return NextResponse.json({ message: "배정할 주문이 없습니다", assigned: 0, failed: 0 });
  }

  // 2. cafe24_product_no → product_id 매핑 테이블 조회
  const productNos = [...new Set(orders.map((o) => o.cafe24_product_no))];
  const { data: mappings } = await sb
    .from("product_cafe24_mappings")
    .select("cafe24_product_no, product_id")
    .in("cafe24_product_no", productNos);

  const noToProductId: Record<number, string> = {};
  for (const m of mappings || []) {
    noToProductId[m.cafe24_product_no] = m.product_id;
  }

  // 3. product_id → supplier 이름
  const productIds = [...new Set(Object.values(noToProductId))];
  const { data: products } = await sb
    .from("products")
    .select("id, supplier")
    .in("id", productIds.length > 0 ? productIds : ["00000000-0000-0000-0000-000000000000"]);

  const productToSupplierName: Record<string, string> = {};
  for (const p of products || []) {
    if (p.supplier) productToSupplierName[p.id] = p.supplier;
  }

  // 4. supplier 이름 → supplier_id
  const supplierNames = [...new Set(Object.values(productToSupplierName))];
  const { data: suppliers } = await sb
    .from("suppliers")
    .select("id, name")
    .in("name", supplierNames.length > 0 ? supplierNames : [""]);

  const nameToSupplierId: Record<string, string> = {};
  for (const s of suppliers || []) {
    nameToSupplierId[s.name] = s.id;
  }

  // 5. 주문에 supplier_id 배정
  let assigned = 0;
  let failed = 0;

  for (const order of orders) {
    const productId = noToProductId[order.cafe24_product_no];
    if (!productId) { failed++; continue; }

    const supplierName = productToSupplierName[productId];
    if (!supplierName) { failed++; continue; }

    const supplierId = nameToSupplierId[supplierName];
    if (!supplierId) { failed++; continue; }

    const { error: updateErr } = await sb.from("orders").update({ supplier_id: supplierId }).eq("id", order.id);
    if (updateErr) { failed++; continue; }
    assigned++;
  }

  return NextResponse.json({
    total: orders.length,
    assigned,
    failed,
  });
}
