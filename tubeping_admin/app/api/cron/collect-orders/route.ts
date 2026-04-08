import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, cafe24Fetch } from "@/lib/cafe24";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * GET /api/cron/collect-orders — 전체 스토어 주문 자동 수집
 * Vercel Cron으로 매일 오전 7시 실행
 * 최근 3일치 주문을 수집 (중복은 upsert로 처리)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const stores = await getActiveStores();

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

  const results: { store: string; fetched: number; saved: number; error?: string }[] = [];

  for (const store of stores) {
    try {
      const res = await cafe24Fetch(
        store,
        `/orders?start_date=${startDate}&end_date=${endDate}&limit=100&embed=items`
      );

      if (!res.ok) {
        results.push({ store: store.mall_id, fetched: 0, saved: 0, error: `API ${res.status}` });
        continue;
      }

      const data = await res.json();
      const orders = data.orders || [];

      const statusMap: Record<string, string> = {
        N00: "pending", N10: "pending", N20: "ordered", N21: "ordered",
        N22: "shipping", N30: "shipping", N40: "delivered",
        C00: "cancelled", C10: "cancelled", C34: "cancelled", R00: "cancelled",
      };

      let saved = 0;
      for (const order of orders) {
        const items = order.items || [order];
        for (const item of items) {
          const { error } = await sb.from("orders").upsert({
            store_id: store.id,
            cafe24_order_id: order.order_id || item.order_id,
            cafe24_order_item_code: item.order_item_code || "",
            order_date: order.order_date || item.order_date,
            buyer_name: order.buyer_name || "",
            buyer_email: order.buyer_email || "",
            buyer_phone: order.buyer_cellphone || "",
            receiver_name: order.receiver_name || "",
            receiver_phone: order.receiver_cellphone || "",
            receiver_address: [order.receiver_address1, order.receiver_address2].filter(Boolean).join(" "),
            receiver_zipcode: order.receiver_zipcode || "",
            cafe24_product_no: item.product_no || 0,
            product_name: item.product_name || "",
            option_text: item.option_value || "",
            quantity: item.quantity || 1,
            product_price: parseInt(item.product_price || "0", 10),
            order_amount: (item.quantity || 1) * parseInt(item.product_price || "0", 10),
            shipping_company: item.shipping_company_name || "",
            tracking_number: item.tracking_no || "",
            shipping_status: statusMap[item.order_status || order.order_status] || "pending",
          }, { onConflict: "store_id,cafe24_order_id,cafe24_order_item_code" });

          if (!error) saved++;
        }
      }

      results.push({ store: store.mall_id, fetched: orders.length, saved });

      // last_sync_at 갱신
      await sb.from("stores").update({ last_sync_at: new Date().toISOString() }).eq("id", store.id);
    } catch (err) {
      results.push({
        store: store.mall_id,
        fetched: 0,
        saved: 0,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
  const totalSaved = results.reduce((s, r) => s + r.saved, 0);

  return NextResponse.json({
    period: { start_date: startDate, end_date: endDate },
    total_fetched: totalFetched,
    total_saved: totalSaved,
    results,
  });
}
