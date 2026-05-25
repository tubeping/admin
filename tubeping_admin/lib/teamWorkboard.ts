/**
 * 업무보드 DB 헬퍼 — Supabase 접근 로직 한 곳에 모음
 * 웹 입력창과 카카오 webhook이 공통으로 사용
 */

import { getServiceClient } from "./supabase";

// ─── 타입 ─────────────────────────────────────────

export interface TeamMember {
  id: string;
  name: string;
  role: string | null;
  emoji: string;
  color: string;
  goal_text: string | null;
  goal_target: number | null;
  goal_current: number;
  goal_unit: string | null;
  kakao_user_id: string | null;
  kakao_link_code: string | null;
  kakao_link_code_expires_at: string | null;
  kakao_linked_at: string | null;
  status: "active" | "inactive";
  sort_order: number;
}

export type TaskStatus = "doing" | "wait" | "block" | "done";

export interface TeamTask {
  id: string;
  member_id: string;
  title: string;
  due_date: string | null;
  priority: "low" | "normal" | "high";
  tag: string | null;
  status: TaskStatus;
  memo: string | null;
  block_reason: string | null;
  source: string;
  source_message_id: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

// ─── 멤버 ─────────────────────────────────────────

export async function listActiveMembers(): Promise<TeamMember[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("team_members")
    .select("*")
    .eq("status", "active")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TeamMember[];
}

export async function getMemberByKakaoUserId(kakaoUserId: string): Promise<TeamMember | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("team_members")
    .select("*")
    .eq("kakao_user_id", kakaoUserId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TeamMember | null;
}

export async function getMemberByLinkCode(code: string): Promise<TeamMember | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("team_members")
    .select("*")
    .eq("kakao_link_code", code)
    .gt("kakao_link_code_expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TeamMember | null;
}

export async function linkKakaoToMember(memberId: string, kakaoUserId: string): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb
    .from("team_members")
    .update({
      kakao_user_id: kakaoUserId,
      kakao_linked_at: new Date().toISOString(),
      kakao_link_code: null,
      kakao_link_code_expires_at: null,
    })
    .eq("id", memberId);
  if (error) throw error;
}

/**
 * 새 LINK-XXXX 코드 생성 (24시간 유효)
 */
export async function issueLinkCode(memberId: string): Promise<string> {
  const code = `LINK-${randomCode(6)}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const sb = getServiceClient();
  const { error } = await sb
    .from("team_members")
    .update({
      kakao_link_code: code,
      kakao_link_code_expires_at: expiresAt,
    })
    .eq("id", memberId);
  if (error) throw error;
  return code;
}

function randomCode(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O/1/I 제외
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

// ─── 카드 ─────────────────────────────────────────

export interface CreateTaskInput {
  memberId: string;
  title: string;
  dueDate?: string | null;
  tag?: string | null;
  priority?: "low" | "normal" | "high";
  source?: "web" | "kakao" | "telegram";
  sourceMessageId?: string | null;
}

export async function createTask(input: CreateTaskInput): Promise<TeamTask> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("team_tasks")
    .insert({
      member_id: input.memberId,
      title: input.title,
      due_date: input.dueDate ?? null,
      tag: input.tag ?? null,
      priority: input.priority ?? "normal",
      source: input.source ?? "web",
      source_message_id: input.sourceMessageId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as TeamTask;
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  blockReason?: string | null
): Promise<TeamTask> {
  const sb = getServiceClient();
  const patch: Record<string, unknown> = { status };
  if (status === "block") patch.block_reason = blockReason ?? null;
  const { data, error } = await sb
    .from("team_tasks")
    .update(patch)
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data as TeamTask;
}

export async function postponeTask(taskId: string, newDueDate: string): Promise<TeamTask> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("team_tasks")
    .update({ due_date: newDueDate })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data as TeamTask;
}

export async function deleteTask(taskId: string): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb.from("team_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

/**
 * 같은 멤버 내에서 카드 ID 끝부분(short_id)으로 검색
 * 사용자가 카톡으로 "완료 1234" 같이 보낼 때 사용
 */
export async function findTaskByShortId(
  memberId: string,
  shortId: string
): Promise<TeamTask | null> {
  const cleaned = shortId.replace(/^#/, "").trim().toLowerCase();
  if (cleaned.length < 3) return null;
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("team_tasks")
    .select("*")
    .eq("member_id", memberId)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const found = (data ?? []).find((t) => (t.id as string).toLowerCase().endsWith(cleaned));
  return (found ?? null) as TeamTask | null;
}

export async function getMostRecentDoingTask(memberId: string): Promise<TeamTask | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("team_tasks")
    .select("*")
    .eq("member_id", memberId)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TeamTask | null;
}

export async function listOpenTasksForMember(memberId: string): Promise<TeamTask[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("team_tasks")
    .select("*")
    .eq("member_id", memberId)
    .neq("status", "done")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as TeamTask[];
}

// ─── 카카오 메시지 로그 ───────────────────────────

export interface LogKakaoInput {
  kakaoUserId: string;
  memberId?: string | null;
  rawText: string;
  parsedIntent?: string | null;
  parsedPayload?: unknown;
  resultingTaskId?: string | null;
  botResponse?: string | null;
  ok?: boolean;
  errorMessage?: string | null;
}

export async function logKakaoMessage(input: LogKakaoInput): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb.from("kakao_messages").insert({
    kakao_user_id: input.kakaoUserId,
    member_id: input.memberId ?? null,
    raw_text: input.rawText,
    parsed_intent: input.parsedIntent ?? null,
    parsed_payload: input.parsedPayload ?? null,
    resulting_task_id: input.resultingTaskId ?? null,
    bot_response: input.botResponse ?? null,
    ok: input.ok ?? true,
    error_message: input.errorMessage ?? null,
  });
  if (error) console.error("[logKakaoMessage] failed:", error);
}

// ─── 헬퍼 ─────────────────────────────────────────

export function shortIdOf(taskId: string, len = 4): string {
  return taskId.slice(-len).toUpperCase();
}
