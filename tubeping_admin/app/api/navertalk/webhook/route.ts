/**
 * 네이버톡톡 웹훅 수신 API
 * POST /api/navertalk/webhook?channel_id={cs_channel_id}
 *
 * 네이버톡톡 파트너센터에서 이 URL을 웹훅으로 등록:
 * https://tubepingadmin.vercel.app/admin/api/navertalk/webhook?channel_id=xxx
 *
 * 수신 이벤트: open, send, friend, leave, echo
 * → send 이벤트만 cs_tickets에 저장
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { type NaverTalkEvent, extractTextFromEvent } from "@/lib/navertalk";

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  const channelId = req.nextUrl.searchParams.get("channel_id");

  let body: NaverTalkEvent;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // open, friend, leave, echo는 200만 반환
  if (body.event !== "send") {
    return new NextResponse("ok", { status: 200 });
  }

  const text = extractTextFromEvent(body);
  if (!text) {
    return new NextResponse("ok", { status: 200 });
  }

  // 채널 정보 조회
  let storeId: string | null = null;
  let csChannelId: string | null = channelId;

  if (channelId) {
    const { data: ch } = await sb
      .from("cs_channels")
      .select("id, store_id, name")
      .eq("id", channelId)
      .single();

    if (ch) {
      storeId = ch.store_id;
      csChannelId = ch.id;

      // 마지막 이벤트 시각 + 카운터 업데이트
      await sb
        .from("cs_channels")
        .update({ last_event_at: new Date().toISOString(), total_chats: (ch as Record<string, number>).total_chats + 1 })
        .eq("id", ch.id);
    }
  }

  // 기존 대화가 있는지 확인 (같은 유저 + 같은 채널)
  const { data: existing } = await sb
    .from("cs_tickets")
    .select("id, status")
    .eq("channel", "naver_talk")
    .eq("customer_id", body.user)
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
      sender_name: body.user,
      content: text,
      channel: "naver_talk",
    });

    // 티켓 상태를 다시 open으로 (고객이 추가 메시지 보냄)
    if (existing.status === "in_progress") {
      await sb.from("cs_tickets").update({ status: "open" }).eq("id", existing.id);
    }
  } else {
    // 새 티켓 생성
    const { data: ticket } = await sb
      .from("cs_tickets")
      .insert({
        store_id: storeId,
        cs_channel_id: csChannelId,
        channel: "naver_talk",
        channel_ticket_id: `nvtalk_${body.user}_${Date.now()}`,
        ticket_type: "inquiry",
        customer_id: body.user,
        customer_name: body.user,
        subject: text.length > 50 ? text.slice(0, 50) + "..." : text,
        content: text,
        status: "open",
        priority: "normal",
        raw_data: body,
      })
      .select("id")
      .single();

    if (ticket) {
      await sb.from("cs_ticket_messages").insert({
        ticket_id: ticket.id,
        direction: "inbound",
        sender_name: body.user,
        content: text,
        channel: "naver_talk",
      });
    }
  }

  // 네이버톡톡은 200을 반환해야 성공 처리
  return new NextResponse("ok", { status: 200 });
}
