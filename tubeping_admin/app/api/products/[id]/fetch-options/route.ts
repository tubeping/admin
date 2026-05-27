import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { env } from "@/lib/env.server";

const MALL_ID = "tubeping";
const API_VERSION = "2026-03-01";
const CLIENT_ID = env.CAFE24_CLIENT_ID;
const CLIENT_SECRET = env.CAFE24_CLIENT_SECRET;

/**
 * POST /api/products/[id]/fetch-options
 * 카페24 마스터몰의 옵션 텍스트 + 기존 주문의 option_text 두 소스에서 옵션 목록 수집해 반환.
 * 카페24가 옵션별 공급가를 응답하지 않으므로 옵션 텍스트와 추가금만 가져온다.
 *
 * 응답: { options: [{ option_text, variant_code?, additional_amount?, source: "cafe24"|"orders" }] }
 *  - 운영자가 이 목록을 검토하고 공급가/판매가 입력 후 POST /api/products/[id]/options 로 저장.
 */

async function getMasterToken(): Promise<string | null> {
  const sb = getServiceClient();
  const { data: store } = await sb
    .from("stores")
    .select("id, access_token, refresh_token, token_expires_at, mall_id")
    .eq("mall_id", MALL_ID).single();
  if (!store) return null;

  const expiresAt = store.token_expires_at ? new Date(store.token_expires_at).getTime() : 0;
  if (store.access_token && expiresAt > Date.now() + 60000) return store.access_token;

  if (store.access_token) {
    const testRes = await fetch(`https://${MALL_ID}.cafe24api.com/api/v2/admin/products?limit=1`, {
      headers: { Authorization: `Bearer ${store.access_token}`, "X-Cafe24-Api-Version": API_VERSION },
    });
    if (testRes.ok) return store.access_token;
  }

  if (!store.refresh_token) return null;
  try {
    const res = await fetch(`https://${MALL_ID}.cafe24api.com/api/v2/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: store.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.access_token) return null;
    await sb.from("stores").update({
      access_token: data.access_token, refresh_token: data.refresh_token,
      token_expires_at: data.expires_at, updated_at: new Date().toISOString(),
    }).eq("id", store.id);
    return data.access_token;
  } catch {
    return null;
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = getServiceClient();

  // 1. 상품 + 마스터몰 매핑 조회
  const { data: product } = await sb.from("products").select("id, product_name").eq("id", id).single();
  if (!product) return NextResponse.json({ error: "상품을 찾을 수 없습니다" }, { status: 404 });

  const { data: masterStore } = await sb.from("stores").select("id").eq("mall_id", MALL_ID).single();
  const { data: mapping } = await sb.from("product_cafe24_mappings")
    .select("cafe24_product_no")
    .eq("product_id", id)
    .eq("store_id", masterStore?.id || "")
    .maybeSingle();

  const options: { option_text: string; variant_code?: string | null; additional_amount?: number; source: string }[] = [];
  const seen = new Set<string>();

  // 2. 카페24 variants 수집
  if (mapping?.cafe24_product_no) {
    const token = await getMasterToken();
    if (token) {
      try {
        const headers = { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": API_VERSION };
        const vRes = await fetch(
          `https://${MALL_ID}.cafe24api.com/api/v2/admin/products/${mapping.cafe24_product_no}/variants?limit=100`,
          { headers }
        );
        if (vRes.ok) {
          const vData = await vRes.json();
          for (const v of (vData.variants || []) as Array<{ variant_code?: string; options?: Array<{ name?: string; value?: string }>; additional_amount?: string }>) {
            const opts = v.options || [];
            const text = opts.map((o) => `${o.name || ""}=${o.value || ""}`).join(", ").trim();
            if (!text) continue;
            if (seen.has(text)) continue;
            seen.add(text);
            options.push({
              option_text: text,
              variant_code: v.variant_code || null,
              additional_amount: Number(v.additional_amount) || 0,
              source: "cafe24",
            });
          }
        }
      } catch { /* ignore */ }
    }
  }

  // 3. 기존 주문에서 option_text 수집 (카페24가 옵션 안 줄 때 fallback)
  const { data: orderOpts } = await sb
    .from("orders")
    .select("option_text")
    .eq("product_id", id)
    .not("option_text", "is", null)
    .neq("option_text", "")
    .limit(500);
  for (const o of orderOpts || []) {
    const t = (o.option_text || "").trim();
    if (!t || t === "," || t === ",  ," || seen.has(t)) continue;
    seen.add(t);
    options.push({ option_text: t, source: "orders" });
  }

  // 4. 이미 등록된 product_options와 비교
  const { data: existing } = await sb.from("product_options").select("option_text").eq("product_id", id);
  const existingSet = new Set((existing || []).map((e) => e.option_text));

  const result = options.map((o) => ({
    ...o,
    already_registered: existingSet.has(o.option_text),
  }));

  return NextResponse.json({
    product_id: id,
    product_name: product.product_name,
    cafe24_product_no: mapping?.cafe24_product_no || null,
    options: result,
    cafe24_count: result.filter((r) => r.source === "cafe24").length,
    orders_count: result.filter((r) => r.source === "orders").length,
  });
}
