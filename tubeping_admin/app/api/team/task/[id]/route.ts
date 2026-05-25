import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { updateTaskStatus, postponeTask, deleteTask } from "@/lib/teamWorkboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/team/task/[id]
//   body: { status?, due_date?, block_reason?, memo?, title? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = await req.json();

    if (body.status) {
      const task = await updateTaskStatus(id, body.status, body.block_reason);
      return NextResponse.json({ task });
    }

    if (body.due_date) {
      const task = await postponeTask(id, body.due_date);
      return NextResponse.json({ task });
    }

    // 그 외 (memo, title, tag, priority) 자유 패치
    const sb = getServiceClient();
    const patch: Record<string, unknown> = {};
    ["title", "memo", "tag", "priority", "block_reason"].forEach((k) => {
      if (k in body) patch[k] = body[k];
    });
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no fields" }, { status: 400 });
    }
    const { data, error } = await sb
      .from("team_tasks")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ task: data });
  } catch (e) {
    console.error("[PATCH /api/team/task/:id]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/team/task/[id]
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteTask(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/team/task/:id]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
