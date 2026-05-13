/**
 * 채널톡 Open API 클라이언트
 * 인증: x-access-key + x-access-secret 헤더
 * 문서: https://developers.channel.io/docs/
 */

import { env } from "./env.server";

const ACCESS_KEY = env.CHANNELTALK_ACCESS_KEY;
const ACCESS_SECRET = env.CHANNELTALK_ACCESS_SECRET;
const BASE_URL = "https://api.channel.io/open";

function headers(): Record<string, string> {
  return {
    "x-access-key": ACCESS_KEY,
    "x-access-secret": ACCESS_SECRET,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * 채널톡 API 범용 호출
 */
export async function channelFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  return fetch(url, { ...options, headers: { ...headers(), ...options?.headers } });
}

// ─── 타입 ───────────────────────────────────────

export interface ChannelUserChat {
  id: string;
  channelId: string;
  state: "opened" | "closed" | "snoozed";
  assigneeId?: string;
  createdAt: number; // unix ms
  updatedAt: number;
  tags?: string[];
  name?: string;
  review?: { rate: number; comment?: string };
  user?: {
    id: string;
    name?: string;
    email?: string;
    mobileNumber?: string;
    profile?: Record<string, unknown>;
  };
}

export interface ChannelMessage {
  id: string;
  chatId: string;
  personType: "user" | "manager" | "bot";
  personId?: string;
  createdAt: number;
  blocks?: Array<{ type: string; value?: string }>;
  plainText?: string;
  files?: Array<{ url: string; name: string }>;
}

// ─── API 함수 ───────────────────────────────────

/**
 * 채팅 목록 조회
 */
export async function listUserChats(
  state: "opened" | "closed" | "snoozed" = "opened",
  limit = 100
): Promise<{ userChats: ChannelUserChat[]; next?: string }> {
  const params = new URLSearchParams({
    state,
    sortOrder: "desc",
    limit: String(limit),
  });

  const res = await channelFetch(`/v5/user-chats?${params}`);
  if (!res.ok) throw new Error(`채널톡 채팅 목록 조회 실패: ${res.status}`);
  return res.json();
}

/**
 * 모든 상태의 채팅을 페이지네이션으로 전부 수집
 */
export async function listAllUserChats(
  state: "opened" | "closed" | "snoozed" = "opened",
  maxPages = 5
): Promise<ChannelUserChat[]> {
  const all: ChannelUserChat[] = [];
  let since: string | undefined;

  for (let i = 0; i < maxPages; i++) {
    const params = new URLSearchParams({
      state,
      sortOrder: "desc",
      limit: "100",
    });
    if (since) params.set("since", since);

    const res = await channelFetch(`/v5/user-chats?${params}`);
    if (!res.ok) break;

    const data = await res.json();
    const chats: ChannelUserChat[] = data.userChats || [];
    if (chats.length === 0) break;

    all.push(...chats);
    since = data.next;
    if (!since) break;
  }

  return all;
}

/**
 * 단건 채팅 조회
 */
export async function getUserChat(
  userChatId: string
): Promise<ChannelUserChat | null> {
  const res = await channelFetch(`/v5/user-chats/${userChatId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.userChat || null;
}

/**
 * 채팅 메시지 조회
 */
export async function getChatMessages(
  userChatId: string,
  limit = 50
): Promise<ChannelMessage[]> {
  const params = new URLSearchParams({
    sortOrder: "desc",
    limit: String(limit),
  });

  const res = await channelFetch(`/v5/user-chats/${userChatId}/messages?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  return data.messages || [];
}

/**
 * 채팅에 봇 메시지 전송 (답변)
 */
export async function sendMessage(
  userChatId: string,
  text: string,
  botName = "TubePing"
): Promise<boolean> {
  const res = await channelFetch(
    `/v4/user-chats/${userChatId}/messages?botName=${encodeURIComponent(botName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        blocks: [{ type: "text", value: text }],
      }),
    }
  );
  return res.ok;
}

/**
 * 메시지 blocks를 plain text로 변환
 */
export function blocksToText(
  blocks?: Array<{ type: string; value?: string }>
): string {
  if (!blocks?.length) return "";
  return blocks
    .filter((b) => b.type === "text" && b.value)
    .map((b) => b.value)
    .join("\n");
}
