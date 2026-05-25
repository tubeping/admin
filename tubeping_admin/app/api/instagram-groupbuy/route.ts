/**
 * 인스타 공동구매 DM 트래킹 API
 * GET  /api/instagram-groupbuy        — 목록 조회 (필터: status, keyword, product)
 * POST /api/instagram-groupbuy        — 신규 제안 등록
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const ALLOWED_STATUSES = [
  "sent", "no_reply", "interested", "negotiating",
  "accepted", "rejected", "running", "done",
];

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  const { searchParams } = req.nextUrl;

  const status = searchParams.get("status");
  const keyword = searchParams.get("keyword");
  const product = searchParams.get("product");
  const limit = parseInt(searchParams.get("limit") || "500");

  let query = sb
    .from("instagram_groupbuy_outreach")
    .select("*")
    .order("proposed_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (product) query = query.eq("product_name", product);
  if (keyword) {
    query = query.or(
      `ig_username.ilike.%${keyword}%,ig_full_name.ilike.%${keyword}%,product_name.ilike.%${keyword}%,memo.ilike.%${keyword}%`
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];
  const stats = {
    total: rows.length,
    by_status: {} as Record<string, number>,
    reply_rate: 0,
  };
  for (const r of rows) {
    stats.by_status[r.status] = (stats.by_status[r.status] || 0) + 1;
  }
  const replied = rows.filter((r) => r.replied_at).length;
  stats.reply_rate = rows.length > 0 ? Math.round((replied / rows.length) * 100) : 0;

  return NextResponse.json({ rows, stats });
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  const body = await req.json();

  const username: string = (body.ig_username || "").replace(/^@/, "").trim();
  if (!username) {
    return NextResponse.json({ error: "ig_username 필수" }, { status: 400 });
  }
  if (!body.product_name) {
    return NextResponse.json({ error: "product_name 필수" }, { status: 400 });
  }
  if (body.status && !ALLOWED_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const insert = {
    ig_username: username,
    ig_url: body.ig_url || `https://www.instagram.com/${username}/`,
    ig_full_name: body.ig_full_name || null,
    followers: body.followers ? Number(body.followers) : null,
    category: body.category || null,
    product_name: body.product_name,
    product_brand: body.product_brand || null,
    proposed_margin: body.proposed_margin || null,
    dm_content: body.dm_content || null,
    proposed_at: body.proposed_at || new Date().toISOString(),
    replied_at: body.replied_at || null,
    reply_content: body.reply_content || null,
    status: body.status || "sent",
    campaign_date: body.campaign_date || null,
    agreed_margin: body.agreed_margin || null,
    sales_amount: body.sales_amount ? Number(body.sales_amount) : null,
    assigned_to: body.assigned_to || null,
    memo: body.memo || null,
    tags: body.tags || [],
  };

  const { data, error } = await sb
    .from("instagram_groupbuy_outreach")
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}
