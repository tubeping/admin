import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const MASTER_MALL_ID = process.env.CAFE24_MALL_ID || "";
const MASTER_CLIENT_ID = process.env.CAFE24_CLIENT_ID || "";
const MASTER_CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET || "";
const API_VERSION = "2026-03-01";

/* ── 마스터 토큰 ── */
let masterToken = {
  access: process.env.CAFE24_ACCESS_TOKEN || "",
  refresh: process.env.CAFE24_REFRESH_TOKEN || "",
  expiresAt: Date.now() + 2 * 60 * 60 * 1000,
};

async function refreshMasterToken(): Promise<string> {
  const res = await fetch(`https://${MASTER_MALL_ID}.cafe24api.com/api/v2/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${MASTER_CLIENT_ID}:${MASTER_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: masterToken.refresh }),
  });
  if (!res.ok) throw new Error(`Master token refresh failed: ${res.status}`);
  const data = await res.json();
  masterToken = { access: data.access_token, refresh: data.refresh_token, expiresAt: new Date(data.expires_at).getTime() };
  return data.access_token;
}

async function getMasterToken(): Promise<string> {
  if (masterToken.access && masterToken.expiresAt > Date.now() + 60000) return masterToken.access;
  return refreshMasterToken();
}

/* ── 스토어별 토큰 (DB에서 로드) ── */
async function getStoreToken(store: { mall_id: string; access_token: string; refresh_token: string; token_expires_at: string | null; id: string }): Promise<string | null> {
  if (!store.access_token) return null;

  const expiresAt = store.token_expires_at ? new Date(store.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60000) return store.access_token;

  // 리프레시 시도
  if (!store.refresh_token) return null;

  try {
    const res = await fetch(`https://${store.mall_id}.cafe24api.com/api/v2/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${MASTER_CLIENT_ID}:${MASTER_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: store.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // DB에 새 토큰 저장
    const sb = getServiceClient();
    await sb.from("stores").update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: data.expires_at,
      updated_at: new Date().toISOString(),
    }).eq("id", store.id);

    return data.access_token;
  } catch {
    return null;
  }
}

/* ── 카페24 API 호출 ── */
async function cafe24Put(mallId: string, token: string, productNo: number, update: Record<string, unknown>) {
  const res = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/products/${productNo}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION,
    },
    body: JSON.stringify({ shop_no: 1, request: update }),
  });
  return { ok: res.ok, status: res.status };
}

/**
 * POST /api/products/[id]/sync
 * TubePing 상품 → 매핑된 모든 카페24 스토어에 동기화
 *
 * 동기화 항목: 상품명, 판매가, 공급가, 소비자가, 판매상태
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();

  // 1. TubePing 상품 정보 조회
  const { data: product, error: pErr } = await sb
    .from("products")
    .select("*, product_cafe24_mappings(*)")
    .eq("id", id)
    .single();

  if (pErr || !product) {
    return NextResponse.json({ error: "상품 조회 실패" }, { status: 404 });
  }

  const mappings = product.product_cafe24_mappings || [];
  if (mappings.length === 0) {
    return NextResponse.json({ error: "매핑된 스토어가 없습니다" }, { status: 400 });
  }

  // 동기화할 데이터
  const syncData: Record<string, unknown> = {
    product_name: product.product_name,
    price: String(product.price),
    supply_price: String(product.supply_price),
    retail_price: String(product.retail_price),
    selling: product.selling,
  };

  const results: { store_id: string; mall_id: string; status: string; error?: string }[] = [];

  for (const mapping of mappings) {
    if (!mapping.cafe24_product_no) {
      // 카페24 상품번호 없으면 스킵
      await sb.from("product_cafe24_mappings").update({ sync_status: "error" }).eq("id", mapping.id);
      results.push({ store_id: mapping.store_id, mall_id: "?", status: "error", error: "카페24 상품번호 없음" });
      continue;
    }

    // 스토어 정보 로드
    const { data: store } = await sb
      .from("stores")
      .select("id, mall_id, access_token, refresh_token, token_expires_at")
      .eq("id", mapping.store_id)
      .single();

    if (!store) {
      await sb.from("product_cafe24_mappings").update({ sync_status: "error" }).eq("id", mapping.id);
      results.push({ store_id: mapping.store_id, mall_id: "?", status: "error", error: "스토어 조회 실패" });
      continue;
    }

    // 마스터몰인 경우
    let token: string | null = null;
    if (store.mall_id === MASTER_MALL_ID) {
      try { token = await getMasterToken(); } catch { token = null; }
    } else {
      token = await getStoreToken(store);
    }

    if (!token) {
      await sb.from("product_cafe24_mappings").update({ sync_status: "error" }).eq("id", mapping.id);
      results.push({ store_id: store.id, mall_id: store.mall_id, status: "error", error: "토큰 없음/만료" });
      continue;
    }

    // 카페24 API로 상품 수정
    const res = await cafe24Put(store.mall_id, token, mapping.cafe24_product_no, syncData);

    if (res.ok) {
      await sb.from("product_cafe24_mappings").update({
        sync_status: "synced",
        last_sync_at: new Date().toISOString(),
      }).eq("id", mapping.id);
      results.push({ store_id: store.id, mall_id: store.mall_id, status: "synced" });
    } else {
      await sb.from("product_cafe24_mappings").update({ sync_status: "error" }).eq("id", mapping.id);
      results.push({ store_id: store.id, mall_id: store.mall_id, status: "error", error: `API ${res.status}` });
    }
  }

  const syncedCount = results.filter((r) => r.status === "synced").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    success: true,
    synced: syncedCount,
    errors: errorCount,
    results,
    message: `${syncedCount}개 스토어 동기화 완료${errorCount > 0 ? `, ${errorCount}개 실패` : ""}`,
  });
}
