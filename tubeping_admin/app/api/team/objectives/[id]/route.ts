import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["title", "description", "category", "emoji", "color", "kpis", "checkins", "status", "sort_order"];

// PATCH /api/team/objectives/[id]
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    ALLOWED.forEach((k) => { if (k in body) patch[k] = body[k]; });

    // 점검 메모 추가 단축: { add_checkin: { note, checked_by? } }
    if (body.add_checkin?.note) {
      const sb = getServiceClient();
      const { data: cur } = await sb.from("team_objectives").select("checkins").eq("id", id).single();
      const list = Array.isArray(cur?.checkins) ? cur.checkins : [];
      list.unshift({
        note: body.add_checkin.note,
        checked_at: new Date().toISOString(),
        checked_by: body.add_checkin.checked_by ?? null,
      });
      patch.checkins = list;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no fields" }, { status: 400 });
    }

    const sb = getServiceClient();
    const { data, error } = await sb.from("team_objectives").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ objective: data });
  } catch (e) {
    console.error("[PATCH /api/team/objectives/:id]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE — 소프트(archived) 또는 하드 삭제
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const url = new URL(req.url);
    const hard = url.searchParams.get("hard") === "1";
    const sb = getServiceClient();
    if (hard) {
      const { error } = await sb.from("team_objectives").delete().eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await sb.from("team_objectives").update({ status: "archived" }).eq("id", id);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/team/objectives/:id]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
