import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, cafe24Fetch as _cafe24Fetch, type StoreInfo } from "@/lib/cafe24";
import { coreCode, withSupplierPrefix } from "@/lib/productCode";

const MALL_ID = "tubeping";

/* ── lib/cafe24.ts 기반 통합 토큰 관리 ── */
let _masterStore: StoreInfo | null = null;

async function getMasterStore(): Promise<StoreInfo | null> {
  if (_masterStore) return _masterStore;
  const stores = await getActiveStores();
  _masterStore = stores.find((s) => s.mall_id === MALL_ID) || null;
  return _masterStore;
}

async function cafe24Fetch(url: string) {
  const store = await getMasterStore();
  if (!store) return null;
  // url에서 /api/v2/admin 이후 경로 추출
  const pathMatch = url.match(/\/api\/v2\/admin(.+)/);
  if (!pathMatch) return null;
  const res = await _cafe24Fetch(store, pathMatch[1]);
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
  } catch (e) { console.error("[import-cafe24] 공급사 맵 구축 실패:", e); }

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

  // 코어코드(TP…) 기준 맵 — tp_code 앞에 '공급사명_' 접두사가 붙어도 매칭/충돌 판정은 코어로
  const coreToProductId = new Map<string, string>();
  const productIdToCore = new Map<string, string>();
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
          const core = coreCode(r.tp_code);
          coreToProductId.set(core, r.id);
          productIdToCore.set(r.id, core);
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
  } catch (e) { console.error("[import-cafe24] 카페24 상품 수 조회 실패:", e); }

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

  // 배송비 보강: 목록 응답엔 shipping_fee_type 만 있고 숫자 배송비는 상세의 shipping_rates 에 있음.
  //  - shipping_fee_type='T'(무료) → 0
  //  - 그 외 → 상세를 동시성 제한으로 조회해 shipping_rates[0].shipping_fee 추출 (실패 시 0, 수동수정 가능)
  const shippingByNo = new Map<number, number>();
  {
    const needDetail: number[] = [];
    for (const p of allCafeProducts as Array<{ product_no: number; shipping_fee_type?: string }>) {
      if ((p.shipping_fee_type || "") === "T") shippingByNo.set(p.product_no, 0);
      else needDetail.push(p.product_no);
    }
    const CONC = 12; // 카페24 버킷 ~13건/s
    const BUDGET_MS = 230_000; // Vercel 300s 한도 내 안전 마진 (초과분은 0 유지)
    const startTs = Date.now();
    for (let i = 0; i < needDetail.length; i += CONC) {
      if (Date.now() - startTs > BUDGET_MS) break;
      const slice = needDetail.slice(i, i + CONC);
      await Promise.all(
        slice.map(async (no) => {
          try {
            const d = await cafe24Fetch(`https://${MALL_ID}.cafe24api.com/api/v2/admin/products/${no}`);
            const rates = d?.product?.shipping_rates as Array<{ shipping_fee?: string }> | undefined;
            shippingByNo.set(no, rates && rates[0] ? Math.round(Number(rates[0].shipping_fee) || 0) : 0);
          } catch { shippingByNo.set(no, 0); }
        })
      );
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
      supply_shipping_fee: shippingByNo.get(p.product_no) ?? 0,
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

    // 코어(TP…) 공유키 + 공급사명 접두사 → 공급사 코드 (예: 귀빈정_TPCZ00872)
    const core = coreCode(customCode);
    const desiredTpCode = withSupplierPrefix(core, supplierName);

    const productId = noToProductId.get(p.product_no) || coreToProductId.get(core) || null;

    if (productId) {
      // 코어가 다른 상품 소유면 코드 갱신만 건너뛰고(충돌 보고) 나머지 필드는 갱신
      let nextTpCode: string | null = desiredTpCode;
      const ownerOfCore = coreToProductId.get(core);
      if (ownerOfCore && ownerOfCore !== productId) {
        nextTpCode = null;
        conflicts.push({
          cafe24_product_no: p.product_no,
          new_tp_code: desiredTpCode,
          reason: `다른 상품이 이미 코어 ${core} 를 사용 중`,
        });
      }
      const fields = nextTpCode ? { tp_code: nextTpCode, ...fieldsBase } : fieldsBase;
      jobs.push({ kind: "update", productId, tpCode: nextTpCode, fields, mapping: { product_id: productId, ...mappingBase } });
    } else {
      jobs.push({ kind: "insert", tpCode: desiredTpCode, fields: { tp_code: desiredTpCode, ...fieldsBase, total_stock: 0 }, mapping: mappingBase, cafeProductNo: p.product_no });
    }
  }

  // 병렬 배치 처리 (동시 20, allSettled로 개별 실패 격리)
  let errors = 0;
  const BATCH = 20;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const slice = jobs.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      slice.map(async (job) => {
        if (job.kind === "update") {
          const { error: updErr } = await sb.from("products").update(job.fields).eq("id", job.productId);
          if (updErr) throw updErr;
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
    for (const r of results) {
      if (r.status === "rejected") {
        errors++;
        console.error("[import-cafe24] batch item failed:", r.reason);
      }
    }
  }

  return NextResponse.json({
    success: true,
    cafe24_total_count: cafeTotalCount,
    cafe24_fetched: allCafeProducts.length,
    imported,
    updated,
    skipped,
    conflicts,
    errors,
    message: `카페24 전체 ${cafeTotalCount}건 / fetch ${allCafeProducts.length}건 → 신규 ${imported}건, 갱신 ${updated}건, 스킵 ${skipped}건${errors ? `, 에러 ${errors}건` : ""}${conflicts.length ? `, 코드충돌 ${conflicts.length}건` : ""}`,
  });
}
