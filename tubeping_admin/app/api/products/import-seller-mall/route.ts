import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, isCafe24Mall, cafe24Fetch } from "@/lib/cafe24";
import { coreCode, normalizeName, withSellerPrefix } from "@/lib/productCode";

export const maxDuration = 300;

const MASTER_MALL_ID = "tubeping";

/**
 * POST /api/products/import-seller-mall  body: { store_id }
 *
 * 판매사 자사몰(서브몰)에서 상품을 가져와 그 판매사의 실제 판매가·배송비를
 * product_cafe24_mappings(상품↔몰) 행에 오버레이한다. (마스터 products 카탈로그는 1상품=1행 유지)
 *
 * 매칭: ① 판매사몰 custom_product_code 의 코어(TP…) == 마스터 tp_code 코어  (우선)
 *       ② 상품명 정규화 매칭                                              (폴백)
 * 미매칭(마스터에 없는 판매사 전용/미등록 상품)은 unmatched 보류 리포트로 분리.
 *
 * 가격 캡처: seller_price = price, seller_shipping_fee = shipping_rates[0].shipping_fee
 *   (shipping_fee_type='T' 무료는 0, 그 외만 상세 조회)
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const storeId: string | null = body.store_id ?? null;
  if (!storeId) {
    return NextResponse.json({ success: false, error: "store_id 가 필요합니다." }, { status: 400 });
  }

  const sb = getServiceClient();

  // 대상 판매사몰 store 확보 (active Cafe24 몰, 마스터 제외)
  const stores = await getActiveStores();
  const store = stores.find((s) => s.id === storeId) || null;
  if (!store) {
    return NextResponse.json({ success: false, error: "스토어를 찾을 수 없거나 active 가 아닙니다." }, { status: 404 });
  }
  if (store.mall_id === MASTER_MALL_ID) {
    return NextResponse.json({ success: false, error: "마스터몰은 '카페24 가져오기'로 수집합니다." }, { status: 400 });
  }
  if (!isCafe24Mall(store.mall_id)) {
    return NextResponse.json({ success: false, error: "카페24 연동 판매사몰이 아닙니다(수기 스토어)." }, { status: 400 });
  }

  const storeName = store.name || store.mall_id;

  // 마스터 상품 인덱스: 코어 → product_id, 정규화 상품명 → product_id, product_id → 코어
  const coreToProductId = new Map<string, string>();
  const nameToProductId = new Map<string, string>();
  const productIdToCore = new Map<string, string>();
  {
    let off = 0;
    const lim = 1000;
    while (true) {
      const { data: rows } = await sb
        .from("products")
        .select("id, tp_code, product_name")
        .range(off, off + lim - 1);
      if (!rows?.length) break;
      for (const r of rows) {
        const core = coreCode(r.tp_code);
        if (core) {
          coreToProductId.set(core, r.id);
          productIdToCore.set(r.id, core);
        }
        const nk = normalizeName(r.product_name || "");
        if (nk && !nameToProductId.has(nk)) nameToProductId.set(nk, r.id);
      }
      if (rows.length < lim) break;
      off += lim;
    }
  }

  // 판매사몰 전체 상품 로드 (since_product_no, display T/F)
  type CafeProduct = {
    product_no: number;
    product_code?: string;
    custom_product_code?: string;
    product_name?: string;
    price?: string | number;
    shipping_fee_type?: string;
  };
  const allCafe: CafeProduct[] = [];
  const seen = new Set<number>();
  for (const displayFlag of ["T", "F"]) {
    let since = 0;
    for (let safety = 0; safety < 200; safety++) {
      const res = await cafe24Fetch(
        store,
        `/products?limit=100&since_product_no=${since}&display=${displayFlag}`
      );
      if (!res.ok) break;
      const data = await res.json().catch(() => null);
      const page = (data?.products || []) as CafeProduct[];
      if (page.length === 0) break;
      let maxNo = since;
      for (const p of page) {
        if (!seen.has(p.product_no)) {
          seen.add(p.product_no);
          allCafe.push(p);
        }
        if (p.product_no > maxNo) maxNo = p.product_no;
      }
      if (page.length < 100 || maxNo <= since) break;
      since = maxNo;
    }
  }

  // 배송비 보강: 무료(shipping_fee_type='T')는 0, 그 외는 상세의 shipping_rates[0].shipping_fee.
  //  - 동시성 12 (카페24 버킷 ~13건/s 관측 → 700건 ≈ 1분).
  //  - 시간예산 초과(초대형 카탈로그) 분은 null 로 두고 price 는 그대로 저장 → 재실행 시 보강.
  const shippingByNo = new Map<number, number | null>();
  {
    const needDetail: number[] = [];
    for (const p of allCafe) {
      if ((p.shipping_fee_type || "") === "T") shippingByNo.set(p.product_no, 0);
      else needDetail.push(p.product_no);
    }
    const CONC = 12;
    const BUDGET_MS = 230_000; // Vercel 300s 한도 내 안전 마진
    const startTs = Date.now();
    for (let i = 0; i < needDetail.length; i += CONC) {
      if (Date.now() - startTs > BUDGET_MS) break; // 초과분은 미설정 → null
      const slice = needDetail.slice(i, i + CONC);
      await Promise.all(
        slice.map(async (no) => {
          try {
            const r = await cafe24Fetch(store, `/products/${no}`);
            const d = r.ok ? await r.json() : null;
            const rates = d?.product?.shipping_rates as Array<{ shipping_fee?: string }> | undefined;
            shippingByNo.set(no, rates && rates[0] ? Math.round(Number(rates[0].shipping_fee) || 0) : 0);
          } catch {
            shippingByNo.set(no, null);
          }
        })
      );
    }
  }

  // 매칭 → 매핑 upsert job
  type UpsertRow = {
    product_id: string;
    store_id: string;
    cafe24_product_no: number;
    cafe24_product_code: string | null;
    seller_price: number;
    seller_shipping_fee: number | null;
    seller_product_code: string;
    seller_synced_at: string;
    sync_status: string;
    last_sync_at: string;
  };
  const upserts: UpsertRow[] = [];
  const unmatched: { cafe24_product_no: number; product_name: string; custom_product_code: string }[] = [];
  const now = new Date().toISOString();

  for (const p of allCafe) {
    const cc = (p.custom_product_code || p.product_code || "").trim();
    const core = coreCode(cc);
    let productId = (core && coreToProductId.get(core)) || null;
    if (!productId) {
      const nk = normalizeName(p.product_name || "");
      productId = (nk && nameToProductId.get(nk)) || null;
    }
    if (!productId) {
      unmatched.push({
        cafe24_product_no: p.product_no,
        product_name: p.product_name || "",
        custom_product_code: cc,
      });
      continue;
    }
    const masterCore = productIdToCore.get(productId) || core;
    upserts.push({
      product_id: productId,
      store_id: storeId,
      cafe24_product_no: p.product_no,
      cafe24_product_code: p.product_code || null,
      seller_price: Math.round(Number(p.price) || 0),
      seller_shipping_fee: shippingByNo.get(p.product_no) ?? null,
      seller_product_code: withSellerPrefix(masterCore, storeName),
      seller_synced_at: now,
      sync_status: "synced",
      last_sync_at: now,
    });
  }

  // 병렬 배치 upsert (onConflict product_id,store_id)
  let matched = 0;
  let errors = 0;
  const BATCH = 20;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const slice = upserts.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      slice.map(async (row) => {
        const { error } = await sb
          .from("product_cafe24_mappings")
          .upsert(row, { onConflict: "product_id,store_id" });
        if (error) throw error;
        matched++;
      })
    );
    for (const r of results) {
      if (r.status === "rejected") {
        errors++;
        console.error("[import-seller-mall] upsert 실패:", r.reason);
      }
    }
  }

  return NextResponse.json({
    success: true,
    store: storeName,
    store_id: storeId,
    cafe24_fetched: allCafe.length,
    matched,
    unmatched,
    unmatched_count: unmatched.length,
    errors,
    message: `${storeName}: 카페24 ${allCafe.length}건 → 매칭 ${matched}건, 보류(미매칭) ${unmatched.length}건${errors ? `, 에러 ${errors}건` : ""}`,
  });
}
