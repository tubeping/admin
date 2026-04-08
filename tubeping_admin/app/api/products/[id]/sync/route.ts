import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const API_VERSION = "2026-03-01";

// 두 앱 모두 시도 (앱마다 설치된 몰이 다름)
const APP_CREDENTIALS = [
  { id: process.env.CAFE24_CLIENT_ID || "z87I2H98I55vjYfonHPPhC", secret: process.env.CAFE24_CLIENT_SECRET || "sMdTZQkKLF1kNlBRqsdUTD" },
  { id: "5hl56sAYGJMmmrzCgZqwcC", secret: "vJghZUxLL9tgGmRFvs83BB" },
];

/* ── 통합 토큰 관리 (전부 DB 기반) ── */
async function getStoreToken(store: { mall_id: string; access_token: string; refresh_token: string; token_expires_at: string | null; id: string }): Promise<string | null> {
  if (!store.access_token) return null;

  // 1. 만료 전이면 현재 토큰 그대로 사용
  const expiresAt = store.token_expires_at ? new Date(store.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60000) return store.access_token;

  // 2. API 호출로 유효성 테스트
  const testRes = await fetch(`https://${store.mall_id}.cafe24api.com/api/v2/admin/products?limit=1`, {
    headers: { Authorization: `Bearer ${store.access_token}`, "X-Cafe24-Api-Version": API_VERSION },
  });
  if (testRes.ok) return store.access_token;

  // 3. 만료됐으면 리프레시 시도 (두 앱 모두 시도)
  if (!store.refresh_token) return null;

  for (const app of APP_CREDENTIALS) {
    try {
      const res = await fetch(`https://${store.mall_id}.cafe24api.com/api/v2/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: store.refresh_token }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.access_token) continue;

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
      continue;
    }
  }

  return null;
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

async function cafe24Post(mallId: string, token: string, product: Record<string, unknown>): Promise<{ ok: boolean; status: number; product_no?: number }> {
  const res = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/products`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION,
    },
    body: JSON.stringify({ shop_no: 1, request: product }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  return { ok: true, status: res.status, product_no: data?.product?.product_no };
}

async function cafe24PutVariant(mallId: string, token: string, productNo: number, variantCode: string, update: Record<string, unknown>) {
  const res = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/products/${productNo}/variants/${variantCode}`, {
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

  // 1. TubePing 상품 정보 조회 (배리언트 포함)
  const { data: product, error: pErr } = await sb
    .from("products")
    .select("*, product_cafe24_mappings(*), product_variants(*)")
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
    display: product.display || "T",
  };

  const results: { store_id: string; mall_id: string; status: string; error?: string }[] = [];

  for (const mapping of mappings) {
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

    // 토큰 가져오기 (DB 기반 자동 갱신)
    const token = await getStoreToken(store);

    if (!token) {
      await sb.from("product_cafe24_mappings").update({ sync_status: "error" }).eq("id", mapping.id);
      results.push({ store_id: store.id, mall_id: store.mall_id, status: "error", error: "토큰 없음/만료" });
      continue;
    }

    const tpVariants = product.product_variants || [];

    // cafe24_product_no가 없으면 → 신규 생성 (POST)
    if (!mapping.cafe24_product_no) {
      const newProduct: Record<string, unknown> = {
        product_name: product.product_name,
        price: String(product.price),
        supply_price: String(product.supply_price),
        retail_price: String(product.retail_price),
        selling: product.selling,
        custom_product_code: product.tp_code,
        display: "T",
      };
      if (product.description) newProduct.simple_description = product.description;
      if (product.image_url) newProduct.list_image = product.image_url;

      try {
        const createRes = await cafe24Post(store.mall_id, token, newProduct);
        if (createRes.ok && createRes.product_no) {
          await sb.from("product_cafe24_mappings").update({
            cafe24_product_no: createRes.product_no,
            sync_status: "synced",
            last_sync_at: new Date().toISOString(),
          }).eq("id", mapping.id);
          results.push({ store_id: store.id, mall_id: store.mall_id, status: "created" });
        } else {
          // 생성 실패 — 해당 몰에 등록 불가 (스킵 처리)
          results.push({ store_id: store.id, mall_id: store.mall_id, status: "skipped", error: `생성 불가 (${createRes.status})` });
        }
      } catch {
        results.push({ store_id: store.id, mall_id: store.mall_id, status: "skipped", error: "생성 중 오류" });
      }
      continue;
    }

    // cafe24_product_no가 있으면 → 기존 수정 (PUT)
    const res = await cafe24Put(store.mall_id, token, mapping.cafe24_product_no, syncData);

    // 배리언트(재고/옵션) 동기화
    if (res.ok && tpVariants.length > 0) {
      // 해당 스토어의 배리언트 목록 조회 → 코드 매핑
      let storeVariants: { variant_code: string; options: { name: string; value: string }[] }[] = [];
      try {
        const vRes = await fetch(`https://${store.mall_id}.cafe24api.com/api/v2/admin/products/${mapping.cafe24_product_no}?embed=variants`, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Cafe24-Api-Version": API_VERSION },
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          storeVariants = vData?.product?.variants || [];
        }
      } catch { /* skip */ }

      for (const v of tpVariants) {
        // 1. 같은 variant_code가 있으면 그대로 사용
        let targetCode = storeVariants.find(sv => sv.variant_code === v.variant_code)?.variant_code;

        // 2. 없으면 옵션명/값으로 매칭
        if (!targetCode && v.option_value) {
          const match = storeVariants.find(sv =>
            sv.options?.some(o => v.option_value?.includes(o.value))
          );
          if (match) targetCode = match.variant_code;
        }

        // 3. 배리언트가 1개뿐이면 그것 사용
        if (!targetCode && storeVariants.length === 1) {
          targetCode = storeVariants[0].variant_code;
        }

        if (!targetCode) continue;

        const variantUpdate: Record<string, unknown> = {
          quantity: v.quantity,
          price: String(v.price),
          display: v.display,
          selling: v.selling,
        };
        await cafe24PutVariant(store.mall_id, token, mapping.cafe24_product_no, targetCode, variantUpdate);
      }
    }

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
  const createdCount = results.filter((r) => r.status === "created").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;

  const parts = [];
  if (syncedCount > 0) parts.push(`${syncedCount}개 동기화`);
  if (createdCount > 0) parts.push(`${createdCount}개 신규생성`);
  if (skippedCount > 0) parts.push(`${skippedCount}개 스킵`);
  if (errorCount > 0) parts.push(`${errorCount}개 실패`);

  return NextResponse.json({
    success: syncedCount + createdCount > 0,
    synced: syncedCount + createdCount,
    errors: errorCount,
    results,
    message: parts.join(", ") || "동기화 대상 없음",
  });
}
