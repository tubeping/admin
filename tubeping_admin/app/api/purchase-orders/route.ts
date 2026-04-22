import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/purchase-orders — 발주서 목록
 * POST /api/purchase-orders — 발주서 생성 (주문 묶기)
 */

function generatePassword(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplier_id");

  const sb = getServiceClient();
  let query = sb
    .from("purchase_orders")
    .select("*, suppliers:supplier_id(name, email)")
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (supplierId) query = query.eq("supplier_id", supplierId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 각 PO 별 송장/카페24 연동 현황 + 판매사(스토어) 집계
  const poIds = (data || []).map((p) => p.id);
  const stats: Record<string, { tracked: number; synced: number; total: number }> = {};
  const poStoreIds: Record<string, Set<string>> = {};
  if (poIds.length > 0) {
    const { data: orderRows } = await sb
      .from("orders")
      .select("purchase_order_id, store_id, tracking_number, cafe24_shipping_synced")
      .in("purchase_order_id", poIds);
    for (const id of poIds) { stats[id] = { tracked: 0, synced: 0, total: 0 }; poStoreIds[id] = new Set(); }
    for (const o of orderRows || []) {
      if (!o.purchase_order_id) continue;
      const s = stats[o.purchase_order_id];
      if (!s) continue;
      s.total += 1;
      if (o.tracking_number && String(o.tracking_number).trim()) s.tracked += 1;
      if (o.cafe24_shipping_synced) s.synced += 1;
      if (o.store_id) poStoreIds[o.purchase_order_id].add(o.store_id);
    }
  }

  // 스토어 이름 조회
  const allStoreIds = [...new Set(Object.values(poStoreIds).flatMap((s) => [...s]))];
  const storeNames: Record<string, string> = {};
  if (allStoreIds.length > 0) {
    const { data: stores } = await sb.from("stores").select("id, name").in("id", allStoreIds);
    for (const s of stores || []) storeNames[s.id] = s.name;
  }

  const enriched = (data || []).map((p) => ({
    ...p,
    shipment_stats: stats[p.id] || { tracked: 0, synced: 0, total: 0 },
    store_names: [...(poStoreIds[p.id] || [])].map((sid) => storeNames[sid] || sid),
  }));

  return NextResponse.json({ purchase_orders: enriched });
}

/**
 * POST — 발주서 생성
 * body: { supplier_id, order_ids: string[] }
 *
 * 1. 발주번호 생성 (PO-YYYYMMDD-NNN)
 * 2. 4자리 비밀번호 생성
 * 3. 발주서 INSERT
 * 4. 선택된 주문들에 purchase_order_id 배정
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { supplier_id, order_ids } = body;

  if (!supplier_id || !order_ids || order_ids.length === 0) {
    return NextResponse.json(
      { error: "supplier_id, order_ids 필수" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  // 공급사 존재 확인
  const { data: supplier, error: supplierErr } = await sb
    .from("suppliers")
    .select("id, name")
    .eq("id", supplier_id)
    .single();

  if (supplierErr || !supplier) {
    return NextResponse.json({ error: "존재하지 않는 공급사입니다" }, { status: 400 });
  }

  // 주문의 기존 supplier_id 충돌 검증
  const { data: conflictOrders } = await sb
    .from("orders")
    .select("id, supplier_id")
    .in("id", order_ids)
    .not("supplier_id", "is", null)
    .neq("supplier_id", supplier_id);

  if (conflictOrders && conflictOrders.length > 0) {
    return NextResponse.json({
      error: `${conflictOrders.length}건의 주문이 다른 공급사에 이미 배정되어 있습니다. 확인 후 다시 시도하세요.`,
      conflicting_order_ids: conflictOrders.map((o) => o.id),
    }, { status: 409 });
  }

  // 발주번호 생성
  const { data: poNum } = await sb.rpc("generate_po_number");
  const poNumber = poNum || `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-001`;

  // 주문 정보로 합계 계산
  const { data: orders } = await sb
    .from("orders")
    .select("id, quantity, product_price")
    .in("id", order_ids);

  const totalItems = orders?.reduce((sum, o) => sum + (o.quantity || 0), 0) || 0;
  const totalAmount = orders?.reduce((sum, o) => sum + (o.quantity || 0) * (o.product_price || 0), 0) || 0;

  const password = generatePassword();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7일 후 만료

  // 발주서 생성
  const { data: po, error: poError } = await sb
    .from("purchase_orders")
    .insert({
      po_number: poNumber,
      supplier_id,
      total_items: totalItems,
      total_amount: totalAmount,
      access_password: password,
      access_expires_at: expiresAt,
      status: "draft",
    })
    .select()
    .single();

  if (poError) {
    return NextResponse.json({ error: poError.message }, { status: 500 });
  }

  // 주문에 발주서 ID 배정
  const { error: updateError } = await sb
    .from("orders")
    .update({
      purchase_order_id: po.id,
      supplier_id,
      shipping_status: "ordered",
    })
    .in("id", order_ids);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    purchase_order: po,
    assigned_orders: order_ids.length,
  });
}

/**
 * DELETE /api/purchase-orders — 발주서 삭제
 * body: { id: string }
 *
 * 1. 연결된 주문의 purchase_order_id 해제 (shipping_status는 ordered 유지 — 결제완료 상태 보존)
 * 2. 발주서 row 삭제
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 연결된 주문 해제 — shipping_status는 건드리지 않음 (이미 결제완료된 주문을 '입금전'으로 되돌리면 안 됨)
  await sb
    .from("orders")
    .update({ purchase_order_id: null })
    .eq("purchase_order_id", id);

  // 발주서 삭제
  const { error } = await sb
    .from("purchase_orders")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
