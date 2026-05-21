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

  // 2. 해당 월 1일 기준 날짜 계산
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  // 3. 전화주문 조회 (당월)
  const { data: phoneOrders } = await sb
    .from("phone_orders")
    .select("id, order_number, order_date, product_name, option_text, quantity, unit_price, total_amount, recipient_name, status, payment_status, shipping_company, tracking_number, shipped_at, created_at")
    .eq("client_id", client.id)
    .gte("order_date", monthStart)
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
      .select("id, cafe24_order_id, order_date, product_name, option_text, quantity, product_price, order_amount, receiver_name, shipping_status, shipping_company, tracking_number, shipped_at, sales_channel, created_at")
      .eq("store_id", store.id)
      .gte("order_date", monthStart)
      .order("order_date", { ascending: false })
      .limit(500);
    mallOrders = data || [];
  }

  // 4. 금액 0인 주문에 상품 기본가 보정
  const zeroAmountNames = [
    ...allPhoneOrders.filter((o) => !o.total_amount && o.product_name).map((o) => o.product_name),
    ...mallOrders.filter((o) => !(o.order_amount as number) && !(o.product_price as number) && o.product_name).map((o) => o.product_name as string),
  ];
  if (zeroAmountNames.length > 0) {
    const uniqueNames = [...new Set(zeroAmountNames)];
    const { data: products } = await sb
      .from("products")
      .select("product_name, price")
      .in("product_name", uniqueNames);
    const priceMap: Record<string, number> = {};
    for (const p of products || []) {
      if (p.product_name && p.price) priceMap[p.product_name] = p.price;
    }
    for (const o of allPhoneOrders) {
      if (!o.total_amount && priceMap[o.product_name]) {
        o.total_amount = priceMap[o.product_name] * (o.quantity || 1);
        o.unit_price = priceMap[o.product_name];
      }
    }
    for (const o of mallOrders) {
      if (!(o.order_amount as number) && !(o.product_price as number) && priceMap[o.product_name as string]) {
        o.order_amount = priceMap[o.product_name as string] * ((o.quantity as number) || 1);
        o.product_price = priceMap[o.product_name as string];
      }
    }
  }

  // 5. 통계 계산
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
    period: monthStart,
  });
}
