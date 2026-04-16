import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const MALL_ID = "tubeping";
const API_VERSION = "2026-03-01";

const CLIENT_ID = (process.env.CAFE24_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.CAFE24_CLIENT_SECRET || "").trim();

/* ── DB 기반 토큰 관리 ── */
async function getTokenFromDB(): Promise<string | null> {
  const sb = getServiceClient();
  const { data: store } = await sb.from("stores").select("id, access_token, refresh_token, token_expires_at, mall_id")
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

async function cafe24Fetch(url: string) {
  const token = await getTokenFromDB();
  if (!token) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Cafe24-Api-Version": API_VERSION,
  };

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return res.json();
}

/**
 * POST /api/products/import-cafe24
 * 마스터 몰(tubeping)에서 상품을 가져와 어드민 DB와 동기화
 *  - cafe24_product_no(영구ID) 기준 upsert
 *  - 매핑이 있으면 tp_code(자체코드)와 가격/재고/이름 등을 카페24 기준으로 갱신
 *  - 매핑이 없으면 신규 등록
 *  - tp_code 충돌(다른 상품이 이미 사용 중)은 conflicts로 보고 후 해당 row의 tp_code 갱신은 건너뜀
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sb = getServiceClient();

  // 마스터 스토어 id 확보 (요청에 store_id 없으면 mall_id=tubeping 사용)
  let storeId: string | null = body.store_id ?? null;
  if (!storeId) {
    const { data: masterStore } = await sb
      .from("stores")
      .select("id")
      .eq("mall_id", MALL_ID)
      .single();
    storeId = masterStore?.id ?? null;
  }
  if (!storeId) {
    return NextResponse.json(
      { success: false, error: `마스터 스토어(mall_id=${MALL_ID})를 찾을 수 없습니다.` },
      { status: 400 }
    );
  }

  // 공급사 맵 미리 구축 (supplier_code → supplier_name)
  const supplierMap: Record<string, string> = {};
  try {
    let sOffset = 0;
    const sLimit = 100;
    while (true) {
      const sData = await cafe24Fetch(
        `https://${MALL_ID}.cafe24api.com/api/v2/admin/suppliers?limit=${sLimit}&offset=${sOffset}`
      );
      if (!sData?.suppliers?.length) break;
      for (const s of sData.suppliers) {
        if (s.supplier_code) supplierMap[s.supplier_code] = s.supplier_name || s.supplier_code;
      }
      if (sData.suppliers.length < sLimit) break;
      sOffset += sLimit;
    }
  } catch { /* ignore */ }

  // 기존 매핑/상품을 한 번에 fetch (per-product DB 호출 제거)
  const noToProductId = new Map<number, string>();
  {
    let mOffset = 0;
    const mLimit = 1000;
    while (true) {
      const { data: rows } = await sb
        .from("product_cafe24_mappings")
        .select("product_id, cafe24_product_no")
        .eq("store_id", storeId)
        .range(mOffset, mOffset + mLimit - 1);
      if (!rows?.length) break;
      for (const r of rows) {
        if (r.cafe24_product_no != null) noToProductId.set(r.cafe24_product_no, r.product_id);
      }
      if (rows.length < mLimit) break;
      mOffset += mLimit;
    }
  }

  const tpCodeToProductId = new Map<string, string>();
  const productIdToTpCode = new Map<string, string>();
  {
    let pOffset = 0;
    const pLimit = 1000;
    while (true) {
      const { data: rows } = await sb
        .from("products")
        .select("id, tp_code")
        .range(pOffset, pOffset + pLimit - 1);
      if (!rows?.length) break;
      for (const r of rows) {
        if (r.tp_code) {
          tpCodeToProductId.set(r.tp_code, r.id);
          productIdToTpCode.set(r.id, r.tp_code);
        }
      }
      if (rows.length < pLimit) break;
      pOffset += pLimit;
    }
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const conflicts: { cafe24_product_no: number; new_tp_code: string; reason: string }[] = [];

  // 카페24 마스터 전체 상품 수 확인 (display별로 count)
  let cafeTotalCount = 0;
  try {
    for (const flag of ["T", "F"]) {
      const countData = await cafe24Fetch(
        `https://${MALL_ID}.cafe24api.com/api/v2/admin/products/count?display=${flag}`
      );
      cafeTotalCount += (countData?.count as number) || 0;
    }
  } catch { /* ignore */ }

  // 카페24 상품 전체 로드 (since_product_no 기반, display=T/F 둘 다)
  // offset 기반은 일부 상품이 누락될 수 있어서 since_product_no + limit 방식 사용
  const allCafeProducts: Record<string, unknown>[] = [];
  const seenProductNos = new Set<number>();
  for (const displayFlag of ["T", "F"]) {
    let sinceProductNo = 0;
    const pageLimit = 100;
    for (let safety = 0; safety < 200; safety++) {
      const data = await cafe24Fetch(
        `https://${MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${pageLimit}&since_product_no=${sinceProductNo}&display=${displayFlag}`
      );
      const page = (data?.products || []) as Array<{ product_no: number }>;
      if (page.length === 0) break;
      let maxNo = sinceProductNo;
      for (const p of page) {
        if (!seenProductNos.has(p.product_no)) {
          seenProductNos.add(p.product_no);
          allCafeProducts.push(p as Record<string, unknown>);
        }
        if (p.product_no > maxNo) maxNo = p.product_no;
      }
      if (page.length < pageLimit) break;
      if (maxNo <= sinceProductNo) break; // 무한루프 방지
      sinceProductNo = maxNo;
    }
  }

  // 작업 단위 만들기 (DB 쓰기는 병렬 배치)
  type UpdateJob = { kind: "update"; productId: string; tpCode: string | null; fields: Record<string, unknown>; mapping: Record<string, unknown> };
  type InsertJob = { kind: "insert"; tpCode: string; fields: Record<string, unknown>; mapping: Record<string, unknown>; cafeProductNo: number };
  const jobs: (UpdateJob | InsertJob)[] = [];

  for (const p of allCafeProducts as Array<Record<string, unknown> & { product_no: number; custom_product_code?: string; product_code?: string }>) {
    const customCode: string = (p.custom_product_code || p.product_code) as string;
    if (!customCode) {
      skipped++;
      continue;
    }
    const img = (p.list_image || p.detail_image || p.small_image || null) as string | null;
    const supplierCode = p.supplier_code as string | undefined;
    const supplierName = supplierCode
      ? supplierMap[supplierCode] || supplierCode
      : (p.supplier_name as string | undefined) || null;
    const fieldsBase = {
      product_name: (p.product_name as string) || "",
      price: Math.round(Number(p.price) || 0),
      supply_price: Math.round(Number(p.supply_price) || 0),
      retail_price: Math.round(Number(p.retail_price) || 0),
      image_url: img,
      selling: p.selling === "T" ? "T" : "F",
      description: (p.simple_description as string) || null,
      supplier: supplierName,
    };
    const mappingBase = {
      store_id: storeId,
      cafe24_product_no: p.product_no,
      cafe24_product_code: p.product_code as string,
      sync_status: "synced",
      last_sync_at: new Date().toISOString(),
    };

    let productId = noToProductId.get(p.product_no) || tpCodeToProductId.get(customCode) || null;

    if (productId) {
      const currentTp = productIdToTpCode.get(productId);
      let nextTpCode: string | null = customCode;
      if (currentTp && currentTp !== customCode) {
        const conflictId = tpCodeToProductId.get(customCode);
        if (conflictId && conflictId !== productId) {
          nextTpCode = null;
          conflicts.push({
            cafe24_product_no: p.product_no,
            new_tp_code: customCode,
            reason: `다른 상품이 이미 ${customCode}를 사용 중`,
          });
        }
      }
      const fields = nextTpCode ? { tp_code: nextTpCode, ...fieldsBase } : fieldsBase;
      jobs.push({ kind: "update", productId, tpCode: nextTpCode, fields, mapping: { product_id: productId, ...mappingBase } });
    } else {
      jobs.push({ kind: "insert", tpCode: customCode, fields: { tp_code: customCode, ...fieldsBase, total_stock: 0 }, mapping: mappingBase, cafeProductNo: p.product_no });
    }
  }

  // 병렬 배치 처리 (동시 20)
  const BATCH = 20;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const slice = jobs.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (job) => {
        if (job.kind === "update") {
          await sb.from("products").update(job.fields).eq("id", job.productId);
          await sb
            .from("product_cafe24_mappings")
            .upsert(job.mapping, { onConflict: "product_id,store_id" });
          updated++;
        } else {
          const { data: row, error } = await sb.from("products").insert(job.fields).select("id").single();
          if (error || !row) {
            skipped++;
            return;
          }
          await sb
            .from("product_cafe24_mappings")
            .upsert({ product_id: row.id, ...job.mapping }, { onConflict: "product_id,store_id" });
          imported++;
        }
      })
    );
  }

  return NextResponse.json({
    success: true,
    cafe24_total_count: cafeTotalCount,
    cafe24_fetched: allCafeProducts.length,
    imported,
    updated,
    skipped,
    conflicts,
    message: `카페24 전체 ${cafeTotalCount}건 / fetch ${allCafeProducts.length}건 → 신규 ${imported}건, 갱신 ${updated}건, 스킵 ${skipped}건${conflicts.length ? `, 코드충돌 ${conflicts.length}건` : ""}`,
  });
}
