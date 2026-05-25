import { NextResponse } from "next/server";
import {
  KakaoSkillPayload,
  buildTextResponse,
  extractFromPayload,
} from "@/lib/kakaotalk";
import {
  getMemberByKakaoUserId,
  getMemberByLinkCode,
  linkKakaoToMember,
  createTask,
  updateTaskStatus,
  postponeTask,
  findTaskByShortId,
  getMostRecentDoingTask,
  listOpenTasksForMember,
  listActiveMembers,
  logKakaoMessage,
  shortIdOf,
  TeamTask,
} from "@/lib/teamWorkboard";
import { parseTaskMessage, buildBotReply, classifyAssignee } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 메시지를 줄/번호 리스트 단위로 분리
 * - 줄바꿈 다수 → 각 줄을 항목으로
 * - 한 줄에 "1. A 2. B 3. C" → 번호 패턴으로 split
 * - "- A / - B" 글머리 기호도 분리
 * 단일 항목이면 [원문] 그대로
 */
function splitMultiItems(text: string): string[] {
  // 1) 줄바꿈으로 1차 분리
  let lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 2) 한 줄인데 "1. ... 2. ..." 패턴 다수면 추가 분리
  if (lines.length === 1 && /\b\d+[.)]\s/.test(lines[0])) {
    const matches = lines[0].match(/\d+[.)]\s/g);
    if (matches && matches.length >= 2) {
      lines = lines[0].split(/(?=\s\d+[.)]\s)|(?<=^)\s*(?=\d+[.)]\s)/).map((l) => l.trim()).filter(Boolean);
    }
  }

  // 3) prefix 제거 ("1. ", "2) ", "- ", "• ", "* ")
  const cleaned = lines.map((l) => l.replace(/^(\d+[.)]\s*|[-•*]\s*)/, "").trim()).filter(Boolean);

  return cleaned.length > 0 ? cleaned : [text.trim()];
}

/**
 * POST /api/team/kakao
 *
 * 카카오 i 오픈빌더 fallback 블록의 스킬 서버 엔드포인트
 * - 모든 메시지를 받아 자연어 파싱 후 카드 생성/완료/조회 처리
 */
export async function POST(req: Request) {
  let payload: KakaoSkillPayload | null = null;
  try {
    payload = (await req.json()) as KakaoSkillPayload;
    const { userId, message } = extractFromPayload(payload);

    // ─ 1. LINK 코드 우선 처리 (즉시) ────────
    const linkMatch = message.trim().match(/^\s*LINK-([A-Z0-9]{4,8})\s*$/i);
    if (linkMatch) {
      const code = `LINK-${linkMatch[1].toUpperCase()}`;
      const target = await getMemberByLinkCode(code);
      if (!target) {
        const reply = `⚠️ 코드가 만료되었거나 잘못됐어요.\nadmin에서 새 코드를 발급받아주세요.`;
        await logKakaoMessage({ kakaoUserId: userId, rawText: message, parsedIntent: "link", botResponse: reply, ok: false });
        return NextResponse.json(buildTextResponse(reply));
      }
      await linkKakaoToMember(target.id, userId);
      const reply = `🔗 ${target.name}님 카카오 연결 완료!\n앞으로 한 줄씩 보내시면 업무보드에 자동으로 들어가요.\n예) "내일까지 썸네일 3개"`;
      await logKakaoMessage({ kakaoUserId: userId, memberId: target.id, rawText: message, parsedIntent: "link", botResponse: reply });
      return NextResponse.json(buildTextResponse(reply));
    }

    // ─ 2. 멤버 조회 ────────────────────────
    const member = await getMemberByKakaoUserId(userId);
    if (!member) {
      const reply = `👋 처음이시네요!\nadmin에서 본인 프로필의 [카톡 연결] 버튼을 눌러 코드(LINK-XXXX)를 발급받고 채널에 보내주세요.`;
      await logKakaoMessage({ kakaoUserId: userId, rawText: message, parsedIntent: "unknown", botResponse: reply, ok: false });
      return NextResponse.json(buildTextResponse(reply));
    }

    // ─ 3. 다중 항목 사전 분리 ─────────────
    const items = splitMultiItems(message);

    // 다중 항목이면 각 줄을 단일 add로 병렬 파싱 + 멤버 자동 분류 → 카드 생성
    if (items.length > 1) {
      const allMembers = await listActiveMembers();
      const memberInfos = allMembers.map((m) => ({ id: m.id, name: m.name, role: m.role }));

      const [parsedList, assignedIds] = await Promise.all([
        Promise.all(items.map((line) => parseTaskMessage(line))),
        Promise.all(items.map((line) => classifyAssignee(line, memberInfos, member.id))),
      ]);

      const created: { id: string; title: string; assigneeId: string; assigneeName: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const p = parsedList[i];
        const title = p.title ?? items[i];
        if (!title) continue;
        const aId = assignedIds[i];
        const assignee = allMembers.find((m) => m.id === aId) ?? member;
        const t = await createTask({
          memberId: assignee.id,
          title,
          dueDate: p.due_date ?? null,
          tag: p.tag ?? null,
          priority: p.priority ?? "normal",
          source: "kakao",
          sourceMessageId: payload.action?.id ?? null,
        });
        created.push({ id: t.id, title: t.title, assigneeId: assignee.id, assigneeName: assignee.name });
      }

      let reply: string;
      if (created.length === 0) {
        reply = `🤔 추가할 항목을 못 찾았어요.`;
      } else {
        // 담당자별 그룹핑 응답
        const byMember = new Map<string, string[]>();
        for (const c of created) {
          const list = byMember.get(c.assigneeName) ?? [];
          list.push(`  • ${c.title}  #${shortIdOf(c.id)}`);
          byMember.set(c.assigneeName, list);
        }
        const lines: string[] = [`✅ ${created.length}건 자동 분배`];
        for (const [name, rows] of byMember) {
          lines.push(`\n👤 ${name} (${rows.length}건)`);
          lines.push(...rows);
        }
        reply = lines.join("\n");
      }

      await logKakaoMessage({
        kakaoUserId: userId,
        memberId: member.id,
        rawText: message,
        parsedIntent: "add_multi",
        parsedPayload: { items, parsedList, assignedIds },
        resultingTaskId: created[0]?.id ?? null,
        botResponse: reply,
      });
      return NextResponse.json(buildTextResponse(reply));
    }

    // 단일 항목: 기존 자연어 파싱
    const parsed = await parseTaskMessage(message);
    let reply = "";
    let resultingTaskId: string | null = null;

    switch (parsed.intent) {
      case "add": {
        if (!parsed.title) {
          reply = `🤔 어떤 일을 추가할까요? 예: "내일까지 썸네일 3개"`;
          break;
        }
        // 단일 항목도 멤버 자동 분류 (모호하면 본인이 기본)
        const allMembers = await listActiveMembers();
        const memberInfos = allMembers.map((m) => ({ id: m.id, name: m.name, role: m.role }));
        const assigneeId = await classifyAssignee(message, memberInfos, member.id);
        const assignee = allMembers.find((m) => m.id === assigneeId) ?? member;

        const task = await createTask({
          memberId: assignee.id,
          title: parsed.title,
          dueDate: parsed.due_date ?? null,
          tag: parsed.tag ?? null,
          priority: parsed.priority ?? "normal",
          source: "kakao",
          sourceMessageId: payload.action?.id ?? null,
        });
        resultingTaskId = task.id;
        const isOther = assignee.id !== member.id;
        reply = `✅ "${task.title}" 추가됨${task.due_date ? ` (마감 ${task.due_date})` : ""}${isOther ? `\n👤 ${assignee.name}님 카드` : ""}\n#${shortIdOf(task.id)}`;
        break;
      }

      case "complete": {
        const target = parsed.target_short_id
          ? await findTaskByShortId(member.id, parsed.target_short_id)
          : await getMostRecentDoingTask(member.id);
        if (!target) {
          reply = `🤔 완료할 카드를 못 찾았어요. "목록"이라고 보내면 보여드려요.`;
          break;
        }
        const updated = await updateTaskStatus(target.id, "done");
        resultingTaskId = updated.id;
        reply = `✅ "${updated.title}" 완료\n#${shortIdOf(updated.id)}`;
        break;
      }

      case "block": {
        const target = parsed.target_short_id
          ? await findTaskByShortId(member.id, parsed.target_short_id)
          : await getMostRecentDoingTask(member.id);
        if (!target) {
          reply = `🤔 어떤 카드를 블록할지 못 찾았어요.`;
          break;
        }
        const updated = await updateTaskStatus(target.id, "block", parsed.reason ?? null);
        resultingTaskId = updated.id;
        reply = `🔴 "${updated.title}" 블록${parsed.reason ? ` — ${parsed.reason}` : ""}`;
        break;
      }

      case "postpone": {
        const target = parsed.target_short_id
          ? await findTaskByShortId(member.id, parsed.target_short_id)
          : await getMostRecentDoingTask(member.id);
        if (!target || !parsed.new_due_date) {
          reply = `🤔 어떤 카드를 언제로 미룰지 못 찾았어요.`;
          break;
        }
        const updated = await postponeTask(target.id, parsed.new_due_date);
        resultingTaskId = updated.id;
        reply = `⏰ "${updated.title}" 마감 ${parsed.new_due_date}로 변경`;
        break;
      }

      case "list": {
        const open = await listOpenTasksForMember(member.id);
        if (open.length === 0) {
          reply = `📭 ${member.name}님 오늘 할 일 없어요!`;
        } else {
          const lines = open.slice(0, 10).map((t: TeamTask) => {
            const dot = t.status === "doing" ? "🟢" : t.status === "wait" ? "🟡" : "🔴";
            const due = t.due_date ? ` ~${t.due_date.slice(5)}` : "";
            return `${dot} ${t.title}${due}  #${shortIdOf(t.id)}`;
          });
          reply = `📋 ${member.name}님 (${open.length}건)\n` + lines.join("\n");
        }
        break;
      }

      case "cancel": {
        const recent = await getMostRecentDoingTask(member.id);
        if (!recent) {
          reply = `🤔 취소할 최근 카드가 없어요.`;
          break;
        }
        await updateTaskStatus(recent.id, "done"); // soft cancel via complete
        // 정확한 취소는 별도 컬럼이 필요하므로 일단 완료로 처리
        resultingTaskId = recent.id;
        reply = `↩️ "${recent.title}" 카드 정리 (완료 처리)`;
        break;
      }

      default:
        reply = `🤔 무슨 의미인지 잘 모르겠어요.\n예) "내일까지 썸네일 3개" / "끝냄" / "목록"`;
    }

    await logKakaoMessage({
      kakaoUserId: userId,
      memberId: member.id,
      rawText: message,
      parsedIntent: parsed.intent,
      parsedPayload: parsed,
      resultingTaskId,
      botResponse: reply,
    });

    return NextResponse.json(buildTextResponse(reply));
  } catch (e) {
    console.error("[POST /api/team/kakao]", e);
    if (payload) {
      const { userId, message } = extractFromPayload(payload);
      await logKakaoMessage({
        kakaoUserId: userId,
        rawText: message,
        botResponse: `⚠️ 처리 중 오류가 발생했어요.`,
        ok: false,
        errorMessage: String(e),
      });
    }
    return NextResponse.json(buildTextResponse("⚠️ 처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요."));
  }
}
