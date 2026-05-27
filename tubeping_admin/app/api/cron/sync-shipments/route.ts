import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env.server";

const CRON_SECRET = env.CRON_SECRET;

/**
 * GET /api/cron/sync-shipments — 카페24 송장 자동 전송
 * Vercel Cron으로 매일 오전 10시, 오후 3시, 오후 7시(KST) 실행
 * tracking_number 있고 cafe24_shipping_synced=false인 건을 카페24에 일괄 전송
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 내부적으로 기존 shipments API를 호출 (로직 재사용)
  const baseUrl = request.nextUrl.origin;
  const res = await fetch(`${baseUrl}/admin/api/cafe24/shipments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}), // 빈 body = 미연동 전체 처리
  });

  const data = await res.json();

  return NextResponse.json({
    message: "카페24 송장 자동 전송 완료",
    ...data,
  });
}
