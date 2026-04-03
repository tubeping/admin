/**
 * 네이버톡톡 답변 발송 API
 * POST /api/navertalk/send
 * body: { ticket_id, message }
 *
 * CS 페이지에서 답변 시 → 네이버톡톡으로 메시지 자동 전송
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { sendNaverTalkMessage } from "@/lib/navertalk";

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  const { ticket_id, message } = await req.json();

  if (!ticket_id || !message) {
    return NextResponse.json({ error: "ticket_id와 message 필요" }, { status: 400 });
  }

  // 티켓 조회
  const { data: ticket, error: ticketErr } = await sb
    .from("cs_tickets")
    .select("*, cs_channels(auth_key)")
    .eq("id", ticket_id)
    .single();

  if (ticketErr || !ticket) {
    return NextResponse.json({ error: "티켓을 찾을 수 없습니다" }, { status: 404 });
  }

  if (ticket.channel !== "naver_talk") {
    return NextResponse.json({ error: "네이버톡톡 티켓이 아닙니다" }, { status: 400 });
  }

  if (!ticket.customer_id) {
    return NextResponse.json({ error: "고객 식별자 없음" }, { status: 400 });
  }

  // auth_key 가져오기 (cs_channels 테이블에서)
  const authKey = ticket.cs_channels?.auth_key;
  if (!authKey) {
    return NextResponse.json({ error: "네이버톡톡 인증 키가 설정되지 않았습니다" }, { status: 400 });
  }

  // 네이버톡톡으로 발송
  const result = await sendNaverTalkMessage(authKey, ticket.customer_id, message);

  if (!result.success) {
    return NextResponse.json(
      { error: `네이버톡톡 발송 실패 (${result.status})` },
      { status: 500 }
    );
  }

  // DB 업데이트
  const now = new Date().toISOString();
  await sb
    .from("cs_tickets")
    .update({ reply: message, replied_at: now, replied_by: "관리자", status: "replied" })
    .eq("id", ticket_id);

  await sb.from("cs_ticket_messages").insert({
    ticket_id,
    direction: "outbound",
    sender_name: "관리자",
    content: message,
    channel: "naver_talk",
  });

  return NextResponse.json({ success: true, naver_status: result.status });
}
