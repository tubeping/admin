/**
 * 네이버톡톡 챗봇 API 클라이언트
 * 문서: https://github.com/navertalk/chatbot-api
 *
 * 각 계정별 auth_key가 다르므로, 호출 시 auth_key를 넘겨야 함
 */

const SEND_URL = "https://gw.talk.naver.com/chatbot/v1/event";

// ─── 타입 ───────────────────────────────────────

/** 웹훅으로 수신되는 이벤트 */
export interface NaverTalkEvent {
  event: "open" | "send" | "friend" | "leave" | "echo";
  user: string; // 사용자 식별값
  textContent?: { text: string; inputType?: string };
  options?: {
    mobile?: boolean;
    inflow?: string;
    referer?: string;
    friend?: boolean;
    set?: boolean;
    appId?: string;
    mobile_app_id?: string;
  };
  standby?: boolean;
}

/** 발송 메시지 */
export interface NaverTalkSendPayload {
  event: "send";
  user: string;
  textContent?: { text: string };
  compositeContent?: {
    compositeList: Array<{
      title?: string;
      description?: string;
      image?: { imageUrl: string };
      buttonList?: Array<{ type: string; title: string; value?: string }>;
    }>;
  };
}

// ─── API 함수 ───────────────────────────────────

/**
 * 네이버톡톡으로 텍스트 메시지 발송
 */
export async function sendNaverTalkMessage(
  authKey: string,
  userId: string,
  text: string
): Promise<{ success: boolean; status: number }> {
  const payload: NaverTalkSendPayload = {
    event: "send",
    user: userId,
    textContent: { text },
  };

  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Authorization: authKey,
    },
    body: JSON.stringify(payload),
  });

  return { success: res.ok, status: res.status };
}

/**
 * 네이버톡톡으로 복합 메시지(카드) 발송
 */
export async function sendNaverTalkComposite(
  authKey: string,
  userId: string,
  compositeList: NaverTalkSendPayload["compositeContent"]
): Promise<{ success: boolean; status: number }> {
  const payload = {
    event: "send",
    user: userId,
    compositeContent: compositeList,
  };

  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Authorization: authKey,
    },
    body: JSON.stringify(payload),
  });

  return { success: res.ok, status: res.status };
}

/**
 * 웹훅 이벤트를 파싱하여 텍스트 추출
 */
export function extractTextFromEvent(event: NaverTalkEvent): string | null {
  if (event.event === "send" && event.textContent?.text) {
    return event.textContent.text;
  }
  return null;
}
