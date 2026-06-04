import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * PATCH /api/settlement-portal/notes
 * 판매사: seller_memo + 주문건별 seller_note 수정 (토큰 인증)
 *
 * body: { token: string, seller_memo?: string, items?: { id: string, seller_note: string }[] }
 */
export async function PATCH(request: NextRequest) {
  let body: { token?: string; settlement_id?: string; seller_memo?: string; items?: { id: string; seller_note: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const { token, settlement_id } = body;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "token 필요" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 토큰 → 판매사(store) 인증
  const { data: base } = await sb
    .from("settlements")
    .select("id, store_id")
    .eq("share_token", token)
    .single();

  if (!base) {
    return NextResponse.json({ error: "정산서를 찾을 수 없습니다" }, { status: 404 });
  }

  // 수정 대상: settlement_id 지정 시 같은 판매사 소속 검증, 아니면 토큰의 정산서
  let settlement = { id: base.id };
  if (settlement_id && settlement_id !== base.id) {
    const { data: target } = await sb
      .from("settlements")
      .select("id, store_id")
      .eq("id", settlement_id)
      .single();
    if (!target || target.store_id !== base.store_id) {
      return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
    }
    settlement = { id: target.id };
  }

  // 정산서 판매사 메모 수정
  if (body.seller_memo !== undefined) {
    await sb
      .from("settlements")
      .update({ seller_memo: body.seller_memo })
      .eq("id", settlement.id);
  }

  // 주문건별 판매사 비고 수정
  if (body.items && body.items.length > 0) {
    for (const item of body.items) {
      await sb
        .from("settlement_items")
        .update({ seller_note: item.seller_note })
        .eq("id", item.id)
        .eq("settlement_id", settlement.id);
    }
  }

  return NextResponse.json({ ok: true });
}
