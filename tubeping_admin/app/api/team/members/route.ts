import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { listActiveMembers } from "@/lib/teamWorkboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/team/members — 활성 멤버 + 각자 미완료 카드 수
export async function GET() {
  try {
    const members = await listActiveMembers();

    // 카드 카운트 (멤버별)
    const sb = getServiceClient();
    const { data: counts } = await sb
      .from("team_tasks")
      .select("member_id, status");

    const tally = new Map<string, { doing: number; wait: number; block: number }>();
    (counts ?? []).forEach((row) => {
      const t = tally.get(row.member_id) ?? { doing: 0, wait: 0, block: 0 };
      if (row.status === "doing") t.doing++;
      else if (row.status === "wait") t.wait++;
      else if (row.status === "block") t.block++;
      tally.set(row.member_id, t);
    });

    return NextResponse.json({
      members: members.map((m) => ({
        ...m,
        counts: tally.get(m.id) ?? { doing: 0, wait: 0, block: 0 },
      })),
    });
  } catch (e) {
    console.error("[GET /api/team/members]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/team/members — 새 멤버 추가
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, role, emoji, color, goal_text, goal_target, goal_current, goal_unit } = body;
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const sb = getServiceClient();
    const { data, error } = await sb
      .from("team_members")
      .insert({
        name,
        role: role ?? null,
        emoji: emoji ?? "👤",
        color: color ?? "sky",
        goal_text: goal_text ?? null,
        goal_target: goal_target ?? null,
        goal_current: goal_current ?? 0,
        goal_unit: goal_unit ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ member: data });
  } catch (e) {
    console.error("[POST /api/team/members]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
