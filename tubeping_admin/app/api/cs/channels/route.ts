/**
 * CS 채널 계정 관리 API
 * GET    /api/cs/channels — 채널 목록 조회
 * POST   /api/cs/channels — 채널 추가
 * PATCH  /api/cs/channels — 채널 수정
 * DELETE /api/cs/channels — 채널 삭제
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  const channelType = req.nextUrl.searchParams.get("type");

  let query = sb
    .from("cs_channels")
    .select("*, stores(name, mall_id)")
    .order("created_at", { ascending: false });

  if (channelType) query = query.eq("channel_type", channelType);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channels: data || [] });
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  const body = await req.json();

  const { channel_type, name, account_id, auth_key, store_id, memo } = body;

  if (!channel_type || !name) {
    return NextResponse.json({ error: "channel_type과 name 필요" }, { status: 400 });
  }

  // 웹훅 URL 자동 생성
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://tubepingadmin.vercel.app/admin";

  const { data, error } = await sb
    .from("cs_channels")
    .insert({
      channel_type,
      name,
      account_id: account_id || null,
      auth_key: auth_key || null,
      store_id: store_id || null,
      memo: memo || null,
      status: auth_key ? "active" : "pending",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 웹훅 URL 업데이트 (채널 타입별 경로)
  const webhookPath = channel_type === "kakao" ? "kakaotalk" : "navertalk";
  const webhookUrl = `${baseUrl}/api/${webhookPath}/webhook?channel_id=${data.id}`;
  await sb.from("cs_channels").update({ webhook_url: webhookUrl }).eq("id", data.id);
  data.webhook_url = webhookUrl;

  return NextResponse.json({ channel: data });
}

export async function PATCH(req: NextRequest) {
  const sb = getServiceClient();
  const { id, ...updates } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "id 필요" }, { status: 400 });
  }

  const allowed = ["name", "account_id", "auth_key", "store_id", "status", "memo"];
  const clean: Record<string, unknown> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) clean[key] = updates[key];
  }

  if (clean.auth_key && !clean.status) {
    clean.status = "active";
  }

  const { error } = await sb.from("cs_channels").update(clean).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const sb = getServiceClient();
  const { id } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "id 필요" }, { status: 400 });
  }

  const { error } = await sb.from("cs_channels").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
