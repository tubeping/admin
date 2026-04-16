import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

// 정식 등록된 앱(z87...)으로 강제 사용 — V2는 테스트앱이라 설치한도 걸림
const CLIENT_ID = (process.env.CAFE24_CLIENT_ID || "").trim();

/**
 * GET /api/stores/[id]/oauth — OAuth 인증 URL 생성
 * 해당 스토어의 카페24 OAuth 페이지로 리다이렉트
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();
  const { data: store } = await sb
    .from("stores")
    .select("mall_id")
    .eq("id", id)
    .single();

  if (!store) {
    return NextResponse.json({ error: "스토어를 찾을 수 없습니다" }, { status: 404 });
  }

  // 카페24에 등록된 정확한 production URL과 일치해야 함
  const redirectUri = "https://tubepingadmin.vercel.app/admin/api/stores/oauth/callback";

  // wizard 모드: 다음 처리할 store id를 queue로 받아 state에 인코딩
  const queueParam = request.nextUrl.searchParams.get("queue") || "";
  const stateValue = queueParam ? `${id}|${queueParam}` : id;

  const authUrl = new URL(`https://${store.mall_id}.cafe24api.com/api/v2/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("state", stateValue);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", [
    "mall.read_product",
    "mall.write_product",
    "mall.read_order",
    "mall.write_order",
    "mall.read_supply",
    "mall.read_shipping",
    "mall.write_shipping",
  ].join(" "));

  return NextResponse.redirect(authUrl.toString());
}
