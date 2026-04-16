import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const CLIENT_ID = (process.env.CAFE24_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.CAFE24_CLIENT_SECRET || "").trim();

/**
 * GET /api/stores/oauth/callback — 카페24 OAuth 콜백
 * authorization code → access_token 교환 → DB 저장
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");

  if (!code || !stateParam) {
    return new NextResponse("code 또는 state가 없습니다", { status: 400 });
  }

  // wizard 모드: state = "currentStoreId|nextId,nextId,..."
  const [storeId, ...queueParts] = stateParam.split("|");
  const queue = queueParts.join("|"); // "id1,id2,id3" 형식

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

  // authorize 단계와 정확히 동일해야 함 (카페24가 비교)
  const origin = request.nextUrl.origin;
  const redirectUri = "https://tubepingadmin.vercel.app/admin/api/stores/oauth/callback";

  const tokenUrl = `https://${store.mall_id}.cafe24api.com/api/v2/oauth/token`;
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: tokenBody,
  });

  const respText = await tokenRes.text();

  if (!tokenRes.ok) {
    return new NextResponse(`토큰 발급 실패 [${tokenRes.status}]: ${respText}`, { status: 500 });
  }

  const tokenData = JSON.parse(respText);

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

  // wizard 모드: 큐에 다음 store가 있으면 그쪽으로 OAuth 체이닝
  if (queue) {
    const ids = queue.split(",").filter(Boolean);
    if (ids.length > 0) {
      const nextId = ids[0];
      const restQueue = ids.slice(1).join(",");
      const nextUrl = new URL(`${origin}/admin/api/stores/${nextId}/oauth`);
      if (restQueue) nextUrl.searchParams.set("queue", restQueue);
      return NextResponse.redirect(nextUrl.toString());
    }
  }

  // 마법사 끝 또는 단일 모드 → admin으로 복귀
  return NextResponse.redirect(`${origin}/admin/system/stores?connected=${store.mall_id}`);
}
