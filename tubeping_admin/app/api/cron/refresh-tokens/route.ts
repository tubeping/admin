import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const CLIENT_ID = process.env.CAFE24_CLIENT_ID_V2 || process.env.CAFE24_CLIENT_ID || "";
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET_V2 || process.env.CAFE24_CLIENT_SECRET || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * GET /api/cron/refresh-tokens — 전체 스토어 토큰 자동 갱신
 * Vercel Cron으로 매일 새벽 6시 실행
 */
export async function GET(request: NextRequest) {
  // Vercel Cron 인증
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const { data: stores } = await sb
    .from("stores")
    .select("id, mall_id, name, refresh_token")
    .eq("status", "active")
    .not("refresh_token", "is", null);

  if (!stores || stores.length === 0) {
    return NextResponse.json({ message: "갱신할 스토어 없음" });
  }

  const results: { store: string; success: boolean; error?: string }[] = [];

  for (const store of stores) {
    try {
      const res = await fetch(
        `https://${store.mall_id}.cafe24api.com/api/v2/oauth/token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: store.refresh_token,
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        await sb
          .from("stores")
          .update({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            token_expires_at: data.expires_at,
          })
          .eq("id", store.id);

        results.push({ store: store.mall_id, success: true });
      } else {
        const err = await res.text();
        results.push({ store: store.mall_id, success: false, error: err.substring(0, 100) });
      }
    } catch (err) {
      results.push({
        store: store.mall_id,
        success: false,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({ total: stores.length, success, failed, results });
}
