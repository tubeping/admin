import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCafe24Stores } from "@/lib/cafe24";
import { fetchOrdersFromStore, saveOrdersToDb, transitionPendingToReady } from "@/lib/collectOrders";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";
import { autoVerifyAddresses } from "@/lib/autoVerifyAddresses";

/**
 * GET /api/cafe24/orders — 전체 스토어의 주문 수집 (카페24 → Supabase)
 * ?start_date=2026-04-01&end_date=2026-04-03&store_id=xxx (선택)
 *
 * POST /api/cafe24/orders — 특정 스토어 주문을 수동으로 가져오기
 * body: { store_id, start_date, end_date }
 *
 * 수집·저장 로직은 lib/collectOrders.ts에 공통화되어 있다 (cron/collect-orders와 공유).
 */

/**
 * GET — 전체 스토어 주문 수집
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const startDate =
    searchParams.get("start_date") ||
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate =
    searchParams.get("end_date") ||
    new Date().toISOString().slice(0, 10);
  const filterStoreId = searchParams.get("store_id");

  try {
    let stores = await getCafe24Stores();
    if (filterStoreId) {
      stores = stores.filter((s) => s.id === filterStoreId);
    }

    // 모든 스토어를 병렬로 호출
    const results = await Promise.all(
      stores.map(async (store) => {
        try {
          const orders = await fetchOrdersFromStore(store, startDate, endDate);
          const saved = await saveOrdersToDb(store.id, orders);
          // 수집 직후 N00/N10 주문을 N20(배송준비중)으로 자동 전환
          const transition = await transitionPendingToReady(store, orders);
          // 우리 DB도 해당 주문의 shipping_status를 ordered로 갱신
          if (transition.transitioned.length > 0) {
            const sb2 = getServiceClient();
            const prefixed = transition.transitioned.map((id) => `C24-${id}`);
            await sb2
              .from("orders")
              .update({ shipping_status: "ordered" })
              .eq("store_id", store.id)
              .in("cafe24_order_id", prefixed)
              .eq("shipping_status", "pending");
          }
          return {
            store: store.name,
            mall_id: store.mall_id,
            fetched: orders.length,
            ...saved,
            transitioned: transition.transitioned.length,
            transition_failed: transition.failed.length,
            transition_errors: transition.failed,
          };
        } catch (err) {
          return {
            store: store.name,
            mall_id: store.mall_id,
            error: err instanceof Error ? err.message : "알 수 없는 오류",
          };
        }
      })
    );

    // last_sync_at 갱신 (성공한 스토어만)
    const sb = getServiceClient();
    const successStoreIds = stores
      .filter((_, i) => !("error" in results[i]))
      .map((s) => s.id);
    if (successStoreIds.length > 0) {
      await sb
        .from("stores")
        .update({ last_sync_at: new Date().toISOString() })
        .in("id", successStoreIds);
    }

    // 공급사 자동 배정 (미배정 주문 전체)
    let autoAssign: { total: number; assigned: number; failed: number } | null = null;
    try {
      autoAssign = await autoAssignSuppliers(sb);
    } catch (e) { console.error("[cafe24/orders] auto-assign suppliers failed:", e); }

    // 주소 자동 검증 (미검증 주문 대상)
    let addrVerify: { total: number; valid: number; invalid: number; unknown: number } | null = null;
    try {
      addrVerify = await autoVerifyAddresses(sb);
    } catch (e) { console.error("[cafe24/orders] auto-verify addresses failed:", e); }

    return NextResponse.json({
      period: { start_date: startDate, end_date: endDate },
      results,
      auto_assign: autoAssign,
      address_verify: addrVerify,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "주문 수집 실패" },
      { status: 500 }
    );
  }
}

/**
 * POST — 수동 주문 수집 (특정 스토어)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { store_id, start_date, end_date } = body;

  if (!store_id || !start_date || !end_date) {
    return NextResponse.json(
      { error: "store_id, start_date, end_date 필수" },
      { status: 400 }
    );
  }

  try {
    const stores = await getCafe24Stores();
    const store = stores.find((s) => s.id === store_id);
    if (!store) {
      return NextResponse.json({ error: "스토어를 찾을 수 없습니다" }, { status: 404 });
    }

    const orders = await fetchOrdersFromStore(store, start_date, end_date);
    const saved = await saveOrdersToDb(store.id, orders);

    return NextResponse.json({
      store: store.name,
      mall_id: store.mall_id,
      fetched: orders.length,
      ...saved,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "주문 수집 실패" },
      { status: 500 }
    );
  }
}
