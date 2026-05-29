import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/outreach/instagram-log — 전체 발송 기록 조회
 * 반환: { logs: { [username]: { channel, status, sent_at, replied_at, memo } } }
 */
export async function GET() {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("instagram_outreach_log")
    .select("username, channel, status, sent_at, replied_at, memo");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const logs: Record<string, unknown> = {};
  for (const row of data || []) {
    logs[row.username] = {
      channel: row.channel,
      status: row.status,
      sent_at: row.sent_at,
      replied_at: row.replied_at,
      memo: row.memo,
    };
  }
  return NextResponse.json({ logs });
}

/**
 * POST /api/outreach/instagram-log — 발송 기록 (클릭한 날짜로)
 * body: { username, channel?, status?, memo? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { username, channel = "dm", status = "sent", memo } = body;

  if (!username) {
    return NextResponse.json({ error: "username은 필수입니다" }, { status: 400 });
  }

  const sb = getServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("instagram_outreach_log")
    .upsert(
      {
        username,
        channel,
        status,
        sent_at: now,
        memo: memo ?? null,
        updated_at: now,
      },
      { onConflict: "username" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ log: data });
}

/**
 * DELETE /api/outreach/instagram-log?username=xxx — 발송 기록 취소
 */
export async function DELETE(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username");
  if (!username) {
    return NextResponse.json({ error: "username은 필수입니다" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { error } = await sb
    .from("instagram_outreach_log")
    .delete()
    .eq("username", username);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
