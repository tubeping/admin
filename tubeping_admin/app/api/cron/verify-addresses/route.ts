import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { verifyOneAddress } from "@/lib/addressUtils";
import { env } from "@/lib/env.server";

const CRON_SECRET = env.CRON_SECRET;
const BATCH_SIZE = 10;
const MAX_PER_RUN = 500;

/**
 * GET /api/cron/verify-addresses — 주소 자동 검증 (노란불·빨간불만)
 * 하루 3회: 오전 8시, 오후 1시, 오후 4시 (KST)
 * valid(녹색)은 건너뛰고, invalid(빨간불)·unknown/null(노란불)만 재검증
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const confmKey = process.env.JUSO_CONFIRM_KEY;
  if (!confmKey) {
    return NextResponse.json({ error: "JUSO_CONFIRM_KEY not set" }, { status: 500 });
  }

  const sb = getServiceClient();
  let totalProcessed = 0;
  let valid = 0, invalid = 0, unknown = 0;
  const now = new Date().toISOString();

  // 반복 호출: 200건씩 가져와서 MAX_PER_RUN까지 처리
  while (totalProcessed < MAX_PER_RUN) {
    const { data: orders, error: qErr } = await sb
      .from("orders")
      .select("id, receiver_address")
      .or("address_verify_status.is.null,address_verify_status.eq.invalid,address_verify_status.eq.unknown")
      .neq("shipping_status", "cancelled")
      .not("receiver_address", "is", null)
      .limit(200);

    if (qErr) {
      console.error("[cron/verify-addresses] query error:", qErr.message);
      break;
    }
    if (!orders?.length) break;

    // 빈 주소 사전 필터링
    const validOrders = orders.filter((o) => o.receiver_address?.trim().length >= 2);
    const emptyOrders = orders.filter((o) => !o.receiver_address?.trim() || o.receiver_address.trim().length < 2);

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
      ).catch((e) => console.error("[cron/verify-addresses] empty addr update:", e));
      invalid += emptyOrders.length;
    }

    // 배치 처리
    for (let i = 0; i < validOrders.length; i += BATCH_SIZE) {
      const batch = validOrders.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (order) => {
          const result = await verifyOneAddress(confmKey, order.receiver_address);
          return { id: order.id, ...result };
        })
      );

      await Promise.all(
        results.map((r) =>
          sb.from("orders").update({
            address_verify_status: r.status,
            address_verify_reason: r.reason,
            address_verified_at: now,
          }).eq("id", r.id)
        )
      );

      for (const r of results) {
        if (r.status === "valid") valid++;
        else if (r.status === "invalid") invalid++;
        else unknown++;
      }
    }

    totalProcessed += orders.length;

    // 처리한 건수가 200 미만이면 더 이상 남은 게 없음
    if (orders.length < 200) break;
  }

  return NextResponse.json({
    processed: totalProcessed,
    valid,
    invalid,
    unknown,
  });
}
