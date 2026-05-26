/**
 * 채널톡 대화 동기화 Cron
 * GET /api/cron/sync-channeltalk
 *
 * 5분마다 실행 — 채널톡 API로 열린 대화를 조회해서
 * 새 대화/메시지를 cs_tickets + cs_ticket_messages에 저장
 *
 * 무료 플랜에서도 동작 (웹훅 불필요)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { env } from "@/lib/env.server";
import {
  listAllUserChats,
  getChatMessages,
  blocksToText,
  type ChannelUserChat,
  type ChannelMessage,
} from "@/lib/channeltalk";

const CRON_SECRET = env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Vercel Cron 인증
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 채널톡 API 키 확인
  if (!env.CHANNELTALK_ACCESS_KEY || !env.CHANNELTALK_ACCESS_SECRET) {
    return NextResponse.json({ error: "채널톡 API 키 미설정", skipped: true });
  }

  const sb = getServiceClient();
  const stats = { newTickets: 0, newMessages: 0, updatedTickets: 0, errors: 0 };

  try {
    // 열린 대화 + 스누즈 대화 수집
    const [openedChats, snoozedChats] = await Promise.all([
      listAllUserChats("opened", 3),
      listAllUserChats("snoozed", 1),
    ]);
    const allChats = [...openedChats, ...snoozedChats];

    for (const chat of allChats) {
      try {
        await syncChat(sb, chat, stats);
      } catch (err) {
        console.error(`채널톡 동기화 실패 (chat ${chat.id}):`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error("채널톡 목록 조회 실패:", err);
    return NextResponse.json({
      error: `채널톡 API 오류: ${err instanceof Error ? err.message : "unknown"}`,
    }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...stats });
}

async function syncChat(
  sb: ReturnType<typeof getServiceClient>,
  chat: ChannelUserChat,
  stats: { newTickets: number; newMessages: number; updatedTickets: number; errors: number }
) {
  const chatId = chat.id;
  const userName = chat.user?.name || chat.user?.id || "고객";
  const userId = chat.user?.id || "";
  const userEmail = chat.user?.email || null;
  const userPhone = chat.user?.mobileNumber || null;

  // 기존 티켓 확인
  const { data: existing } = await sb
    .from("cs_tickets")
    .select("id, status, updated_at")
    .eq("channel", "channel_talk")
    .eq("channel_ticket_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 메시지 조회 (최근 20개)
  const rawMessages = await getChatMessages(chatId, 20);
  if (rawMessages.length === 0) return;

  // 고객이 보낸 메시지만 필터
  const userMessages = rawMessages.filter((m: ChannelMessage) => m.personType === "user");

  if (existing) {
    // 이미 저장된 메시지 ID 조회
    const { data: savedMsgs } = await sb
      .from("cs_ticket_messages")
      .select("channel_message_id")
      .eq("ticket_id", existing.id)
      .not("channel_message_id", "is", null);

    const savedIds = new Set((savedMsgs || []).map((m) => m.channel_message_id));

    // 새 메시지만 추가
    for (const msg of rawMessages) {
      if (msg.id && !savedIds.has(msg.id)) {
        const text = blocksToText(msg.blocks) || msg.plainText || "";
        if (!text) continue;

        await sb.from("cs_ticket_messages").insert({
          ticket_id: existing.id,
          direction: msg.personType === "user" ? "inbound" : "outbound",
          sender_name: msg.personType === "user" ? userName : (msg.personType === "bot" ? "봇" : "담당자"),
          content: text,
          channel: "channel_talk",
          channel_message_id: msg.id,
        });
        stats.newMessages++;
      }
    }

    // 새 고객 메시지가 있으면 상태를 open으로
    const hasNewUserMsg = userMessages.some((m: ChannelMessage) => m.id && !savedIds.has(m.id));
    if (hasNewUserMsg && existing.status === "replied") {
      await sb.from("cs_tickets").update({ status: "open" }).eq("id", existing.id);
      stats.updatedTickets++;
    }
  } else {
    // 새 티켓 생성
    const firstUserMsg = userMessages[userMessages.length - 1]; // oldest
    const text = firstUserMsg
      ? blocksToText(firstUserMsg.blocks) || firstUserMsg.plainText || ""
      : "";

    if (!text) return;

    const { data: ticket } = await sb
      .from("cs_tickets")
      .insert({
        channel: "channel_talk",
        channel_ticket_id: chatId,
        ticket_type: "inquiry",
        customer_id: userId,
        customer_name: userName,
        customer_email: userEmail,
        customer_phone: userPhone,
        subject: text.length > 50 ? text.slice(0, 50) + "..." : text,
        content: text,
        status: chat.state === "closed" ? "closed" : "open",
        priority: "normal",
      })
      .select("id")
      .single();

    if (ticket) {
      stats.newTickets++;

      // 전체 메시지 저장
      for (const msg of [...rawMessages].reverse()) {
        const msgText = blocksToText(msg.blocks) || msg.plainText || "";
        if (!msgText) continue;

        await sb.from("cs_ticket_messages").insert({
          ticket_id: ticket.id,
          direction: msg.personType === "user" ? "inbound" : "outbound",
          sender_name: msg.personType === "user" ? userName : (msg.personType === "bot" ? "봇" : "담당자"),
          content: msgText,
          channel: "channel_talk",
          channel_message_id: msg.id || null,
        });
        stats.newMessages++;
      }
    }
  }
}
