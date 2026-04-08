import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/supplier-portal/shipments — 공급사가 송장번호 등록
 * body: {
 *   po_number: string,
 *   password: string,
 *   shipments: Array<{
 *     cafe24_order_id: string,
 *     cafe24_order_item_code?: string,
 *     shipping_company: string,
 *     tracking_number: string
 *   }>
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { po_number, password, shipments } = body;

  if (!po_number || !password || !shipments || shipments.length === 0) {
    return NextResponse.json(
      { error: "발주번호, 비밀번호, 송장정보 필수" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  // 인증
  const { data: po } = await sb
    .from("purchase_orders")
    .select("id, access_password, access_expires_at, status")
    .eq("po_number", po_number)
    .single();

  if (!po) {
    return NextResponse.json({ error: "발주서를 찾을 수 없습니다" }, { status: 404 });
  }
  if (po.access_password !== password) {
    return NextResponse.json({ error: "비밀번호가 일치하지 않습니다" }, { status: 401 });
  }
  if (po.access_expires_at && new Date(po.access_expires_at) < new Date()) {
    return NextResponse.json({ error: "접속 기한이 만료되었습니다" }, { status: 403 });
  }

  // 송장 등록
  const results: { cafe24_order_id: string; success: boolean; error?: string }[] = [];

  for (const s of shipments) {
    let query = sb
      .from("orders")
      .update({
        shipping_company: s.shipping_company,
        tracking_number: s.tracking_number,
        shipping_status: "shipping",
        shipped_at: new Date().toISOString(),
        cafe24_shipping_synced: false, // 카페24 연동 대기
      })
      .eq("purchase_order_id", po.id)
      .eq("cafe24_order_id", s.cafe24_order_id);

    if (s.cafe24_order_item_code) {
      query = query.eq("cafe24_order_item_code", s.cafe24_order_item_code);
    }

    const { error } = await query;

    results.push({
      cafe24_order_id: s.cafe24_order_id,
      success: !error,
      error: error?.message,
    });
  }

  const successCount = results.filter((r) => r.success).length;

  // 전체 주문에 송장이 등록되었는지 확인 → 완료 처리
  const { data: remaining } = await sb
    .from("orders")
    .select("id")
    .eq("purchase_order_id", po.id)
    .or("tracking_number.is.null,tracking_number.eq.");

  if (!remaining || remaining.length === 0) {
    await sb
      .from("purchase_orders")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", po.id);
  }

  // 업로드 이력 저장
  await sb.from("shipment_uploads").insert({
    purchase_order_id: po.id,
    file_name: "직접입력",
    total_rows: shipments.length,
    success_rows: successCount,
    error_rows: shipments.length - successCount,
    error_details: results.filter((r) => !r.success),
  });

  return NextResponse.json({
    total: shipments.length,
    success: successCount,
    failed: shipments.length - successCount,
    results,
  });
}
