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

    // 2. 당월 1일
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    // 3. 전화주문 + 스토어 조회 병렬
    const [phoneRes, storeRes] = await Promise.all([
      sb.from("phone_orders")
        .select("id, order_number, order_date, product_name, option_text, quantity, unit_price, total_amount, recipient_name, status, payment_status, shipping_company, tracking_number")
        .eq("client_id", client.id)
        .gte("order_date", monthStart)
        .order("order_date", { ascending: false })
        .limit(500),
      sb.from("stores")
        .select("id")
        .eq("name", client.name)
        .single(),
    ]);

    const phoneOrders = phoneRes.data || [];

    // 4. 스토어 주문 조회
    let mallOrders: Array<Record<string, unknown>> = [];
    if (storeRes.data) {
      const { data } = await sb
        .from("orders")
        .select("id, cafe24_order_id, order_date, product_name, option_text, quantity, product_price, order_amount, receiver_name, shipping_status, shipping_company, tracking_number, sales_channel")
        .eq("store_id", storeRes.data.id)
        .gte("order_date", monthStart)
        .order("order_date", { ascending: false })
        .limit(500);
      mallOrders = data || [];
    }

    // 5. 금액 0인 주문에 상품 기본가 보정
    const zeroNames = new Set<string>();
    for (const o of phoneOrders) {
      if (!o.total_amount && o.product_name) zeroNames.add(o.product_name);
    }
    for (const o of mallOrders) {
      if (!(o.order_amount as number) && !(o.product_price as number) && o.product_name) {
        zeroNames.add(o.product_name as string);
      }
    }

    if (zeroNames.size > 0) {
      // 정확 매칭 시도
      const { data: products } = await sb
        .from("products")
        .select("product_name, price")
        .in("product_name", [...zeroNames]);

      const priceMap: Record<string, number> = {};
      for (const p of products || []) {
        if (p.product_name && p.price) priceMap[p.product_name] = p.price;
      }

      // 매칭 안 된 상품 → 부분 매칭 (상품명 앞 15자 기준)
      const unmatched = [...zeroNames].filter((n) => !priceMap[n]);
      for (const name of unmatched) {
        const keyword = name.replace(/\.{2,}$/, "").slice(0, 15);
        if (keyword.length < 5) continue;
        const { data: found } = await sb
          .from("products")
          .select("product_name, price")
          .ilike("product_name", `%${keyword}%`)
          .limit(1);
        if (found?.[0]?.price) priceMap[name] = found[0].price;
      }

      for (const o of phoneOrders) {
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

    // 6. 통계 (단일 패스)
    const phoneStat = { total: 0, pending: 0, confirmed: 0, shipping: 0, delivered: 0, unpaid: 0, totalAmount: 0 };
    for (const o of phoneOrders) {
      phoneStat.total++;
      if (o.status === "pending") phoneStat.pending++;
      else if (o.status === "confirmed") phoneStat.confirmed++;
      else if (o.status === "shipping") phoneStat.shipping++;
      else if (o.status === "delivered") phoneStat.delivered++;
      if (o.payment_status === "unpaid") phoneStat.unpaid++;
      phoneStat.totalAmount += o.total_amount || 0;
    }

    const mallStat = { total: 0, pending: 0, shipping: 0, delivered: 0, totalAmount: 0 };
    for (const o of mallOrders) {
      mallStat.total++;
      const ss = o.shipping_status as string;
      if (ss === "pending") mallStat.pending++;
      else if (ss === "shipping") mallStat.shipping++;
      else if (ss === "delivered") mallStat.delivered++;
      mallStat.totalAmount += (o.order_amount as number) || 0;
    }

    return NextResponse.json({
      client: { name: client.name, contact_name: client.contact_name },
      phoneOrders,
      mallOrders,
      stats: { phone: phoneStat, mall: mallStat },
      period: monthStart,
    });
  } catch (e) {
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
