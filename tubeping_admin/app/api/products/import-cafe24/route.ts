import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const MALL_ID = process.env.CAFE24_MALL_ID || "";
const CLIENT_ID = process.env.CAFE24_CLIENT_ID || "";
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET || "";
const API_VERSION = "2026-03-01";

let cachedToken = {
  access: process.env.CAFE24_ACCESS_TOKEN || "",
  refresh: process.env.CAFE24_REFRESH_TOKEN || "",
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

async function cafe24Fetch(url: string) {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Cafe24-Api-Version": API_VERSION,
  };

  let res = await fetch(url, { headers });

  if (res.status === 401) {
    const newToken = await refreshToken();
    res = await fetch(url, {
      headers: { ...headers, Authorization: `Bearer ${newToken}` },
    });
  }

  if (!res.ok) return null;
  return res.json();
}

/**
 * POST /api/products/import-cafe24
 * 카페24 마스터 몰에서 상품을 가져와 TubePing 자체코드로 등록
 * - custom_product_code → tp_code로 사용
 * - 이미 존재하는 tp_code는 스킵
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const storeId = body.store_id; // 매핑할 스토어 ID (선택)

  const sb = getServiceClient();
  let imported = 0;
  let skipped = 0;
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await cafe24Fetch(
      `https://${MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&offset=${offset}`
    );

    if (!data || !data.products || data.products.length === 0) break;

    for (const p of data.products) {
      const customCode = p.custom_product_code;
      if (!customCode) {
        skipped++;
        continue;
      }

      // 이미 존재하는지 확인
      const { data: existing } = await sb
        .from("products")
        .select("id")
        .eq("tp_code", customCode)
        .maybeSingle();

      if (existing) {
        // 이미 있으면 매핑만 추가
        if (storeId) {
          await sb
            .from("product_cafe24_mappings")
            .upsert(
              {
                product_id: existing.id,
                store_id: storeId,
                cafe24_product_no: p.product_no,
                cafe24_product_code: p.product_code,
                sync_status: "synced",
              },
              { onConflict: "product_id,store_id" }
            );
        }
        skipped++;
        continue;
      }

      // 새로 등록
      const img = p.list_image || p.detail_image || p.small_image || null;

      const { data: newProduct, error } = await sb
        .from("products")
        .insert({
          tp_code: customCode,
          product_name: p.product_name || "",
          price: Number(p.price) || 0,
          supply_price: Number(p.supply_price) || 0,
          retail_price: Number(p.retail_price) || 0,
          image_url: img,
          selling: p.selling === "T" ? "T" : "F",
          description: p.simple_description || null,
        })
        .select("id")
        .single();

      if (error) {
        skipped++;
        continue;
      }

      // 매핑 생성 (마스터몰)
      if (newProduct) {
        // 마스터몰 매핑은 storeId가 있으면 해당 스토어로
        if (storeId) {
          await sb
            .from("product_cafe24_mappings")
            .upsert(
              {
                product_id: newProduct.id,
                store_id: storeId,
                cafe24_product_no: p.product_no,
                cafe24_product_code: p.product_code,
                sync_status: "synced",
              },
              { onConflict: "product_id,store_id" }
            );
        }
        imported++;
      }
    }

    if (data.products.length < limit) break;
    offset += limit;
  }

  return NextResponse.json({
    success: true,
    imported,
    skipped,
    message: `${imported}개 상품 가져옴, ${skipped}개 스킵 (이미 존재/코드 없음)`,
  });
}
