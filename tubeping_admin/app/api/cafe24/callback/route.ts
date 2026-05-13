import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env.server";

const MALL_ID = env.CAFE24_MALL_ID;
const CLIENT_ID = env.CAFE24_CLIENT_ID;
const CLIENT_SECRET = env.CAFE24_CLIENT_SECRET;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "authorization code가 없습니다" }, { status: 400 });
  }

  // authorization code → access_token 교환
  const tokenRes = await fetch(
    `https://${MALL_ID}.cafe24api.com/api/v2/oauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${request.nextUrl.origin}/api/cafe24/callback`,
      }),
    }
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return NextResponse.json(
      { error: "토큰 발급 실패", detail: err },
      { status: tokenRes.status }
    );
  }

  const tokenData = await tokenRes.json();

  // 토큰 정보를 화면에 표시 (복사해서 .env.local에 넣기)
  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>카페24 연동 완료</title></head>
    <body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px;">
      <h1 style="color:#C41E1E;">카페24 연동 성공!</h1>
      <p>아래 토큰을 <code>.env.local</code>에 복사하세요:</p>
      <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
        <p><strong>CAFE24_ACCESS_TOKEN=</strong></p>
        <input value="${tokenData.access_token}" readonly style="width:100%;padding:8px;font-size:12px;border:1px solid #ddd;border-radius:4px;" onclick="this.select()" />
        <p style="margin-top:12px;"><strong>CAFE24_REFRESH_TOKEN=</strong></p>
        <input value="${tokenData.refresh_token}" readonly style="width:100%;padding:8px;font-size:12px;border:1px solid #ddd;border-radius:4px;" onclick="this.select()" />
      </div>
      <p style="color:#666;font-size:14px;">
        Access Token 만료: ${tokenData.expires_at}<br/>
        Refresh Token 만료: ${tokenData.refresh_token_expires_at}
      </p>
      <p style="color:#666;font-size:14px;">이 창은 닫아도 됩니다.</p>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
