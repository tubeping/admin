/**
 * Gmail API 클라이언트 — 채널톡 알림 이메일 감지용
 * OAuth2 크레덴셜로 master@shinsananalytics.com 메일함 조회
 */

import "server-only";
import { google } from "googleapis";
import { env } from "./env.server";

const CLIENT_ID = env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = env.GMAIL_CLIENT_SECRET;
const REFRESH_TOKEN = env.GMAIL_REFRESH_TOKEN;

function getAuth() {
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({ refresh_token: REFRESH_TOKEN });
  return auth;
}

export interface ChannelTalkEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  channelName: string | null;
  customerName: string | null;
  messagePreview: string | null;
  chatLink: string | null;
  isRead: boolean;
}

/**
 * 채널톡 알림 이메일 검색
 * @param maxResults 최대 결과 수
 * @param afterDate 이 날짜 이후만 (YYYY/MM/DD)
 */
export async function searchChannelTalkEmails(
  maxResults = 10,
  afterDate?: string
): Promise<ChannelTalkEmail[]> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return [];
  }

  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });

  let query = "from:feedback@channel.io subject:(고객 OR 응대 OR 메시지)";
  if (afterDate) query += ` after:${afterDate}`;

  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = res.data.messages || [];
  const emails: ChannelTalkEmail[] = [];

  for (const msg of messages) {
    try {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "";
      const from = headers.find((h) => h.name === "From")?.value || "";
      const date = headers.find((h) => h.name === "Date")?.value || "";
      const snippet = detail.data.snippet || "";
      const isRead = !(detail.data.labelIds || []).includes("UNREAD");

      // [채널명] 파싱
      const channelMatch = subject.match(/^\[(.+?)\]/);
      const channelName = channelMatch ? channelMatch[1] : null;

      // 고객 이름 파싱 (snippet에서)
      const customerMatch = snippet.match(/(.+?)님이\s*\d+분/);
      const customerName = customerMatch ? customerMatch[1].trim() : null;

      // 메시지 미리보기 파싱
      const msgMatch = snippet.match(/\d{2}:\d{2}\s*(?:AM|PM)?\s*(.+?)(?:\s*확인|$)/);
      const messagePreview = msgMatch ? msgMatch[1].trim() : snippet.slice(0, 100);

      emails.push({
        id: msg.id!,
        threadId: msg.threadId || msg.id!,
        subject,
        from,
        date,
        snippet,
        channelName,
        customerName,
        messagePreview,
        chatLink: null,
        isRead,
      });
    } catch {
      // 개별 메일 조회 실패 무시
    }
  }

  return emails;
}

/**
 * 읽지 않은 채널톡 알림 수 조회
 */
export async function getUnreadChannelTalkCount(): Promise<number> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return 0;
  }

  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });

  const res = await gmail.users.messages.list({
    userId: "me",
    q: "from:feedback@channel.io subject:(고객 OR 응대) is:unread",
    maxResults: 50,
  });

  return res.data.resultSizeEstimate || 0;
}
