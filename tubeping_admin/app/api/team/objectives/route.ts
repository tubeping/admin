import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/team/objectives
export async function GET() {
  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("team_objectives")
      .select("*")
      .neq("status", "archived")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ objectives: data ?? [] });
  } catch (e) {
    console.error("[GET /api/team/objectives]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/team/objectives
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.title) return NextResponse.json({ error: "title required" }, { status: 400 });
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("team_objectives")
      .insert({
        title: body.title,
        description: body.description ?? null,
        category: body.category ?? null,
        emoji: body.emoji ?? "🎯",
        color: body.color ?? "gray",
        kpis: body.kpis ?? [],
        checkins: body.checkins ?? [],
        sort_order: body.sort_order ?? 0,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ objective: data });
  } catch (e) {
    console.error("[POST /api/team/objectives]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
