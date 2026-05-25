/**
 * CS 티켓 API — 조회 + 상태 변경
 * GET  /api/cs — 티켓 목록 (필터: channel, status, store_id, priority)
 * PATCH /api/cs — 티켓 일괄 수정 (status, assigned_to, priority, memo)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  const { searchParams } = req.nextUrl;

  const channel = searchParams.get("channel");
  const status = searchParams.get("status");
  const storeId = searchParams.get("store_id");
  const priority = searchParams.get("priority");
  const ticketType = searchParams.get("ticket_type");
  const keyword = searchParams.get("keyword");
  const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 1000);

  let query = sb
    .from("cs_tickets")
    .select("*, stores(name, mall_id)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (channel) query = query.eq("channel", channel);
  if (status) query = query.eq("status", status);
  if (storeId) query = query.eq("store_id", storeId);
  if (priority) query = query.eq("priority", priority);
  if (ticketType) query = query.eq("ticket_type", ticketType);
  if (keyword) query = query.or(`subject.ilike.%${keyword}%,content.ilike.%${keyword}%,customer_name.ilike.%${keyword}%`);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tickets: data || [], total: data?.length || 0 });
}

export async function PATCH(req: NextRequest) {
  const sb = getServiceClient();
  const { ids, updates } = await req.json();

  if (!ids?.length || !updates) {
    return NextResponse.json({ error: "ids와 updates 필요" }, { status: 400 });
  }

  const allowed = ["status", "priority", "assigned_to", "memo", "reply", "replied_at", "replied_by"];
  const clean: Record<string, unknown> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) clean[key] = updates[key];
  }

  const { error } = await sb
    .from("cs_tickets")
    .update(clean)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, updated: ids.length });
}
