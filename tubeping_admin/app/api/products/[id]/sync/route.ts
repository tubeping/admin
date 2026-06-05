import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { env } from "@/lib/env.server";

const API_VERSION = "2026-03-01";

const CLIENT_ID = env.CAFE24_CLIENT_ID;
const CLIENT_SECRET = env.CAFE24_CLIENT_SECRET;

type StoreRow = {
  id: string;
  mall_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
};

/* ── 통합 토큰 관리 ── */
export async function getStoreToken(store: StoreRow): Promise<string | null> {
  if (!store.access_token) return null;

  const expiresAt = store.token_expires_at ? new Date(store.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60000) return store.access_token;

  const testRes = await fetch(`https://${store.mall_id}.cafe24api.com/api/v2/admin/products?limit=1`, {
    headers: { Authorization: `Bearer ${store.access_token}`, "X-Cafe24-Api-Version": API_VERSION },
  });
  if (testRes.ok) return store.access_token;

  if (!store.refresh_token) return null;
  try {
    const res = await fetch(`https://${store.mall_id}.cafe24api.com/api/v2/oauth/token`, {
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

async function cafe24Post(mallId: string, token: string, product: Record<string, unknown>): Promise<{ ok: boolean; status: number; product_no?: number; error?: string }> {
  const res = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/products`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION,
    },
    body: JSON.stringify({ shop_no: 1, request: product }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: errorText };
  }
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

/* ── 타입 ── */
type AdminVariant = {
  id: string;
  variant_code: string | null;
  option_name: string | null;
  option_value: string | null;
  option_text: string | null;
  price: number;
  supply_price?: number | null;
  quantity: number;
  display: string;
  selling: string;
};

type AdminProduct = {
  id: string;
  tp_code: string;
  product_name: string;
  price: number;
  supply_price: number;
  retail_price: number;
  image_url: string | null;
  description: string | null;
  selling: string;
  display: string | null;
  product_variants?: AdminVariant[];
  product_cafe24_mappings?: Array<{
    id: string;
    store_id: string;
    cafe24_product_no: number | null;
    sync_status: string;
  }>;
};

type SyncResult = {
  store_id: string;
  mall_id: string;
  status: "synced" | "created" | "error" | "skipped";
  error?: string;
};

/* ── 카페24 variant.options 텍스트 합치기 ── */
function variantOptionsToText(options: Array<{ name?: string; value?: string }> | undefined): string {
  if (!options || options.length === 0) return "";
  return options
    .map((o) => `${(o.name || "").trim()}=${(o.value || "").trim()}`)
    .join(", ")
    .trim();
}

/* ── 단일 옵션 텍스트(옵션명=옵션값) ── */
function singleOptionText(name?: string | null, value?: string | null): string {
  return `${(name || "").trim()}=${(value || "").trim()}`.replace(/^=+|=+$/g, "");
}

/* ── 핵심: 단일 상품을 매핑된 (또는 지정된) 스토어에 동기화 ── */
export async function syncProductToStores(
  productId: string,
  options?: { storeIds?: string[] }
): Promise<{ results: SyncResult[]; synced: number; errors: number; message: string }> {
  const sb = getServiceClient();
  const storeFilter = options?.storeIds;

  // 1. 상품 + 매핑 + variants 조회
  const { data: product, error: pErr } = await sb
    .from("products")
    .select("*, product_cafe24_mappings(*), product_variants(*)")
    .eq("id", productId)
    .single<AdminProduct>();

  if (pErr || !product) {
    return { results: [], synced: 0, errors: 1, message: "상품 조회 실패" };
  }

  let mappings = product.product_cafe24_mappings || [];
  if (storeFilter && storeFilter.length > 0) {
    const filterSet = new Set(storeFilter);
    mappings = mappings.filter((m) => filterSet.has(m.store_id));
  }
  if (mappings.length === 0) {
    return { results: [], synced: 0, errors: 0, message: "매핑된 스토어 없음" };
  }

  // 2. PUT 시 보낼 공통 데이터
  const syncData: Record<string, unknown> = {
    product_name: product.product_name,
    price: String(product.price),
    supply_price: String(product.supply_price),
    retail_price: String(product.retail_price),
    selling: product.selling,
    display: product.display || "T",
  };
  if (product.image_url) {
    syncData.list_image = product.image_url;
    syncData.detail_image = product.image_url;
    syncData.tiny_image = product.image_url;
    syncData.small_image = product.image_url;
  }
  if (product.description) {
    syncData.simple_description = product.description;
  }

  const tpVariants = product.product_variants || [];
  const results: SyncResult[] = [];

  // 3. 매핑 대상 스토어 정보 일괄 조회
  const storeIds = mappings.map((m) => m.store_id);
  const { data: stores } = await sb
    .from("stores")
    .select("id, mall_id, access_token, refresh_token, token_expires_at, client_id, client_secret")
    .in("id", storeIds);
  const storeById = new Map<string, StoreRow>();
  for (const s of stores || []) storeById.set(s.id, s as StoreRow);

  // 4. (storeId × admin_variant_id) → cafe24_variant_code 매핑 미리 로드
  const variantIds = tpVariants.map((v) => v.id);
  const variantMappingByKey = new Map<string, string>(); // `${storeId}::${admin_variant_id}` → cafe24_variant_code
  if (variantIds.length > 0) {
    const { data: pvcm } = await sb
      .from("product_variant_cafe24_mappings")
      .select("store_id, admin_variant_id, cafe24_variant_code")
      .in("admin_variant_id", variantIds)
      .in("store_id", storeIds);
    for (const m of pvcm || []) {
      variantMappingByKey.set(`${m.store_id}::${m.admin_variant_id}`, m.cafe24_variant_code);
    }
  }

  // 5. 각 매핑별 처리
  for (const mapping of mappings) {
    const store = storeById.get(mapping.store_id);
    if (!store) {
      await sb.from("product_cafe24_mappings").update({ sync_status: "error" }).eq("id", mapping.id);
      results.push({ store_id: mapping.store_id, mall_id: "?", status: "error", error: "스토어 조회 실패" });
      continue;
    }

    const token = await getStoreToken(store);
    if (!token) {
      await sb.from("product_cafe24_mappings").update({ sync_status: "error" }).eq("id", mapping.id);
      results.push({ store_id: store.id, mall_id: store.mall_id, status: "error", error: "토큰 없음/만료" });
      continue;
    }

    // 5-1. cafe24_product_no 없으면 신규 생성 (POST)
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
      if (product.image_url) {
        newProduct.list_image = product.image_url;
        newProduct.detail_image = product.image_url;
        newProduct.tiny_image = product.image_url;
        newProduct.small_image = product.image_url;
      }

      try {
        const createRes = await cafe24Post(store.mall_id, token, newProduct);
        if (createRes.ok && createRes.product_no) {
          await sb.from("product_cafe24_mappings").update({
            cafe24_product_no: createRes.product_no,
            sync_status: "synced",
            last_sync_at: new Date().toISOString(),
          }).eq("id", mapping.id);
          results.push({ store_id: store.id, mall_id: store.mall_id, status: "created" });

          // 신규 생성 후 자식 카페24 variants를 받아 매핑 테이블에 저장
          await persistVariantMappings(store.mall_id, token, createRes.product_no, store.id, tpVariants);

          // 신규 생성된 자식 variants에 admin의 가격/재고 PUT
          await syncVariantsToStore(store.mall_id, token, createRes.product_no, store.id, tpVariants);
        } else {
          results.push({
            store_id: store.id, mall_id: store.mall_id, status: "skipped",
            error: `생성 불가 (${createRes.status}${createRes.error ? `: ${createRes.error.slice(0, 120)}` : ""})`,
          });
        }
      } catch (e) {
        results.push({
          store_id: store.id, mall_id: store.mall_id, status: "skipped",
          error: e instanceof Error ? e.message : "생성 중 오류",
        });
      }
      continue;
    }

    // 5-2. 기존 product 수정 (PUT)
    const res = await cafe24Put(store.mall_id, token, mapping.cafe24_product_no, syncData);

    // 5-3. variants 동기화
    if (res.ok && tpVariants.length > 0) {
      await syncVariantsToStore(store.mall_id, token, mapping.cafe24_product_no, store.id, tpVariants);
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

  return {
    results,
    synced: syncedCount + createdCount,
    errors: errorCount,
    message: parts.join(", ") || "동기화 대상 없음",
  };
}

/* ── 자식 카페24 variants 받아와 매핑 테이블에 저장 ──
 *  product_variant_cafe24_mappings에 (admin_variant_id, store_id, cafe24_variant_code) upsert
 */
async function persistVariantMappings(
  mallId: string,
  token: string,
  cafe24ProductNo: number,
  storeId: string,
  adminVariants: AdminVariant[]
) {
  if (adminVariants.length === 0) return;
  try {
    const res = await fetch(
      `https://${mallId}.cafe24api.com/api/v2/admin/products/${cafe24ProductNo}/variants?limit=100`,
      { headers: { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": API_VERSION } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const cafeVariants: Array<{ variant_code: string; options: Array<{ name: string; value: string }> }> =
      data?.variants || [];

    const sb = getServiceClient();
    const rowsToUpsert: Array<{
      admin_variant_id: string;
      store_id: string;
      cafe24_variant_code: string;
      last_sync_at: string;
    }> = [];

    for (const v of adminVariants) {
      const adminText = v.option_text || singleOptionText(v.option_name, v.option_value);
      let matched: typeof cafeVariants[number] | null = null;

      // 1순위: option_text 정확 매칭
      matched = cafeVariants.find((cv) => variantOptionsToText(cv.options) === adminText) || null;

      // 2순위: option_value 부분 매칭
      if (!matched && v.option_value) {
        matched = cafeVariants.find((cv) =>
          cv.options?.some((o) => v.option_value?.includes(o.value))
        ) || null;
      }

      // 3순위: variant가 1개뿐이면 그것
      if (!matched && cafeVariants.length === 1) matched = cafeVariants[0];

      if (matched?.variant_code) {
        rowsToUpsert.push({
          admin_variant_id: v.id,
          store_id: storeId,
          cafe24_variant_code: matched.variant_code,
          last_sync_at: new Date().toISOString(),
        });
      }
    }

    if (rowsToUpsert.length > 0) {
      await sb
        .from("product_variant_cafe24_mappings")
        .upsert(rowsToUpsert, { onConflict: "admin_variant_id,store_id" });
    }
  } catch (e) {
    console.error("[persistVariantMappings] failed:", e);
  }
}

/* ── admin variants 데이터 → 자식 카페24 variants PUT ──
 *  variant_code 결정 순위:
 *    1) product_variant_cafe24_mappings 조회
 *    2) 매핑 없으면 자식 카페24 variants 받아와 option_text 매칭 후 매핑 저장
 *    3) 그래도 못 찾으면 스킵 (운영자가 자식 mall 확인 필요)
 */
async function syncVariantsToStore(
  mallId: string,
  token: string,
  cafe24ProductNo: number,
  storeId: string,
  adminVariants: AdminVariant[]
) {
  if (adminVariants.length === 0) return;
  const sb = getServiceClient();

  // 1. 기존 매핑 로드
  const { data: existing } = await sb
    .from("product_variant_cafe24_mappings")
    .select("admin_variant_id, cafe24_variant_code")
    .eq("store_id", storeId)
    .in("admin_variant_id", adminVariants.map((v) => v.id));
  const mapped = new Map<string, string>();
  for (const m of existing || []) mapped.set(m.admin_variant_id, m.cafe24_variant_code);

  // 2. 매핑 없는 variant가 있으면 자식 카페24 variants 받아와 매핑 시도
  const unmapped = adminVariants.filter((v) => !mapped.has(v.id));
  if (unmapped.length > 0) {
    await persistVariantMappings(mallId, token, cafe24ProductNo, storeId, unmapped);
    // 다시 로드
    const { data: refreshed } = await sb
      .from("product_variant_cafe24_mappings")
      .select("admin_variant_id, cafe24_variant_code")
      .eq("store_id", storeId)
      .in("admin_variant_id", adminVariants.map((v) => v.id));
    mapped.clear();
    for (const m of refreshed || []) mapped.set(m.admin_variant_id, m.cafe24_variant_code);
  }

  // 3. 매핑된 variant_code로 PUT
  for (const v of adminVariants) {
    const code = mapped.get(v.id);
    if (!code) continue;
    await cafe24PutVariant(mallId, token, cafe24ProductNo, code, {
      quantity: v.quantity,
      price: String(v.price),
      display: v.display,
      selling: v.selling,
    });
  }

  // 4. last_sync_at 갱신
  const matchedIds = adminVariants.filter((v) => mapped.has(v.id)).map((v) => v.id);
  if (matchedIds.length > 0) {
    await sb
      .from("product_variant_cafe24_mappings")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("store_id", storeId)
      .in("admin_variant_id", matchedIds);
  }
}

/**
 * POST /api/products/[id]/sync
 * TubePing 상품 → 매핑된 모든 카페24 스토어에 동기화
 * body (optional): { store_ids: string[] } — 특정 자식 스토어만 동기화
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const storeIds = Array.isArray(body.store_ids) ? body.store_ids : undefined;

  const result = await syncProductToStores(id, storeIds ? { storeIds } : undefined);

  return NextResponse.json({
    success: result.synced > 0,
    synced: result.synced,
    errors: result.errors,
    results: result.results,
    message: result.message,
  });
}
