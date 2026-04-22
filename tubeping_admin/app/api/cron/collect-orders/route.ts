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
        `/orders?start_date=${startDate}&end_date=${endDate}&limit=100&embed=items,receivers`
      );

      if (!res.ok) {
        results.push({ store: store.mall_id, fetched: 0, saved: 0, error: `API ${res.status}` });
        continue;
      }

      const data = await res.json();
      const orders = data.orders || [];

      // N10(상품준비중)·N20(배송준비중)은 PG 결제완료이므로 admin에서 '입금완료'(ordered)로 저장.
      // N00(입금전)만 pending으로 저장 — 수동 입금확인 대상.
      // 취소 계열(C*)·반품 계열(R*)은 prefix로 판정해 cancelled 처리 (C00/C10/C34/C40/C48 등 커버).
      const baseMap: Record<string, string> = {
        N00: "pending", N10: "ordered", N20: "ordered", N21: "ordered",
        N22: "shipping", N30: "shipping", N40: "delivered",
      };
      const mapStatus = (s: string): string => {
        if (!s) return "pending";
        if (s.startsWith("C") || s.startsWith("R")) return "cancelled";
        return baseMap[s] || "pending";
      };

      // 입금전(N00)만 제외. 취소(C00/C10/C34)·반품(R00)은 포함해서 수집 —
      // 기존 admin 주문의 상태를 cancelled로 동기화하기 위함.
      const EXCLUDE_STATUS = new Set(["N00"]);
      const validOrders = orders.filter((order: { items?: { order_status?: string }[]; order_status?: string }) => {
        const items = order.items || [order];
        return items.some((it) => !EXCLUDE_STATUS.has(it.order_status || order.order_status || ""));
      });

      // 기존 admin 주문 조회 (cancelled 신규 insert 방지 및 다운그레이드 가드)
      const cafeOrderIds = [...new Set(validOrders.map((o: { order_id?: string }) => o.order_id).filter(Boolean) as string[])];
      const { data: existingRows } = await sb
        .from("orders")
        .select("cafe24_order_id,cafe24_order_item_code,shipping_status,tracking_number")
        .eq("store_id", store.id)
        .in("cafe24_order_id", cafeOrderIds);
      const existingMap = new Map<string, { shipping_status: string | null; tracking_number: string | null }>();
      for (const e of existingRows || []) {
        existingMap.set(`${e.cafe24_order_id}::${e.cafe24_order_item_code || ""}`, {
          shipping_status: e.shipping_status,
          tracking_number: e.tracking_number,
        });
      }
      const NON_DOWNGRADE = new Set(["ordered", "shipping", "delivered"]);

      let saved = 0;
      for (const order of validOrders) {
        const items = order.items || [order];
        const receiver = order.receivers?.[0] || {};
        for (const item of items) {
          const orderId = order.order_id || item.order_id;
          const itemCode = item.order_item_code || "";
          // cancel_date 필드가 있으면 C* 상태와 동등하게 cancelled 처리
          const rawStatus = item.order_status || order.order_status || "";
          const hasCancelDate = !!(item.cancel_date || order.cancel_date);
          const newStatus = hasCancelDate ? "cancelled" : mapStatus(rawStatus);
          const existing = existingMap.get(`${orderId}::${itemCode}`);

          // 신규인데 cancelled면 skip (취소 주문을 새로 DB에 넣지 않음)
          if (!existing && newStatus === "cancelled") continue;

          // 다운그레이드 가드: ordered/shipping/delivered → pending/등으로 내리지 않음 (단 cancelled는 허용)
          let finalStatus = newStatus;
          if (existing && newStatus !== "cancelled"
              && existing.shipping_status && NON_DOWNGRADE.has(existing.shipping_status)
              && !NON_DOWNGRADE.has(newStatus)) {
            finalStatus = existing.shipping_status;
          }

          const { error } = await sb.from("orders").upsert({
            store_id: store.id,
            cafe24_order_id: orderId,
            cafe24_order_item_code: itemCode,
            order_date: order.order_date || item.order_date,
            buyer_name: order.buyer_name || "",
            buyer_email: order.buyer_email || "",
            buyer_phone: order.buyer_cellphone || "",
            receiver_name: receiver.name || order.receiver_name || "",
            receiver_phone: receiver.cellphone || receiver.phone || order.receiver_cellphone || "",
            receiver_address: [receiver.address1 || order.receiver_address1, receiver.address2 || order.receiver_address2].filter(Boolean).join(" "),
            receiver_zipcode: receiver.zipcode || order.receiver_zipcode || "",
            cafe24_product_no: item.product_no || 0,
            product_name: item.product_name || "",
            option_text: item.option_value || "",
            quantity: item.quantity || 1,
            product_price: parseInt(item.product_price || "0", 10),
            order_amount: (item.quantity || 1) * parseInt(item.product_price || "0", 10),
            memo: receiver.shipping_message || order.shipping_message || order.user_message || "",
            shipping_company: item.shipping_company_name || "",
            tracking_number: item.tracking_no || "",
            shipping_status: finalStatus,
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
