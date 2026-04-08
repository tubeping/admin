/**
 * 카카오 챗봇 스킬 웹훅 수신 API
 * POST /api/kakaotalk/webhook?channel_id={cs_channel_id}
 *
 * 카카오 i 오픈빌더에서 스킬 서버 URL로 등록:
 * https://tubepingadmin.vercel.app/admin/api/kakaotalk/webhook?channel_id=xxx
 *
 * 수신 → cs_tickets에 저장 → 자동 응답 또는 콜백 대기
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import {
  type KakaoSkillPayload,
  extractFromPayload,
  buildTextResponse,
} from "@/lib/kakaotalk";

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  const channelId = req.nextUrl.searchParams.get("channel_id");

  let payload: KakaoSkillPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(buildTextResponse("요청 처리 중 오류가 발생했습니다."));
  }

  const { userId, message, callbackUrl } = extractFromPayload(payload);

  if (!message) {
    return NextResponse.json(buildTextResponse("메시지를 입력해 주세요."));
  }

  // 채널 정보 조회
  let storeId: string | null = null;
  let csChannelId: string | null = channelId;

  if (channelId) {
    const { data: ch } = await sb
      .from("cs_channels")
      .select("id, store_id, name, total_chats")
      .eq("id", channelId)
      .single();

    if (ch) {
      storeId = ch.store_id;
      csChannelId = ch.id;

      await sb
        .from("cs_channels")
        .update({ last_event_at: new Date().toISOString(), total_chats: ch.total_chats + 1 })
        .eq("id", ch.id);
    }
  }

  // 기존 열린 대화가 있는지 확인
  const { data: existing } = await sb
    .from("cs_tickets")
    .select("id, status")
    .eq("channel", "kakao")
    .eq("customer_id", userId)
    .eq("cs_channel_id", csChannelId)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // 기존 티켓에 메시지 추가
    await sb.from("cs_ticket_messages").insert({
      ticket_id: existing.id,
      direction: "inbound",
      sender_name: userId,
      content: message,
      channel: "kakao",
      channel_message_id: callbackUrl || null,
    });

    if (existing.status !== "open") {
      await sb.from("cs_tickets").update({ status: "open" }).eq("id", existing.id);
    }
  } else {
    // 새 티켓 생성
    const { data: ticket } = await sb
      .from("cs_tickets")
      .insert({
        store_id: storeId,
        cs_channel_id: csChannelId,
        channel: "kakao",
        channel_ticket_id: `kakao_${userId}_${Date.now()}`,
        ticket_type: "inquiry",
        customer_id: userId,
        customer_name: userId,
        subject: message.length > 50 ? message.slice(0, 50) + "..." : message,
        content: message,
        status: "open",
        priority: "normal",
        raw_data: payload,
      })
      .select("id")
      .single();

    if (ticket) {
      await sb.from("cs_ticket_messages").insert({
        ticket_id: ticket.id,
        direction: "inbound",
        sender_name: userId,
        content: message,
        channel: "kakao",
        channel_message_id: callbackUrl || null,
      });
    }
  }

  // 자동 응답 (CS 관리에서 직접 답변 가능하다고 안내)
  return NextResponse.json(
    buildTextResponse("문의가 접수되었습니다. 담당자가 확인 후 빠르게 답변드리겠습니다.")
  );
}
