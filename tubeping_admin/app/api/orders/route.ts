import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/orders — 통합 주문 목록 (Supabase)
 * ?status=pending&store_id=xxx&supplier_id=xxx&start_date=&end_date=&limit=50&offset=0
 */

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const storeId = searchParams.get("store_id");
  const supplierId = searchParams.get("supplier_id");
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 500);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);
  const poId = searchParams.get("purchase_order_id");
  const includeDraft = searchParams.get("include_draft") === "true";

  const sb = getServiceClient();
  let query = sb
    .from("orders")
    .select(
      "*, stores:store_id(name, mall_id), suppliers:supplier_id(name, email), purchase_orders:purchase_order_id(id, po_number, status, sent_at, viewed_at, completed_at)",
      { count: "exact" }
    )
    .order("order_date", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("shipping_status", status);
  else if (!includeDraft) query = query.neq("shipping_status", "draft");
  if (storeId) query = query.eq("store_id", storeId);
  if (supplierId) query = query.eq("supplier_id", supplierId);
  if (poId) query = query.eq("purchase_order_id", poId);
  if (startDate) query = query.gte("order_date", startDate);
  if (endDate) query = query.lte("order_date", endDate + "T23:59:59");

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 출고지(창고) + 상품관리 가격 enrichment
  const orders = data || [];
  if (orders.length > 0) {
    // 1) orders.product_id가 이미 설정된 경우 직접 사용
    const directPids = [...new Set(orders.map((o: any) => o.product_id).filter(Boolean))];

    // 2) cafe24_product_no → product_id 매핑
    const productNos = [...new Set(orders.map((o: any) => o.cafe24_product_no).filter((n: any) => n > 0))];
    const storeProductToProductId: Record<string, string> = {};
    if (productNos.length > 0) {
      const { data: mappings } = await sb
        .from("product_cafe24_mappings")
        .select("store_id, cafe24_product_no, product_id")
        .in("cafe24_product_no", productNos);
      for (const m of mappings || []) {
        storeProductToProductId[`${m.store_id}::${m.cafe24_product_no}`] = m.product_id;
      }
    }
    // 3) product_name → product_id 매핑 (cafe24_product_no 없는 경우)
    const productNames = [...new Set(orders.map((o: any) => o.product_name?.trim()).filter(Boolean))];
    const nameToProductId: Record<string, string> = {};
    if (productNames.length > 0) {
      const { data: byName } = await sb.from("products").select("id, product_name").in("product_name", productNames);
      for (const p of byName || []) { if (p.product_name) nameToProductId[p.product_name.trim()] = p.id; }
    }
    // 4) 모든 product_id에서 가격 정보 + 출고지 가져오기 (price 추가)
    const allPids = [...new Set([...directPids, ...Object.values(storeProductToProductId), ...Object.values(nameToProductId)])];
    const pidToWarehouse: Record<string, string> = {};
    const pidToSupplyPrice: Record<string, number> = {};
    const pidToSupplyShipping: Record<string, number> = {};
    const pidToSalePrice: Record<string, number> = {};
    if (allPids.length > 0) {
      const { data: products } = await sb.from("products").select("id, fulfillment_warehouse_supplier_id, supply_price, supply_shipping_fee, price").in("id", allPids);
      for (const p of products || []) {
        if (p.fulfillment_warehouse_supplier_id) pidToWarehouse[p.id] = p.fulfillment_warehouse_supplier_id;
        if (p.supply_price) pidToSupplyPrice[p.id] = p.supply_price;
        if (p.supply_shipping_fee) pidToSupplyShipping[p.id] = p.supply_shipping_fee;
        if (p.price) pidToSalePrice[p.id] = p.price;
      }
    }
    // warehouse supplier_id → name
    const warehouseIds = [...new Set(Object.values(pidToWarehouse))];
    const warehouseNames: Record<string, string> = {};
    if (warehouseIds.length > 0) {
      const { data: wSuppliers } = await sb.from("suppliers").select("id, name").in("id", warehouseIds);
      for (const s of wSuppliers || []) { warehouseNames[s.id] = s.name; }
    }
    // 각 주문에 warehouse_name, supply_price, supply_shipping_fee + 판매가 보충
    for (const o of orders as any[]) {
      // product_id 결정: DB에 저장된 값 → cafe24 매핑 → 상품명 매칭
      let pid = o.product_id || undefined;
      if (!pid && o.store_id && o.cafe24_product_no > 0) pid = storeProductToProductId[`${o.store_id}::${o.cafe24_product_no}`];
      if (!pid && o.product_name) pid = nameToProductId[o.product_name.trim()];
      const wId = pid ? pidToWarehouse[pid] : undefined;
      o.warehouse_name = wId ? warehouseNames[wId] || null : null;
      o.supply_price = pid ? pidToSupplyPrice[pid] || 0 : 0;
      o.supply_shipping_fee = pid ? pidToSupplyShipping[pid] || 0 : 0;
      // 판매가가 비어있으면 상품관리 가격으로 보충
      if (pid && pidToSalePrice[pid]) {
        if (!o.product_price) o.product_price = pidToSalePrice[pid];
        if (!o.order_amount) o.order_amount = pidToSalePrice[pid] * (o.quantity || 1);
      }
    }
  }

  return NextResponse.json({ orders, total: count });
}

/**
 * PATCH /api/orders — 주문 일괄 수정 (공급사 배정, 상태 변경 등)
 * body: { ids: string[], updates: { supplier_id?, shipping_status?, memo? } }
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { ids, updates } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 필수 (배열)" }, { status: 400 });
  }

  const allowedFields = [
    "cafe24_order_id",
    "supplier_id", "shipping_status", "memo", "purchase_order_id",
    "is_sample", "auto_assign_status",
    "tracking_number", "shipping_company",
    "buyer_name", "buyer_phone", "receiver_name", "receiver_phone", "receiver_address",
    "store_id", "sales_channel",
  ];
  const filtered: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: "수정할 필드 없음" }, { status: 400 });
  }

  // 사용자가 supplier_id를 명시 변경하면 auto_assign_status를 "manual"로 자동 표시
  // (auto_assign_status를 함께 보냈으면 그 값 유지)
  if ("supplier_id" in filtered && !("auto_assign_status" in filtered)) {
    filtered.auto_assign_status = "manual";
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("orders")
    .update(filtered)
    .in("id", ids)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ updated: data?.length || 0 });
}

/**
 * DELETE /api/orders — 주문 일괄 삭제
 * body: { ids: string[] }
 * settlement_items가 FK로 참조하므로 먼저 정리한 뒤 orders 삭제
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { ids } = body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 필수 (배열)" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 자식 테이블(settlement_items) 먼저 삭제 — FK 위반 방지
  const { error: siErr } = await sb.from("settlement_items").delete().in("order_id", ids);
  if (siErr) {
    return NextResponse.json({ error: `정산항목 삭제 실패: ${siErr.message}` }, { status: 500 });
  }

  const { data, error } = await sb.from("orders").delete().in("id", ids).select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: data?.length || 0 });
}
