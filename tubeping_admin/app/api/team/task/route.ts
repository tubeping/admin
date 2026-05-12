import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { createTask } from "@/lib/teamWorkboard";
import { parseTaskMessage } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/team/task — 카드 목록 (선택적으로 member_id 필터)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const memberId = url.searchParams.get("member_id");
    const includeDone = url.searchParams.get("include_done") === "1";

    const sb = getServiceClient();
    let q = sb.from("team_tasks").select("*").order("due_date", { ascending: true, nullsFirst: false });
    if (memberId) q = q.eq("member_id", memberId);
    if (!includeDone) q = q.neq("status", "done");

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ tasks: data ?? [] });
  } catch (e) {
    console.error("[GET /api/team/task]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/team/task
//   A) { member_id, title, due_date?, tag?, priority?, source? } — 직접 입력
//   B) { member_id, raw_text, source? }                          — 자연어 파싱
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const memberId: string | undefined = body.member_id;
    if (!memberId) return NextResponse.json({ error: "member_id required" }, { status: 400 });

    let title: string | undefined = body.title;
    let dueDate: string | null = body.due_date ?? null;
    let tag: string | null = body.tag ?? null;
    let priority: "low" | "normal" | "high" | undefined = body.priority;
    const source = (body.source as "web" | "kakao" | "telegram") ?? "web";

    // 자연어 입력이면 Gemini로 파싱
    if (!title && body.raw_text) {
      const parsed = await parseTaskMessage(String(body.raw_text));
      if (parsed.intent !== "add" || !parsed.title) {
        return NextResponse.json(
          { error: "could_not_parse_as_task", parsed },
          { status: 422 }
        );
      }
      title = parsed.title;
      dueDate = parsed.due_date ?? null;
      tag = parsed.tag ?? null;
      priority = parsed.priority ?? "normal";
    }

    if (!title) {
      return NextResponse.json({ error: "title or raw_text required" }, { status: 400 });
    }

    const task = await createTask({
      memberId,
      title,
      dueDate,
      tag,
      priority,
      source,
      sourceMessageId: body.source_message_id ?? null,
    });

    return NextResponse.json({ task });
  } catch (e) {
    console.error("[POST /api/team/task]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
