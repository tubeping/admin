import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env.server";

const MALL_ID = env.CAFE24_MALL_ID;
const CLIENT_ID = env.CAFE24_CLIENT_ID;
const CLIENT_SECRET = env.CAFE24_CLIENT_SECRET;
const API_VERSION = "2026-03-01";

let cachedToken = {
  access: env.CAFE24_ACCESS_TOKEN,
  refresh: env.CAFE24_REFRESH_TOKEN,
  expiresAt: Date.now() + 2 * 60 * 60 * 1000,
};

async function refreshToken(): Promise<string> {
  const res = await fetch(
    `https://${MALL_ID}.cafe24api.com/api/v2/oauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cachedToken.refresh,
      }),
    }
  );

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

  const data = await res.json();
  cachedToken = {
    access: data.access_token,
    refresh: data.refresh_token,
    expiresAt: new Date(data.expires_at).getTime(),
  };
  return data.access_token;
}

async function getToken(): Promise<string> {
  if (cachedToken.access && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.access;
  }
  return refreshToken();
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = searchParams.get("limit") || "100";
  const offset = searchParams.get("offset") || "0";
  const keyword = searchParams.get("keyword") || "";
  const category = searchParams.get("category") || "";

  const token = await getToken();

  const params = new URLSearchParams({
    limit,
    offset,
  });
  if (keyword) params.set("product_name", keyword);
  if (category) params.set("category", category);

  const res = await fetch(
    `https://${MALL_ID}.cafe24api.com/api/v2/admin/products?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": API_VERSION,
      },
    }
  );

  if (res.status === 401) {
    const newToken = await refreshToken();
    const retry = await fetch(
      `https://${MALL_ID}.cafe24api.com/api/v2/admin/products?${params}`,
      {
        headers: {
          Authorization: `Bearer ${newToken}`,
          "Content-Type": "application/json",
          "X-Cafe24-Api-Version": API_VERSION,
        },
      }
    );
    if (!retry.ok) {
      return NextResponse.json({ error: "카페24 API 오류" }, { status: retry.status });
    }
    const data = await retry.json();
    return NextResponse.json(data);
  }

  if (!res.ok) {
    return NextResponse.json({ error: "카페24 API 오류" }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
