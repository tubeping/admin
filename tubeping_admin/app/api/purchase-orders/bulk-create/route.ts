import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/purchase-orders/bulk-create — 주문을 fulfillment target으로 자동 그룹핑해 발주서 생성 + 메일 발송
 *
 * body: { order_ids: string[] }
 *
 * Fulfillment target 결정:
 *   1) 상품에 fulfillment_warehouse_supplier_id가 있으면 → 창고 공급사로 발주
 *   2) 없으면 → 주문의 원 supplier_id(tp_code 기반)로 발주
 *
 * orders.supplier_id는 **덮어쓰지 않음** (회계/정산용). purchase_order_id만 세팅.
 * 같은 주문이라도 창고상품은 창고 발주서에, 직배송 상품은 원공급사 발주서에 들어감.
 */
function generatePassword(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const orderIds: string[] = body.order_ids || [];

  if (orderIds.length === 0) {
    return NextResponse.json({ error: "order_ids 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 주문 조회 (이미 발주서에 속한 건 제외)
  const { data: orders, error: ordErr } = await sb
    .from("orders")
    .select("id, store_id, supplier_id, cafe24_product_no, product_name, purchase_order_id, quantity, product_price")
    .in("id", orderIds);

  if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 });
  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: "주문이 없습니다" }, { status: 404 });
  }

  // 2. 상품별 fulfillment_warehouse_supplier_id 맵 구축
  // 경로 A: (store_id, cafe24_product_no) → product_id
  const productNos = [...new Set(orders.map((o) => o.cafe24_product_no).filter((n) => n > 0))];
  const storeNoKeyToProductId: Record<string, string> = {};
  if (productNos.length > 0) {
    const { data: mappings } = await sb
      .from("product_cafe24_mappings")
      .select("store_id, cafe24_product_no, product_id")
      .in("cafe24_product_no", productNos);
    for (const m of mappings || []) {
      storeNoKeyToProductId[`${m.store_id}::${m.cafe24_product_no}`] = m.product_id;
    }
  }

  // 경로 B: product_name → product_id (수기등록/전화주문용)
  const productNames = [...new Set(orders.map((o) => o.product_name?.trim()).filter(Boolean) as string[])];
  const nameToProductId: Record<string, string> = {};
  if (productNames.length > 0) {
    const { data: byName } = await sb
      .from("products")
      .select("id, product_name")
      .in("product_name", productNames);
    for (const p of byName || []) {
      if (p.product_name) nameToProductId[p.product_name.trim()] = p.id;
    }
  }

  // product_id → warehouse_supplier_id
  const allProductIds = [...new Set([...Object.values(storeNoKeyToProductId), ...Object.values(nameToProductId)])];
  const productIdToWarehouse: Record<string, string | null> = {};
  if (allProductIds.length > 0) {
    const { data: products } = await sb
      .from("products")
      .select("id, fulfillment_warehouse_supplier_id")
      .in("id", allProductIds);
    for (const p of products || []) {
      productIdToWarehouse[p.id] = p.fulfillment_warehouse_supplier_id || null;
    }
  }

  // 주문 → warehouse_supplier_id 결정
  type OrderRow = NonNullable<typeof orders>[0];
  function resolveWarehouse(o: OrderRow): string | null {
    // 경로 A: cafe24_product_no 기반
    if (o.store_id && o.cafe24_product_no > 0) {
      const pid = storeNoKeyToProductId[`${o.store_id}::${o.cafe24_product_no}`];
      if (pid && productIdToWarehouse[pid]) return productIdToWarehouse[pid];
    }
    // 경로 B: product_name 기반
    if (o.product_name) {
      const pid = nameToProductId[o.product_name.trim()];
      if (pid && productIdToWarehouse[pid]) return productIdToWarehouse[pid];
    }
    return null;
  }

  // 3. fulfillment target 결정 + 그룹핑
  // target = warehouse_supplier_id ?? order.supplier_id
  const byTarget: Record<string, OrderRow[]> = {};
  const skipped: { order_id: string; reason: string }[] = [];

  for (const o of orders) {
    if (o.purchase_order_id) {
      skipped.push({ order_id: o.id, reason: "이미 발주서에 포함됨" });
      continue;
    }
    const target = resolveWarehouse(o) || o.supplier_id || null;
    if (!target) {
      skipped.push({ order_id: o.id, reason: "공급사 미배정" });
      continue;
    }
    if (!byTarget[target]) byTarget[target] = [];
    byTarget[target].push(o);
  }

  // 4. 각 그룹별 PO 생성 + 메일 발송
  const results: Array<{
    supplier_id: string;
    supplier_name: string;
    supplier_email: string;
    po_number?: string;
    order_count: number;
    is_warehouse: boolean;
    po_created: boolean;
    email_sent: boolean;
    error?: string;
  }> = [];

  // 공급사 정보 한 번에 로드
  const targetIds = Object.keys(byTarget);
  const { data: targetSuppliers } = await sb
    .from("suppliers")
    .select("id, name, email")
    .in("id", targetIds);
  const supplierMap = Object.fromEntries((targetSuppliers || []).map((s) => [s.id, s]));

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://tubepingadmin.vercel.app";

  for (const [targetId, grpOrders] of Object.entries(byTarget)) {
    const supplier = supplierMap[targetId];
    const supplierName = supplier?.name || "?";
    const supplierEmail = supplier?.email || "";
    // 창고 발주 여부: 이 그룹의 주문 중 원 supplier_id가 target과 다른 게 하나라도 있으면 창고 발주
    const isWarehouse = grpOrders.some((o) => o.supplier_id && o.supplier_id !== targetId);

    // 발주번호 생성
    const { data: poNum } = await sb.rpc("generate_po_number");
    const poNumber = poNum || `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-001`;

    const totalItems = grpOrders.reduce((sum, o) => sum + (o.quantity || 0), 0);
    const totalAmount = grpOrders.reduce((sum, o) => sum + (o.quantity || 0) * (o.product_price || 0), 0);
    const password = generatePassword();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: po, error: poErr } = await sb
      .from("purchase_orders")
      .insert({
        po_number: poNumber,
        supplier_id: targetId,
        total_items: totalItems,
        total_amount: totalAmount,
        access_password: password,
        access_expires_at: expiresAt,
        status: "draft",
      })
      .select()
      .single();

    if (poErr || !po) {
      results.push({
        supplier_id: targetId,
        supplier_name: supplierName,
        supplier_email: supplierEmail,
        order_count: grpOrders.length,
        is_warehouse: isWarehouse,
        po_created: false,
        email_sent: false,
        error: poErr?.message || "PO 생성 실패",
      });
      continue;
    }

    // 주문에 purchase_order_id 세팅 — supplier_id는 유지 (회계용)
    const grpIds = grpOrders.map((o) => o.id);
    const { error: updErr } = await sb
      .from("orders")
      .update({
        purchase_order_id: po.id,
        shipping_status: "ordered",
      })
      .in("id", grpIds);

    if (updErr) {
      results.push({
        supplier_id: targetId,
        supplier_name: supplierName,
        supplier_email: supplierEmail,
        po_number: po.po_number,
        order_count: grpOrders.length,
        is_warehouse: isWarehouse,
        po_created: true,
        email_sent: false,
        error: `주문 연결 실패: ${updErr.message}`,
      });
      continue;
    }

    // 메일 발송 호출
    let emailSent = false;
    let emailError: string | undefined;
    try {
      const emailRes = await fetch(`${baseUrl}/admin/api/purchase-orders/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchase_order_id: po.id }),
      });
      const emailData = await emailRes.json();
      emailSent = !!emailData.success;
      if (!emailSent) emailError = emailData.error || "메일 발송 실패";
    } catch (e) {
      emailError = e instanceof Error ? e.message : "메일 호출 실패";
    }

    results.push({
      supplier_id: targetId,
      supplier_name: supplierName,
      supplier_email: supplierEmail,
      po_number: po.po_number,
      order_count: grpOrders.length,
      is_warehouse: isWarehouse,
      po_created: true,
      email_sent: emailSent,
      error: emailError,
    });
  }

  return NextResponse.json({
    total_orders: orders.length,
    created_count: results.filter((r) => r.po_created).length,
    email_success: results.filter((r) => r.email_sent).length,
    results,
    skipped,
  });
}
