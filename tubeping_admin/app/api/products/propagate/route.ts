import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { env } from "@/lib/env.server";
import { syncProductToStores, getStoreToken } from "../[id]/sync/route";

const API_VERSION = "2026-03-01";
const _CLIENT_ID = env.CAFE24_CLIENT_ID;
const _CLIENT_SECRET = env.CAFE24_CLIENT_SECRET;
void _CLIENT_ID; void _CLIENT_SECRET;

/**
 * POST /api/products/propagate
 * admin 상품을 선택한 자식 카페24 스토어들로 전파 (매핑 + 즉시 동기화).
 *
 * body:
 *   {
 *     product_ids: string[],
 *     store_ids: string[],
 *     on_conflict?: "report" | "link",  // 기본 "report" — 자식에 동일 tp_code 있을 때 동작
 *                                       // "link" — 그 product_no를 매핑에 연결
 *   }
 *
 * 동작:
 *   각 (product, store) 페어별:
 *     - 이미 매핑 있음 → 그 자식만 sync
 *     - 매핑 없음 + 자식에 동일 tp_code 없음 → 매핑 행 생성 (cafe24_product_no=NULL) → sync (POST로 신규 생성)
 *     - 매핑 없음 + 자식에 동일 tp_code 있음 → on_conflict에 따라 분기
 *
 * 결과:
 *   {
 *     total_pairs, success, conflicts[], results[]
 *   }
 */

type ConflictRow = {
  product_id: string;
  tp_code: string;
  store_id: string;
  mall_id: string;
  cafe24_product_no: number;
  message: string;
};

type ResultRow = {
  product_id: string;
  tp_code: string;
  store_id: string;
  mall_id: string;
  status: "synced" | "created" | "linked" | "conflict" | "error" | "skipped";
  message: string;
};

/** 자식 카페24에서 custom_product_code(tp_code)로 상품 검색 */
async function findByCustomCode(mallId: string, token: string, tpCode: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://${mallId}.cafe24api.com/api/v2/admin/products?custom_product_code=${encodeURIComponent(tpCode)}&limit=1`,
      { headers: { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": API_VERSION } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const list = (data?.products || []) as Array<{ product_no: number }>;
    return list[0]?.product_no ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const productIds: string[] = Array.isArray(body.product_ids) ? body.product_ids : [];
  const storeIds: string[] = Array.isArray(body.store_ids) ? body.store_ids : [];
  const onConflict: "report" | "link" = body.on_conflict === "link" ? "link" : "report";

  if (productIds.length === 0 || storeIds.length === 0) {
    return NextResponse.json({ error: "product_ids와 store_ids가 모두 필요합니다" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 상품 + tp_code 조회
  const { data: products } = await sb
    .from("products")
    .select("id, tp_code, product_name")
    .in("id", productIds);
  if (!products || products.length === 0) {
    return NextResponse.json({ error: "상품을 찾을 수 없습니다" }, { status: 404 });
  }
  const productMap = new Map<string, { id: string; tp_code: string; product_name: string }>();
  for (const p of products) productMap.set(p.id, p);

  // 2. 스토어 조회 (토큰 포함)
  const { data: stores } = await sb
    .from("stores")
    .select("id, mall_id, name, access_token, refresh_token, token_expires_at, status")
    .in("id", storeIds);
  if (!stores || stores.length === 0) {
    return NextResponse.json({ error: "스토어를 찾을 수 없습니다" }, { status: 404 });
  }

  // 3. 기존 매핑 한 번에 조회 (N+1 제거)
  const { data: existingMappings } = await sb
    .from("product_cafe24_mappings")
    .select("product_id, store_id, cafe24_product_no")
    .in("product_id", productIds)
    .in("store_id", storeIds);
  const mappingKey = (pid: string, sid: string) => `${pid}::${sid}`;
  const existingMapByKey = new Map<string, { cafe24_product_no: number | null }>();
  for (const m of existingMappings || []) {
    existingMapByKey.set(mappingKey(m.product_id, m.store_id), { cafe24_product_no: m.cafe24_product_no });
  }

  const conflicts: ConflictRow[] = [];
  const results: ResultRow[] = [];

  // 4. 스토어별로 처리 (스토어당 토큰 1번 발급, 청크 병렬은 sync-bulk 패턴과 별개)
  for (const store of stores) {
    const token = await getStoreToken(store);
    if (!token) {
      for (const product of products) {
        results.push({
          product_id: product.id, tp_code: product.tp_code,
          store_id: store.id, mall_id: store.mall_id,
          status: "error", message: "토큰 없음/만료",
        });
      }
      continue;
    }

    // 5. 상품별 매핑 처리 (직렬 — rate limit 보호)
    const productsToSyncForStore: string[] = [];

    for (const product of products) {
      const key = mappingKey(product.id, store.id);
      const existing = existingMapByKey.get(key);

      if (existing) {
        // 이미 매핑 있음 → 그대로 sync 대상에 추가
        productsToSyncForStore.push(product.id);
        continue;
      }

      // 매핑 없음 → 자식에 같은 tp_code 상품 있는지 검사
      const remoteProductNo = await findByCustomCode(store.mall_id, token, product.tp_code);

      if (remoteProductNo) {
        // 충돌
        if (onConflict === "link") {
          // 그 product_no를 매핑에 연결
          await sb.from("product_cafe24_mappings").upsert(
            {
              product_id: product.id,
              store_id: store.id,
              cafe24_product_no: remoteProductNo,
              sync_status: "synced",
              last_sync_at: new Date().toISOString(),
            },
            { onConflict: "product_id,store_id" }
          );
          productsToSyncForStore.push(product.id);
          results.push({
            product_id: product.id, tp_code: product.tp_code,
            store_id: store.id, mall_id: store.mall_id,
            status: "linked",
            message: `자식 product_no=${remoteProductNo}에 연결, sync 진행`,
          });
        } else {
          // 충돌 보고
          conflicts.push({
            product_id: product.id, tp_code: product.tp_code,
            store_id: store.id, mall_id: store.mall_id,
            cafe24_product_no: remoteProductNo,
            message: `자식 mall에 동일 자체코드 상품이 이미 존재 (product_no=${remoteProductNo}). on_conflict="link"로 다시 호출하면 연결됨.`,
          });
          results.push({
            product_id: product.id, tp_code: product.tp_code,
            store_id: store.id, mall_id: store.mall_id,
            status: "conflict",
            message: "자체코드 중복",
          });
        }
      } else {
        // 깨끗한 신규 매핑 → cafe24_product_no=NULL로 매핑 행 생성 → sync가 POST 처리
        await sb.from("product_cafe24_mappings").upsert(
          {
            product_id: product.id,
            store_id: store.id,
            cafe24_product_no: null,
            sync_status: "pending",
          },
          { onConflict: "product_id,store_id" }
        );
        productsToSyncForStore.push(product.id);
      }
    }

    // 6. 이 스토어 대상으로 sync 일괄 호출 (청크 5 병렬)
    const chunkSize = 5;
    for (let i = 0; i < productsToSyncForStore.length; i += chunkSize) {
      const chunk = productsToSyncForStore.slice(i, i + chunkSize);
      const settled = await Promise.allSettled(
        chunk.map((pid) => syncProductToStores(pid, { storeIds: [store.id] }))
      );
      for (let j = 0; j < settled.length; j++) {
        const pid = chunk[j];
        const product = productMap.get(pid);
        if (!product) continue;
        const r = settled[j];
        if (r.status === "fulfilled") {
          const detail = r.value.results.find((x) => x.store_id === store.id);
          if (detail) {
            results.push({
              product_id: pid, tp_code: product.tp_code,
              store_id: store.id, mall_id: store.mall_id,
              status: detail.status === "created" ? "created" : detail.status === "synced" ? "synced" : detail.status,
              message: detail.error || r.value.message,
            });
          }
        } else {
          results.push({
            product_id: pid, tp_code: product.tp_code,
            store_id: store.id, mall_id: store.mall_id,
            status: "error",
            message: r.reason instanceof Error ? r.reason.message : "sync 예외",
          });
        }
      }
    }
  }

  const totalPairs = productIds.length * storeIds.length;
  const okCount = results.filter((r) => r.status === "synced" || r.status === "created" || r.status === "linked").length;
  const conflictCount = conflicts.length;
  const errorCount = results.filter((r) => r.status === "error" || r.status === "skipped").length;

  return NextResponse.json({
    success: okCount > 0,
    total_pairs: totalPairs,
    ok_count: okCount,
    conflict_count: conflictCount,
    error_count: errorCount,
    conflicts,
    results,
    message: `${totalPairs}개 페어 처리: 성공 ${okCount}${conflictCount > 0 ? `, 충돌 ${conflictCount}` : ""}${errorCount > 0 ? `, 실패 ${errorCount}` : ""}`,
  });
}
