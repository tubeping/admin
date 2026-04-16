import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const CLIENT_ID = (process.env.CAFE24_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.CAFE24_CLIENT_SECRET || "").trim();
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
  const { data: rawStores } = await sb
    .from("stores")
    .select("id, mall_id, name, refresh_token, status")
    .in("status", ["active", "auth_failed"])
    .not("refresh_token", "is", null);

  // pseudo 스토어(manual_/excel_/test_)는 카페24 호출 대상이 아니므로 제외
  const stores = (rawStores || []).filter(
    (s) => !(s.mall_id.startsWith("manual_") || s.mall_id.startsWith("excel_") || s.mall_id.startsWith("test_"))
  );

  if (!stores || stores.length === 0) {
    return NextResponse.json({ message: "갱신할 스토어 없음" });
  }

  const results: { store: string; success: boolean; error?: string }[] = [];

  for (const store of stores) {
    let errMsg = "";
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
        if (data.access_token) {
          await sb
            .from("stores")
            .update({
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              token_expires_at: data.expires_at,
              status: "active",
              updated_at: new Date().toISOString(),
            })
            .eq("id", store.id);
          results.push({ store: store.mall_id, success: true });
          continue;
        }
        errMsg = "no access_token";
      } else {
        errMsg = `${res.status}`;
      }
    } catch (err) {
      errMsg = err instanceof Error ? err.message : "unknown";
    }
    await sb
      .from("stores")
      .update({ status: "auth_failed", updated_at: new Date().toISOString() })
      .eq("id", store.id);
    results.push({ store: store.mall_id, success: false, error: errMsg });
  }

  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({ total: stores.length, success, failed, results });
}
