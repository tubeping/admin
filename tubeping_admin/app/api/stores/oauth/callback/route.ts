import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const CLIENT_ID = process.env.CAFE24_CLIENT_ID_V2 || process.env.CAFE24_CLIENT_ID || "";
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET_V2 || process.env.CAFE24_CLIENT_SECRET || "";

/**
 * GET /api/stores/oauth/callback — 카페24 OAuth 콜백
 * authorization code → access_token 교환 → DB 저장
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const storeId = request.nextUrl.searchParams.get("state");

  if (!code || !storeId) {
    return new NextResponse("code 또는 state가 없습니다", { status: 400 });
  }

  const sb = getServiceClient();

  // 스토어 정보 조회
  const { data: store } = await sb
    .from("stores")
    .select("mall_id, name")
    .eq("id", storeId)
    .single();

  if (!store) {
    return new NextResponse("스토어를 찾을 수 없습니다", { status: 404 });
  }

  // authorization code → token 교환
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/admin/api/stores/oauth/callback`;

  const tokenRes = await fetch(
    `https://${store.mall_id}.cafe24api.com/api/v2/oauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    }
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new NextResponse(`토큰 발급 실패: ${err}`, { status: 500 });
  }

  const tokenData = await tokenRes.json();

  // DB에 토큰 저장
  await sb
    .from("stores")
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: tokenData.expires_at,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", storeId);

  // 어드민 스토어 관리 페이지로 리다이렉트
  return NextResponse.redirect(`${origin}/admin/system/stores?connected=${store.mall_id}`);
}
