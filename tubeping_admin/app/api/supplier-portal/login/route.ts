import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/supplier-portal/login — 공급사 접속 인증
 * body: { password: string, po_number?: string }
 * 비밀번호만으로 로그인 가능 (발주번호 선택)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password, po_number } = body;

  if (!password) {
    return NextResponse.json(
      { error: "비밀번호를 입력해주세요" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  // 비밀번호로 발주서 조회 (발주번호 있으면 함께 매칭)
  let query = sb
    .from("purchase_orders")
    .select("*, suppliers:supplier_id(name, email)")
    .eq("access_password", password)
    .in("status", ["draft", "sent", "viewed"]);

  if (po_number) {
    query = query.eq("po_number", po_number);
  }

  const { data: pos, error } = await query.order("created_at", { ascending: false }).limit(1);

  const po = pos?.[0];

  if (error || !po) {
    return NextResponse.json(
      { error: "비밀번호가 일치하는 발주서가 없습니다" },
      { status: 401 }
    );
  }

  // 만료 확인
  if (po.access_expires_at && new Date(po.access_expires_at) < new Date()) {
    return NextResponse.json(
      { error: "접속 기한이 만료되었습니다" },
      { status: 403 }
    );
  }

  // 최초 열람 시 viewed_at 기록
  if (!po.viewed_at) {
    await sb
      .from("purchase_orders")
      .update({ viewed_at: new Date().toISOString(), status: "viewed" })
      .eq("id", po.id);
  }

  // 주문 목록 조회
  const { data: orders } = await sb
    .from("orders")
    .select(
      "id, cafe24_order_id, cafe24_order_item_code, product_name, option_text, quantity, product_price, order_amount, receiver_name, receiver_address, receiver_zipcode, shipping_company, tracking_number, shipping_status"
    )
    .eq("purchase_order_id", po.id)
    .order("cafe24_order_id", { ascending: true });

  return NextResponse.json({
    purchase_order: {
      id: po.id,
      po_number: po.po_number,
      order_date: po.order_date,
      supplier_name: po.suppliers?.name,
      total_items: po.total_items,
      total_amount: po.total_amount,
      status: po.status,
    },
    orders: orders || [],
  });
}
