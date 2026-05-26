/**
 * 채널톡 알림 API — Gmail에서 채널톡 알림 이메일을 조회
 * GET /api/channeltalk/alerts          — 최근 알림 목록
 * GET /api/channeltalk/alerts?count=1  — 읽지 않은 알림 수만
 */

import { NextRequest, NextResponse } from "next/server";
import {
  searchChannelTalkEmails,
  getUnreadChannelTalkCount,
} from "@/lib/gmail";

export async function GET(req: NextRequest) {
  const countOnly = req.nextUrl.searchParams.get("count");

  if (countOnly) {
    try {
      const count = await getUnreadChannelTalkCount();
      return NextResponse.json({ count });
    } catch (err) {
      return NextResponse.json({ count: 0, error: String(err) });
    }
  }

  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") || "10", 10),
    30
  );

  try {
    const emails = await searchChannelTalkEmails(limit);
    return NextResponse.json({ alerts: emails, total: emails.length });
  } catch (err) {
    return NextResponse.json(
      { error: `Gmail 조회 실패: ${err instanceof Error ? err.message : "unknown"}`, alerts: [] },
      { status: 500 }
    );
  }
}
