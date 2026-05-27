import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/settlement-portal/confirm
 * 판매사가 정산서 확정
 */
export async function POST(request: NextRequest) {
  const { token } = await request.json();
  if (!token) {
    return NextResponse.json({ error: "token 필요" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: settlement, error } = await sb
    .from("settlements")
    .select("id, seller_confirmed, seller_confirmed_at")
    .eq("share_token", token)
    .single();

  if (error || !settlement) {
    return NextResponse.json({ error: "정산서를 찾을 수 없습니다" }, { status: 404 });
  }

  if (settlement.seller_confirmed) {
    return NextResponse.json({
      message: "이미 확정되었습니다",
      confirmed_at: settlement.seller_confirmed_at,
    });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";

  const { data, error: updateErr } = await sb
    .from("settlements")
    .update({
      seller_confirmed: true,
      seller_confirmed_at: new Date().toISOString(),
      seller_confirmed_ip: ip,
    })
    .eq("id", settlement.id)
    .select("seller_confirmed, seller_confirmed_at")
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    message: "정산 확정 완료",
    confirmed_at: data.seller_confirmed_at,
  });
}
