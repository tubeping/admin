/**
 * 채널톡 답변 발송 API
 * POST /api/channeltalk/send
 * body: { ticket_id, message } — CS 티켓 기반 발송
 *   or: { chat_id, message }  — 채널톡 대화 직접 발송
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { sendMessage } from "@/lib/channeltalk";

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  const { ticket_id, chat_id, message } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "message 필요" }, { status: 400 });
  }

  // 직접 chat_id로 전송 (채널톡 탭에서 사용)
  if (chat_id && !ticket_id) {
    const sent = await sendMessage(chat_id, message);
    if (!sent) {
      return NextResponse.json({ error: "채널톡 발송 실패" }, { status: 500 });
    }
    return NextResponse.json({ success: true, channel_talk_sent: true });
  }

  // 티켓 기반 전송 (CS 통합 관리에서 사용)
  if (!ticket_id) {
    return NextResponse.json({ error: "ticket_id 또는 chat_id 필요" }, { status: 400 });
  }

  const { data: ticket, error: ticketErr } = await sb
    .from("cs_tickets")
    .select("*")
    .eq("id", ticket_id)
    .single();

  if (ticketErr || !ticket) {
    return NextResponse.json({ error: "티켓을 찾을 수 없습니다" }, { status: 404 });
  }

  if (ticket.channel !== "channel_talk") {
    return NextResponse.json({ error: "채널톡 티켓이 아닙니다" }, { status: 400 });
  }

  // channel_ticket_id가 채널톡 chatId
  const targetChatId = ticket.channel_ticket_id;
  if (!targetChatId) {
    return NextResponse.json({ error: "채널톡 대화 ID가 없습니다" }, { status: 400 });
  }

  const sent = await sendMessage(targetChatId, message);

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
    channel: "channel_talk",
  });

  return NextResponse.json({
    success: true,
    channel_talk_sent: sent,
    note: sent ? "채널톡으로 발송 완료" : "채널톡 발송 실패 — DB에는 저장됨",
  });
}
