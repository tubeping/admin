/**
 * 채널톡 대화 목록 + 메시지 조회 API
 * GET /api/channeltalk/chats — 대화 목록 (state: opened|closed|snoozed)
 * GET /api/channeltalk/chats?chat_id=xxx — 단건 대화 + 메시지
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listUserChats,
  getUserChat,
  getChatMessages,
  blocksToText,
  type ChannelUserChat,
  type ChannelMessage,
} from "@/lib/channeltalk";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chatId = searchParams.get("chat_id");

  // 단건 대화 + 메시지 조회
  if (chatId) {
    try {
      const [chat, rawMessages] = await Promise.all([
        getUserChat(chatId),
        getChatMessages(chatId, 100),
      ]);

      if (!chat) {
        return NextResponse.json({ error: "대화를 찾을 수 없습니다" }, { status: 404 });
      }

      const messages = rawMessages.map((m: ChannelMessage) => ({
        id: m.id,
        chatId: m.chatId,
        personType: m.personType,
        personId: m.personId,
        text: blocksToText(m.blocks) || m.plainText || "",
        files: m.files || [],
        createdAt: m.createdAt,
      }));

      return NextResponse.json({ chat, messages });
    } catch (err) {
      return NextResponse.json(
        { error: `채널톡 조회 실패: ${err instanceof Error ? err.message : "unknown"}` },
        { status: 500 }
      );
    }
  }

  // 대화 목록 조회
  const state = (searchParams.get("state") || "opened") as "opened" | "closed" | "snoozed";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

  try {
    const result = await listUserChats(state, limit);
    const chats = (result.userChats || []).map((c: ChannelUserChat) => ({
      id: c.id,
      state: c.state,
      assigneeId: c.assigneeId,
      userName: c.user?.name || c.user?.id || "고객",
      userEmail: c.user?.email,
      userPhone: c.user?.mobileNumber,
      tags: c.tags || [],
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    return NextResponse.json({ chats, total: chats.length, next: result.next });
  } catch (err) {
    return NextResponse.json(
      { error: `채널톡 목록 조회 실패: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}
