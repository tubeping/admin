import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/phone-orders/cancel-transfer — 전화주문 이관 취소
 * body: { ids: string[] }  (phone_orders의 id 배열)
 *
 * 1. phone_orders status: "transferred" → "confirmed" 로 복원
 * 2. orders 테이블에서 해당 TEL- 주문 삭제 (PO/송장 연결된 건은 제외)
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { ids } = body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 필수 (배열)" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 전화주문 조회
  const { data: phoneOrders, error: fetchErr } = await sb
    .from("phone_orders")
    .select("id, order_number, status")
    .in("id", ids);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!phoneOrders || phoneOrders.length === 0) {
    return NextResponse.json({ error: "해당 주문을 찾을 수 없습니다." }, { status: 404 });
  }

  // 이관된 건만 대상
  const transferred = phoneOrders.filter((o) => o.status === "transferred");
  if (transferred.length === 0) {
    return NextResponse.json({ cancelled: 0, skipped: phoneOrders.length, message: "이관된 주문이 없습니다." });
  }

  // 2. orders 테이블에서 해당 TEL- 주문 찾기
  const orderNos = transferred.map((o) => {
    const stripped = o.order_number.replace(/^PT-/, "");
    return stripped.startsWith("TEL-") ? stripped : `TEL-${stripped}`;
  });

  const { data: linkedOrders } = await sb
    .from("orders")
    .select("id, cafe24_order_id, purchase_order_id, tracking_number")
    .in("cafe24_order_id", orderNos);

  // PO나 송장이 연결된 주문은 삭제 불가
  const safe = (linkedOrders || []).filter((o) => !o.purchase_order_id && !o.tracking_number);
  const blocked = (linkedOrders || []).filter((o) => o.purchase_order_id || o.tracking_number);

  // 3. 안전한 주문만 orders에서 삭제
  let deletedCount = 0;
  if (safe.length > 0) {
    const safeIds = safe.map((o) => o.id);
    // settlement_items FK 정리
    await sb.from("settlement_items").delete().in("order_id", safeIds);
    const { data: deleted } = await sb.from("orders").delete().in("id", safeIds).select("id");
    deletedCount = deleted?.length || 0;
  }

  // 4. 삭제 성공한 주문의 phone_orders status 복원
  const deletedOrderNos = new Set(safe.map((o) => o.cafe24_order_id));
  const revertIds = transferred
    .filter((o) => {
      const no = o.order_number.replace(/^PT-/, "");
      const telNo = no.startsWith("TEL-") ? no : `TEL-${no}`;
      return deletedOrderNos.has(telNo);
    })
    .map((o) => o.id);

  if (revertIds.length > 0) {
    await sb.from("phone_orders").update({ status: "confirmed" }).in("id", revertIds);
  }

  return NextResponse.json({
    cancelled: revertIds.length,
    orders_deleted: deletedCount,
    blocked: blocked.map((o) => ({
      order_id: o.cafe24_order_id,
      reason: o.purchase_order_id ? "발주서 연결됨" : "송장번호 등록됨",
    })),
  });
}
