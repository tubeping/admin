import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 토큰으로 판매처 조회
  const { data: client, error: clientErr } = await sb
    .from("phone_order_clients")
    .select("id, name, contact_name, phone, status")
    .eq("view_token", token)
    .eq("status", "active")
    .single();

  if (clientErr || !client) {
    return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  // 2. 전화주문 조회
  const { data: phoneOrders } = await sb
    .from("phone_orders")
    .select("id, order_number, order_date, product_name, option_text, quantity, unit_price, total_amount, recipient_name, status, payment_status, shipping_company, tracking_number, shipped_at, created_at")
    .eq("client_id", client.id)
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  // 3. 이관된 주문 (orders 테이블, sales_channel = 'phone') 조회
  //    phone_order_clients.name과 매칭되는 stores 찾기
  const { data: store } = await sb
    .from("stores")
    .select("id")
    .eq("name", client.name)
    .single();

  let mallOrders: Array<Record<string, unknown>> = [];
  if (store) {
    const { data } = await sb
      .from("orders")
      .select("id, cafe24_order_id, order_date, product_name, option_text, quantity, order_amount, receiver_name, shipping_status, shipping_company, tracking_number, shipped_at, sales_channel, created_at")
      .eq("store_id", store.id)
      .neq("sales_channel", "phone") // 전화주문은 위에서 이미 조회
      .order("order_date", { ascending: false })
      .limit(500);
    mallOrders = data || [];
  }

  // 4. 통계 계산
  const allPhoneOrders = phoneOrders || [];
  const stats = {
    phone: {
      total: allPhoneOrders.length,
      pending: allPhoneOrders.filter((o) => o.status === "pending").length,
      confirmed: allPhoneOrders.filter((o) => o.status === "confirmed").length,
      shipping: allPhoneOrders.filter((o) => o.status === "shipping").length,
      delivered: allPhoneOrders.filter((o) => o.status === "delivered").length,
      unpaid: allPhoneOrders.filter((o) => o.payment_status === "unpaid").length,
      totalAmount: allPhoneOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0),
    },
    mall: {
      total: mallOrders.length,
      pending: mallOrders.filter((o) => o.shipping_status === "pending").length,
      shipping: mallOrders.filter((o) => o.shipping_status === "shipping").length,
      delivered: mallOrders.filter((o) => o.shipping_status === "delivered").length,
      totalAmount: mallOrders.reduce((sum, o) => sum + ((o.order_amount as number) || 0), 0),
    },
  };

  return NextResponse.json({
    client: { name: client.name, contact_name: client.contact_name },
    phoneOrders: allPhoneOrders,
    mallOrders,
    stats,
  });
}
