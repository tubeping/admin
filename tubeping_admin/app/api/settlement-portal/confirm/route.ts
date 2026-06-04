import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/settlement-portal/confirm
 * 판매사가 정산서 확정 (race-condition safe)
 */
export async function POST(request: NextRequest) {
  let body: { token?: string; settlement_id?: string };
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

  // 확정 대상: settlement_id 지정 시 같은 판매사 소속인지 검증, 아니면 토큰의 정산서
  let targetId = base.id;
  if (settlement_id && settlement_id !== base.id) {
    const { data: target } = await sb
      .from("settlements")
      .select("id, store_id")
      .eq("id", settlement_id)
      .single();
    if (!target || target.store_id !== base.store_id) {
      return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
    }
    targetId = target.id;
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";

  // 단일 update + WHERE seller_confirmed=false 로 race condition 방지
  const { data, error } = await sb
    .from("settlements")
    .update({
      seller_confirmed: true,
      seller_confirmed_at: new Date().toISOString(),
      seller_confirmed_ip: ip,
    })
    .eq("id", targetId)
    .eq("seller_confirmed", false)
    .select("id, seller_confirmed_at")
    .single();

  if (error) {
    // 이미 확정된 경우 or 토큰 없는 경우
    const { data: existing } = await sb
      .from("settlements")
      .select("seller_confirmed, seller_confirmed_at")
      .eq("id", targetId)
      .single();

    if (existing?.seller_confirmed) {
      return NextResponse.json({
        message: "이미 확정되었습니다",
        confirmed_at: existing.seller_confirmed_at,
      });
    }
    return NextResponse.json({ error: "정산서를 찾을 수 없습니다" }, { status: 404 });
  }

  return NextResponse.json({
    message: "정산 확정 완료",
    confirmed_at: data.seller_confirmed_at,
  });
}
