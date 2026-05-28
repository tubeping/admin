import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * PATCH /api/seller-portal/notes
 * 판매사: 주문건별 seller_note 수정 (토큰 인증)
 *
 * body: { token: string, items: { id: string, seller_note: string }[] }
 */
export async function PATCH(request: NextRequest) {
  let body: { token?: string; items?: { id: string; seller_note: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const { token, items } = body;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "token 필요" }, { status: 400 });
  }
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "items 필요" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 토큰으로 스토어 확인
  const { data: store } = await sb
    .from("stores")
    .select("id")
    .eq("seller_token", token)
    .single();

  if (!store) {
    return NextResponse.json({ error: "스토어를 찾을 수 없습니다" }, { status: 404 });
  }

  // 주문건별 판매사 비고 수정
  for (const item of items) {
    await sb
      .from("mall_orders")
      .update({ seller_note: item.seller_note })
      .eq("id", item.id)
      .eq("store_id", store.id);
  }

  return NextResponse.json({ ok: true });
}
