import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, cafe24Fetch } from "@/lib/cafe24";

/**
 * POST /api/orders/reconcile
 *   body: { purchase_order_id: string } (선택) 또는 { order_ids: string[] }
 *
 * 카페24에 이미 등록된 송장을 우리 DB에 반영하여 cafe24_shipping_synced=true로 마킹.
 * tracking_number가 다를 경우 카페24 값으로 덮어씀.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sb = getServiceClient();

  let query = sb
    .from("orders")
    .select("id, store_id, cafe24_order_id, cafe24_order_item_code, tracking_number, cafe24_shipping_synced")
    .eq("cafe24_shipping_synced", false);

  if (body.purchase_order_id) query = query.eq("purchase_order_id", body.purchase_order_id);
  if (Array.isArray(body.order_ids) && body.order_ids.length > 0) query = query.in("id", body.order_ids);

  const { data: pending, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pending || pending.length === 0) {
    return NextResponse.json({ message: "조정할 주문 없음", reconciled: 0 });
  }

  const stores = await getActiveStores();
  const storeMap = Object.fromEntries(stores.map((s) => [s.id, s]));

  const orderIdToItems = new Map<string, typeof pending>();
  for (const o of pending) {
    const key = `${o.store_id}::${o.cafe24_order_id}`;
    if (!orderIdToItems.has(key)) orderIdToItems.set(key, []);
    orderIdToItems.get(key)!.push(o);
  }

  let reconciled = 0;
  const details: Record<string, unknown>[] = [];

  for (const [key, items] of orderIdToItems) {
    const [storeId, cafeOrderId] = key.split("::");
    const store = storeMap[storeId];
    if (!store) continue;

    try {
      const res = await cafe24Fetch(store, `/orders/${cafeOrderId}?embed=items`);
      if (!res.ok) continue;
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cafeItems: any[] = data?.order?.items || [];

      for (const our of items) {
        const cafeItem = cafeItems.find((ci) => ci.order_item_code === our.cafe24_order_item_code);
        if (!cafeItem) continue;
        const cafeTracking = cafeItem.tracking_no;
        const cafeCompany = cafeItem.shipping_company_name;
        const cafeStatus = cafeItem.order_status;
        // 카페24에 tracking이 있고 이미 배송 진행 상태면 synced로 마킹
        if (cafeTracking && ["N21", "N22", "N30", "N40"].includes(cafeStatus)) {
          const update: Record<string, unknown> = {
            cafe24_shipping_synced: true,
            cafe24_shipping_synced_at: new Date().toISOString(),
          };
          if (cafeTracking !== our.tracking_number) {
            update.tracking_number = cafeTracking;
          }
          if (cafeCompany) update.shipping_company = cafeCompany;
          await sb.from("orders").update(update).eq("id", our.id);
          reconciled++;
          details.push({ order_id: our.id, cafe24_order_id: cafeOrderId, item_code: our.cafe24_order_item_code, tracking: cafeTracking, status: cafeStatus });
        }
      }
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 50));
  }

  return NextResponse.json({ reconciled, details });
}
