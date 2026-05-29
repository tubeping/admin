import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCafe24Stores } from "@/lib/cafe24";
import { fetchOrdersFromStore, saveOrdersToDb } from "@/lib/collectOrders";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";
import { autoVerifyAddresses } from "@/lib/autoVerifyAddresses";
import { env } from "@/lib/env.server";

const CRON_SECRET = env.CRON_SECRET;

/**
 * GET /api/cron/collect-orders — 전체 스토어 주문 자동 수집 (시스템 크론, 매일 07시 KST)
 * 최근 3일치 주문을 수집한다. 저장 규칙(C24- 접두사·dedup·송장/상태 보호)은
 * lib/collectOrders.ts에 공통화되어 있어 수동 수집(cafe24/orders)과 항상 동일하다.
 * → 과거 이 라우트가 접두사 없는 bare 주문번호로 따로 저장해 동일 주문이 2건씩
 *   생기던 중복 버그를 차단한다.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const stores = await getCafe24Stores();

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

  const results: { store: string; fetched: number; saved: number; error?: string }[] = [];

  for (const store of stores) {
    try {
      const orders = await fetchOrdersFromStore(store, startDate, endDate);
      const { saved } = await saveOrdersToDb(store.id, orders);
      results.push({ store: store.mall_id, fetched: orders.length, saved });
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

  // 신규 주문에 공급사 자동 매칭 (supplier_id IS NULL인 주문 대상)
  let autoAssign: { total: number; assigned: number; failed: number } | undefined;
  try {
    autoAssign = await autoAssignSuppliers(sb);
  } catch (e) { console.error("[cron/collect-orders] auto-assign suppliers failed:", e); }

  // 주소 자동 검증
  let addrVerify: { total: number; valid: number; invalid: number; unknown: number } | undefined;
  try {
    addrVerify = await autoVerifyAddresses(sb);
  } catch (e) { console.error("[cron/collect-orders] auto-verify addresses failed:", e); }

  return NextResponse.json({
    period: { start_date: startDate, end_date: endDate },
    total_fetched: totalFetched,
    total_saved: totalSaved,
    auto_assign: autoAssign,
    address_verify: addrVerify,
    results,
  });
}
