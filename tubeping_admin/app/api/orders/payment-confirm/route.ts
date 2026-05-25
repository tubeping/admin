import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, cafe24Fetch } from "@/lib/cafe24";

/**
 * POST /api/orders/payment-confirm — 매칭된 주문 입금확인 처리
 * body: { order_ids: string[] }
 *
 * 1. 내부 DB: shipping_status pending → ordered (상품준비중)
 * 2. 카페24: 주문 상태를 N00(입금전) → N10(상품준비중)으로 변경
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const orderIds: string[] = body.order_ids || [];

  if (orderIds.length === 0) {
    return NextResponse.json({ error: "order_ids 필수" }, { status: 400 });
  }

  const sb = getServiceClient();
  const now = new Date().toISOString();

  // 1. 내부 DB 상태 변경
  const { data: orders, error } = await sb
    .from("orders")
    .update({
      shipping_status: "ordered",
      memo: `[${now.slice(0, 16).replace("T", " ")}] 입금확인 완료`,
    })
    .in("id", orderIds)
    .eq("shipping_status", "pending")
    .select("id, store_id, cafe24_order_id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2. 카페24 주문 상태 변경 (입금전 → 상품준비중)
  let cafe24Success = 0;
  let cafe24Failed = 0;
  const cafe24Errors: string[] = [];

  if (orders && orders.length > 0) {
    const stores = await getActiveStores();
    const storeMap = Object.fromEntries(stores.map((s) => [s.id, s]));

    for (const order of orders) {
      const store = storeMap[order.store_id];
      if (!store || !order.cafe24_order_id) continue;
      // 수기주문(EXCEL-)·전화주문(PT-)은 카페24에 존재하지 않으므로 skip
      if (order.cafe24_order_id.startsWith("EXCEL-") || order.cafe24_order_id.startsWith("PT-")) continue;

      try {
        // 카페24 주문 상태 변경: prepare (상품준비중)
        const res = await cafe24Fetch(store, `/orders/${order.cafe24_order_id}`, {
          method: "PUT",
          body: JSON.stringify({
            request: {
              process_status: "prepare",
            },
          }),
        });

        if (res.ok) {
          cafe24Success++;
        } else {
          const text = await res.text();
          cafe24Failed++;
          cafe24Errors.push(`${order.cafe24_order_id}: ${res.status} ${text.slice(0, 100)}`);
        }
      } catch (e) {
        cafe24Failed++;
        cafe24Errors.push(`${order.cafe24_order_id}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
  }

  return NextResponse.json({
    confirmed: orders?.length || 0,
    total: orderIds.length,
    cafe24: {
      success: cafe24Success,
      failed: cafe24Failed,
      errors: cafe24Errors.slice(0, 5),
    },
  });
}
