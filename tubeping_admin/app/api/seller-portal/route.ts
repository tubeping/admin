import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  try {
    const sb = getServiceClient();

    // 1. 토큰으로 판매처 조회
    const { data: client, error: clientErr } = await sb
      .from("phone_order_clients")
      .select("id, name, contact_name")
      .eq("view_token", token)
      .eq("status", "active")
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
    }

    // 2. 조회 기간
    const monthParam = request.nextUrl.searchParams.get("month");
    let year: number, month: number;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      year = parseInt(monthParam.slice(0, 4));
      month = parseInt(monthParam.slice(5, 7));
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    // 3. 스토어 조회
    const { data: store } = await sb
      .from("stores")
      .select("id")
      .eq("name", client.name)
      .maybeSingle();

    // 4. 주문 조회
    let orders: Array<Record<string, unknown>> = [];
    if (store) {
      const { data } = await sb
        .from("orders")
        .select("id, cafe24_order_id, order_date, product_name, option_text, quantity, product_price, order_amount, shipping_fee, receiver_name, shipping_status, shipping_company, tracking_number, sales_channel")
        .eq("store_id", store.id)
        .gte("order_date", monthStart)
        .lt("order_date", nextMonth)
        .order("order_date", { ascending: false })
        .limit(2000);
      orders = data || [];
    }

    // 5. 상품 정보 일괄 조회 (공급가 + 판매가 보정 통합)
    const allProductNames = [...new Set(orders.map((o) => (o.product_name as string)?.trim()).filter(Boolean))];
    const productInfo: Record<string, { supply_price: number; supply_shipping_fee: number; price: number }> = {};

    if (allProductNames.length > 0) {
      const { data: prods } = await sb
        .from("products")
        .select("product_name, supply_price, supply_shipping_fee, price")
        .in("product_name", allProductNames);
      for (const p of prods || []) {
        if (p.product_name) {
          productInfo[p.product_name.trim()] = {
            supply_price: p.supply_price || 0,
            supply_shipping_fee: p.supply_shipping_fee || 0,
            price: p.price || 0,
          };
        }
      }

      // 매칭 안 된 상품명 유사 검색 (금액 0인 것만)
      const unmatchedZero = allProductNames.filter((n) => {
        const info = productInfo[n];
        if (info) return false;
        return orders.some((o) => (o.product_name as string)?.trim() === n && !(o.order_amount as number) && !(o.product_price as number));
      });
      for (const name of unmatchedZero) {
        const keyword = name.replace(/\.{2,}$/, "").slice(0, 15);
        if (keyword.length < 5) continue;
        const { data: found } = await sb
          .from("products")
          .select("product_name, supply_price, supply_shipping_fee, price")
          .ilike("product_name", `%${keyword}%`)
          .limit(1);
        if (found?.[0]) {
          productInfo[name] = {
            supply_price: found[0].supply_price || 0,
            supply_shipping_fee: found[0].supply_shipping_fee || 0,
            price: found[0].price || 0,
          };
        }
      }
    }

    // 6. 주문에 공급가 + 판매가 보정 적용
    for (const o of orders) {
      const info = productInfo[(o.product_name as string)?.trim()];
      (o as any).supply_price = info?.supply_price || 0;
      (o as any).supply_shipping_fee = info?.supply_shipping_fee || 0;

      if (!(o.order_amount as number) && !(o.product_price as number) && info?.price) {
        o.product_price = info.price;
        o.order_amount = info.price * ((o.quantity as number) || 1);
      }
    }

    // 7. 통계
    const stats = { total: 0, pending: 0, ordered: 0, shipping: 0, delivered: 0, cancelled: 0, totalAmount: 0 };
    for (const o of orders) {
      stats.total++;
      const ss = o.shipping_status as string;
      if (ss === "pending") stats.pending++;
      else if (ss === "ordered") stats.ordered++;
      else if (ss === "shipping") stats.shipping++;
      else if (ss === "delivered") stats.delivered++;
      else if (ss === "cancelled") stats.cancelled++;
      if (ss !== "cancelled") stats.totalAmount += (o.order_amount as number) || 0;
    }

    return NextResponse.json({
      client: { name: client.name, contact_name: client.contact_name },
      mallOrders: orders,
      stats,
      period: monthStart,
    });
  } catch (e) {
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
