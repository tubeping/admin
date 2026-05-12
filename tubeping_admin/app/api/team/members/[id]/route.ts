import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = [
  "name", "role", "emoji", "color",
  "goal_text", "goal_target", "goal_current", "goal_unit",
  "status", "sort_order",
];

// PATCH /api/team/members/[id]
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    ALLOWED.forEach((k) => { if (k in body) patch[k] = body[k]; });
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no fields" }, { status: 400 });
    }
    const sb = getServiceClient();
    const { data, error } = await sb.from("team_members").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ member: data });
  } catch (e) {
    console.error("[PATCH /api/team/members/:id]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/team/members/[id] — soft delete (status = inactive)
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const sb = getServiceClient();
    const { error } = await sb.from("team_members").update({ status: "inactive" }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/team/members/:id]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
