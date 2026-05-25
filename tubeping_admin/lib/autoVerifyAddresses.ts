import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyOneAddress } from "./addressUtils";

/**
 * 주문 주소 자동 검증 (juso.go.kr 기반, 서버사이드)
 *
 * 흐름:
 *   1. address_verify_status != 'valid'인 주문 중 receiver_address가 있는 건 조회
 *   2. juso.go.kr API로 주소 검증 (10건씩 병렬, rate limit 고려)
 *   3. 결과를 orders.address_verify_status에 일괄 저장
 *
 * opts.orderIds가 주어지면 해당 주문만, 아니면 미검증 전체 대상 (최대 200건)
 */

const BATCH_SIZE = 10; // juso.go.kr 동시 요청 수 제한

export async function autoVerifyAddresses(
  sb: SupabaseClient,
  opts: { orderIds?: string[] } = {}
): Promise<{ total: number; valid: number; invalid: number; unknown: number }> {
  const confmKey = process.env.JUSO_CONFIRM_KEY;
  if (!confmKey) {
    console.warn("[autoVerifyAddresses] JUSO_CONFIRM_KEY not set, skipping");
    return { total: 0, valid: 0, invalid: 0, unknown: 0 };
  }

  // 미검증 주문 조회 (이미 valid인 주문은 재검증하지 않음)
  let q = sb
    .from("orders")
    .select("id, receiver_address")
    .neq("address_verify_status", "valid")
    .neq("shipping_status", "cancelled")
    .not("receiver_address", "is", null);
  if (opts.orderIds?.length) q = q.in("id", opts.orderIds);
  q = q.limit(200);

  const { data: orders, error: qErr } = await q;
  if (qErr) {
    if (qErr.message?.includes("does not exist")) {
      console.warn("[autoVerifyAddresses] address_verify_status column missing, skipping");
      return { total: 0, valid: 0, invalid: 0, unknown: 0 };
    }
    console.error("[autoVerifyAddresses] query error:", qErr.message);
    return { total: 0, valid: 0, invalid: 0, unknown: 0 };
  }
  if (!orders?.length) {
    return { total: 0, valid: 0, invalid: 0, unknown: 0 };
  }

  // 빈 주소 사전 필터링 (API 호출 절약)
  const validOrders = orders.filter((o) => o.receiver_address?.trim().length >= 2);
  const emptyOrders = orders.filter((o) => !o.receiver_address?.trim() || o.receiver_address.trim().length < 2);

  let valid = 0, invalid = emptyOrders.length, unknown = 0;
  const now = new Date().toISOString();

  // 빈 주소 일괄 invalid 처리
  if (emptyOrders.length > 0) {
    await Promise.all(
      emptyOrders.map((o) =>
        sb.from("orders").update({
          address_verify_status: "invalid",
          address_verify_reason: "주소 없음",
          address_verified_at: now,
        }).eq("id", o.id)
      )
    ).catch((e) => console.error("[autoVerifyAddresses] empty addr update failed:", e));
  }

  // 배치 처리 (BATCH_SIZE건씩 병렬 API 호출 → 일괄 DB 업데이트)
  for (let i = 0; i < validOrders.length; i += BATCH_SIZE) {
    const batch = validOrders.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (order) => {
        const result = await verifyOneAddress(confmKey, order.receiver_address);
        return { id: order.id, ...result };
      })
    );

    // DB 일괄 업데이트 (Promise.all로 병렬)
    const updateResults = await Promise.all(
      results.map((r) =>
        sb.from("orders").update({
          address_verify_status: r.status,
          address_verify_reason: r.reason,
          address_verified_at: now,
        }).eq("id", r.id)
      )
    );

    // 컬럼 미존재 시 조기 종료
    const colMissing = updateResults.some((r) => r.error?.message?.includes("does not exist"));
    if (colMissing) {
      console.warn("[autoVerifyAddresses] column missing, aborting");
      return { total: orders.length, valid, invalid, unknown };
    }

    for (const r of results) {
      if (r.status === "valid") valid++;
      else if (r.status === "invalid") invalid++;
      else unknown++;
    }
  }

  return { total: orders.length, valid, invalid, unknown };
}
