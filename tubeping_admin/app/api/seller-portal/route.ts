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

    // 4. 주문 조회 — 실제 거래 시점 가격 (order_amount, shipping_fee, product_price)을 orders 테이블에서 직접 가져옴
    let orders: Array<Record<string, unknown>> = [];
    if (store) {
      const { data } = await sb
        .from("orders")
        .select("id, cafe24_order_id, order_date, product_name, option_text, quantity, product_price, order_amount, shipping_fee, receiver_name, shipping_status, shipping_company, tracking_number, sales_channel, supplier_id, product_id, cafe24_product_no, store_id")
        .eq("store_id", store.id)
        .gte("order_date", monthStart)
        .lt("order_date", nextMonth)
        .order("order_date", { ascending: false })
        .limit(2000);
      orders = data || [];
    }

    // 5. 공급가 보강 + 판매금액·배송비 자동 채우기 — /api/orders/route.ts와 동일한 우선순위 체인
    //    product_options(옵션 매칭) → supplier_products(공급사+상품) → products(기본)
    //    판매금액/배송비가 비어있으면 상품관리 정보로 자동 채운다.
    if (orders.length > 0) {
      // product_name → product_id 매핑
      const productNames = [...new Set(orders.map((o: any) => o.product_name?.trim()).filter(Boolean))];
      const nameToProductId: Record<string, string> = {};
      if (productNames.length > 0) {
        const { data: byName } = await sb.from("products").select("id, product_name").in("product_name", productNames);
        for (const p of byName || []) { if (p.product_name) nameToProductId[p.product_name.trim()] = p.id; }
      }

      // cafe24_product_no → product_id 매핑
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

      // 직접 product_id가 있는 주문 포함
      const directPids = [...new Set(orders.map((o: any) => o.product_id).filter(Boolean))];
      const allPids = [...new Set([...directPids, ...Object.values(storeProductToProductId), ...Object.values(nameToProductId)])];

      // products 테이블에서 공급가 + 판매가 fallback 조회
      const pidToSupplyPrice: Record<string, number> = {};
      const pidToSupplyShipping: Record<string, number> = {};
      const pidToSalePrice: Record<string, number> = {};
      if (allPids.length > 0) {
        for (let i = 0; i < allPids.length; i += 500) {
          const batch = allPids.slice(i, i + 500);
          const { data: products } = await sb.from("products").select("id, supply_price, supply_shipping_fee, price").in("id", batch);
          for (const p of products || []) {
            if (p.supply_price) pidToSupplyPrice[p.id] = p.supply_price;
            if (p.supply_shipping_fee) pidToSupplyShipping[p.id] = p.supply_shipping_fee;
            if (p.price) pidToSalePrice[p.id] = p.price;
          }
        }
      }

      // supplier_products — 공급사+상품 조합 (products보다 우선)
      const supMap: Record<string, { supply_price: number; supply_shipping_fee: number }> = {};
      const supplierIds = [...new Set(orders.map((o: any) => o.supplier_id).filter(Boolean))];
      if (supplierIds.length > 0 && allPids.length > 0) {
        const { data: supProducts } = await sb
          .from("supplier_products")
          .select("supplier_id, product_id, supply_price, supply_shipping_fee")
          .in("supplier_id", supplierIds)
          .in("product_id", allPids);
        for (const sp of (supProducts || [])) {
          supMap[`${sp.supplier_id}|${sp.product_id}`] = {
            supply_price: sp.supply_price || 0,
            supply_shipping_fee: sp.supply_shipping_fee || 0,
          };
        }
      }

      // product_options — 옵션별 공급가 (가장 구체적, 최우선)
      const optKeyToPrice: Record<string, { supply_price: number; retail_price: number; supply_shipping_fee: number }> = {};
      if (allPids.length > 0) {
        const { data: prodOpts } = await sb
          .from("product_options")
          .select("product_id, option_text, supply_price, retail_price, supply_shipping_fee")
          .in("product_id", allPids);
        for (const o of prodOpts || []) {
          optKeyToPrice[`${o.product_id}|${o.option_text}`] = {
            supply_price: o.supply_price || 0,
            retail_price: o.retail_price || 0,
            supply_shipping_fee: o.supply_shipping_fee || 0,
          };
        }
      }

      // 각 주문에 공급가 보강 + 판매가 fallback
      for (const o of orders as any[]) {
        // product_id 결정: DB 저장값 → cafe24 매핑 → 상품명 매칭
        let pid = o.product_id || undefined;
        if (!pid && o.store_id && o.cafe24_product_no > 0) pid = storeProductToProductId[`${o.store_id}::${o.cafe24_product_no}`];
        if (!pid && o.product_name) pid = nameToProductId[o.product_name.trim()];

        // 공급가 우선순위: product_options → supplier_products → products
        const optKey = pid && o.option_text ? `${pid}|${(o.option_text as string).trim()}` : null;
        const opt = optKey ? optKeyToPrice[optKey] : null;
        const supKey = o.supplier_id && pid ? `${o.supplier_id}|${pid}` : null;
        const supInfo = supKey ? supMap[supKey] : null;

        if (opt) {
          o.supply_price = opt.supply_price;
          o.supply_shipping_fee = opt.supply_shipping_fee;
        } else if (supInfo) {
          o.supply_price = supInfo.supply_price;
          o.supply_shipping_fee = supInfo.supply_shipping_fee;
        } else {
          o.supply_price = pid ? pidToSupplyPrice[pid] || 0 : 0;
          o.supply_shipping_fee = pid ? pidToSupplyShipping[pid] || 0 : 0;
        }

        // 판매가/판매금액 자동 채우기 + 배송비 채우기
        if (!o.product_price) {
          const fallbackPrice = (opt?.retail_price && opt.retail_price > 0)
            ? opt.retail_price
            : (pid ? pidToSalePrice[pid] || 0 : 0);
          if (fallbackPrice > 0) o.product_price = fallbackPrice;
        }
        if (!o.order_amount && o.product_price) {
          o.order_amount = o.product_price * (o.quantity || 1);
        }
        if (!o.shipping_fee && o.supply_shipping_fee) {
          o.shipping_fee = o.supply_shipping_fee;
        }
      }
    }

    // 6. 통계 — 판매금액은 orders 테이블의 실제 거래가 기준
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
