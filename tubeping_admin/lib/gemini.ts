/**
 * Gemini 자연어 파서 — 한 줄 업무 메시지를 구조화 JSON으로 변환
 *
 * 사용 예:
 *   parseTaskMessage("내일까지 썸네일 3개")
 *     → { intent: "add", title: "썸네일 3개", due_date: "2026-05-01", tag: "디자인" }
 *
 *   parseTaskMessage("LINK-7F3K")
 *     → { intent: "link", link_code: "LINK-7F3K" }   (Gemini 호출 없이 즉시 처리)
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY ?? "";
if (!apiKey) {
  console.warn("[gemini] GEMINI_API_KEY missing — parseTaskMessage will fail");
}

const genAI = new GoogleGenerativeAI(apiKey);
const MODEL = "gemini-2.5-flash";

export type Intent =
  | "add"
  | "complete"
  | "list"
  | "block"
  | "postpone"
  | "cancel"
  | "link"
  | "unknown";

export type Tag =
  | "디자인"
  | "편집"
  | "미팅"
  | "발주"
  | "라이브"
  | "운영"
  | "문서"
  | "일반";

export interface AddTaskItem {
  title: string;
  due_date?: string;
  tag?: Tag;
  priority?: "low" | "normal" | "high";
}

export interface ParsedIntent {
  intent: Intent;
  title?: string;
  due_date?: string;        // YYYY-MM-DD (KST)
  tag?: Tag;
  priority?: "low" | "normal" | "high";
  target_short_id?: string; // 카드 짧은 ID 마지막 4자
  reason?: string;
  new_due_date?: string;    // postpone 전용
  link_code?: string;       // link 전용
  tasks?: AddTaskItem[];    // intent === "add"일 때 다중 항목
}

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    intent: {
      type: SchemaType.STRING,
      enum: ["add", "complete", "list", "block", "postpone", "cancel", "link", "unknown"],
    },
    title: { type: SchemaType.STRING, nullable: true },
    due_date: { type: SchemaType.STRING, nullable: true, description: "YYYY-MM-DD KST" },
    tag: {
      type: SchemaType.STRING,
      nullable: true,
      enum: ["디자인", "편집", "미팅", "발주", "라이브", "운영", "문서", "일반"],
    },
    priority: { type: SchemaType.STRING, nullable: true, enum: ["low", "normal", "high"] },
    target_short_id: { type: SchemaType.STRING, nullable: true },
    reason: { type: SchemaType.STRING, nullable: true },
    new_due_date: { type: SchemaType.STRING, nullable: true },
    tasks: {
      type: SchemaType.ARRAY,
      nullable: true,
      description: "다중 추가 시 항목 배열. intent='add'이면서 메시지에 여러 항목(번호·줄바꿈·쉼표·세미콜론 분리)이 있을 때만 채움. 단일 1개면 비움.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          due_date: { type: SchemaType.STRING, nullable: true },
          tag: {
            type: SchemaType.STRING,
            nullable: true,
            enum: ["디자인", "편집", "미팅", "발주", "라이브", "운영", "문서", "일반"],
          },
          priority: { type: SchemaType.STRING, nullable: true, enum: ["low", "normal", "high"] },
        },
        required: ["title"],
      },
    },
  },
  required: ["intent"],
};

function todayKST(): string {
  // sv-SE locale gives YYYY-MM-DD
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

const SYSTEM_INSTRUCTION = (today: string) => `당신은 한국어 업무 메시지를 구조화 JSON으로 변환하는 파서입니다.

오늘 날짜(KST): ${today}

[intent 분류]
- add: 새 할 일 추가 ("내일까지 썸네일 3개", "공급사 미팅 잡혔음")
- complete: 완료 처리 ("끝냄", "완료했어", "다 했어", "완료 1234")
- list: 내 할 일 조회 ("목록", "오늘 뭐 있어", "할일", "오늘")
- block: 블록 처리 ("블록", "막힘", "대기 1234 디자인 시안 대기 때문")
- postpone: 일정 미루기 ("미루기 1234 금요일", "연기")
- cancel: 직전 카드 취소 ("취소", "방금 거 취소")
- unknown: 위 어디에도 안 맞음

[날짜 변환 규칙]
- "오늘" → ${today}
- "내일" → +1일
- "모레" → +2일
- "이번 주 금요일" / "금" → 이번 주 또는 가장 가까운 다음 주 금요일
- "다음 주" → +7일 후의 같은 요일
- "5월 5일" / "5/5" → 올해 5월 5일

[태그 규칙]
- 디자인: 썸네일, 배너, 시안, 포스터, 인포그래픽
- 편집: 영상, 컷, 렌더, 인트로
- 미팅: 회의, 통화, 면담
- 발주: 공급사, 주문서, 발주서, 입고
- 라이브: 방송, 리허설
- 운영: 정산, 관리, 자동화
- 문서: 가이드, 매뉴얼, 정책
- 일반: 그 외

[제목 규칙]
- 마감 표현·존댓말 어미·동사 일부 제거 ("내일까지", "해야해", "해주세요" 등)
- 핵심만 남긴 짧은 명사구 ("썸네일 3개 시안", "공급사 미팅")

[ID 매칭]
- 메시지에 4자리 짧은 ID 패턴(예: "1234", "#1234")이 있으면 target_short_id에 4자리만

[다중 항목 처리 — 매우 중요]
사용자가 한 번에 여러 할 일을 보낼 수 있다. 다음 패턴은 **여러 add 항목**으로 분리해서 \`tasks\` 배열로 반환:
- 번호 리스트: "1. 일A\\n2. 일B\\n3. 일C"
- 글머리 기호: "- 일A\\n- 일B" 또는 "• 일A • 일B"
- 줄바꿈만 있는 여러 줄
- 쉼표·세미콜론 분리: "일A, 일B, 일C" (단, 단일 일의 설명일 수도 있으니 명백한 분리만)

다중일 때:
- intent = "add"
- tasks = [{ title, due_date, tag, priority }, ...] 배열에 각 항목 채움
- 최상위 title/due_date는 비워두기
- 각 항목별로 마감/태그 따로 추출

단일이면 \`tasks\`는 비우고 기존처럼 최상위 title/due_date에 채움.

JSON으로만 응답. 설명·코드블록 금지.`;

/**
 * 한 줄 메시지를 의도+payload로 파싱
 */
export async function parseTaskMessage(
  text: string,
  options?: { today?: string }
): Promise<ParsedIntent> {
  const trimmed = text.trim();
  if (!trimmed) return { intent: "unknown" };

  // LINK-XXXX는 정규식으로 즉시 처리 (Gemini 비호출)
  const linkMatch = trimmed.match(/^\s*LINK-([A-Z0-9]{4,8})\s*$/i);
  if (linkMatch) {
    return { intent: "link", link_code: `LINK-${linkMatch[1].toUpperCase()}` };
  }

  const today = options?.today ?? todayKST();

  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      // SchemaType import 한 게 enum이라 캐스트 필요할 수 있음
      responseSchema: responseSchema as never,
      temperature: 0.1,
      maxOutputTokens: 256,
    },
    systemInstruction: SYSTEM_INSTRUCTION(today),
  });

  try {
    const result = await model.generateContent(trimmed);
    const raw = result.response.text();
    const parsed = JSON.parse(raw) as ParsedIntent;
    return parsed;
  } catch (e) {
    console.error("[gemini.parseTaskMessage] failed for:", trimmed, e);
    return { intent: "unknown" };
  }
}

// ─── 멤버 자동 분류 ─────────────────────────────

export interface ClassifyMemberInfo {
  id: string;
  name: string;
  role: string | null;
}

const assigneeSchema = {
  type: SchemaType.OBJECT,
  properties: {
    member_id: { type: SchemaType.STRING },
    confidence: { type: SchemaType.STRING, enum: ["high", "medium", "low"] },
  },
  required: ["member_id"],
};

/**
 * 메시지를 가장 적합한 멤버에게 분류
 * - 메시지에 멤버 이름 명시 → 그 사람
 * - 메시지 내용과 멤버 role이 매칭 → 그 사람
 * - 모호하면 defaultMemberId 반환
 */
export async function classifyAssignee(
  text: string,
  members: ClassifyMemberInfo[],
  defaultMemberId: string
): Promise<string> {
  if (!apiKey || members.length === 0) return defaultMemberId;

  const memberList = members
    .map((m) => `- id=${m.id}  이름=${m.name}  역할=${m.role ?? "미정"}`)
    .join("\n");

  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: assigneeSchema as never,
      temperature: 0.1,
      maxOutputTokens: 128,
    },
    systemInstruction: `다음 업무 메시지를 가장 적합한 담당자에게 분류하세요.

[활성 멤버 목록]
${memberList}

[기본 담당자 (매칭 모호하면 이 사람)]
id=${defaultMemberId}

[분류 규칙 — 우선순위]
1. 메시지에 멤버 이름이 명시 → 그 사람 (예: "김국태 builder MVP" → 김국태)
2. 키워드 ↔ 역할 매칭:
   - "개발/admin/빌더/builder/시스템/자동화/크롬/확장" → 시스템 개발 담당
   - "매출/유튜버/입점/공급사/종합몰/발주" → 종합몰 운영 담당
   - "마케팅/광고/홍보/대행/CTR/SEO" → 마케팅 대행 담당
   - "사업계획서/투자/IR/지원사업" → 기본 담당자(대표)
   - "병원" → 마케팅 대행 또는 기본 담당자
3. 위 규칙에 안 맞으면 기본 담당자 id 반환

JSON으로만 응답.`,
  });

  try {
    const r = await model.generateContent(text);
    const parsed = JSON.parse(r.response.text()) as { member_id: string };
    if (members.some((m) => m.id === parsed.member_id)) return parsed.member_id;
    return defaultMemberId;
  } catch (e) {
    console.error("[classifyAssignee] failed:", e);
    return defaultMemberId;
  }
}

/**
 * 봇 응답 메시지 빌더 — 결과를 사용자에게 보낼 짧은 한국어 텍스트
 */
export function buildBotReply(
  intent: ParsedIntent,
  context: {
    taskShortId?: string;
    taskTitle?: string;
    error?: string;
  }
): string {
  if (context.error) return `⚠️ ${context.error}`;

  switch (intent.intent) {
    case "add":
      return `✅ "${context.taskTitle ?? intent.title}" 추가됨${
        intent.due_date ? ` (마감 ${intent.due_date})` : ""
      }${context.taskShortId ? `\n#${context.taskShortId}` : ""}`;
    case "complete":
      return `✅ "${context.taskTitle ?? "할 일"}" 완료 처리`;
    case "block":
      return `🔴 "${context.taskTitle ?? "할 일"}" 블록${
        intent.reason ? ` — ${intent.reason}` : ""
      }`;
    case "postpone":
      return `⏰ "${context.taskTitle ?? "할 일"}" 마감 ${intent.new_due_date}`;
    case "cancel":
      return `↩️ 방금 추가한 카드 취소`;
    case "link":
      return `🔗 카카오 계정 연결 완료`;
    case "list":
      return `📋 목록 조회`;
    default:
      return `🤔 무슨 일인지 잘 모르겠어요. 예: "내일까지 썸네일 3개"`;
  }
}
