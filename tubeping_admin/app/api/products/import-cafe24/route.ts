import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const MALL_ID = process.env.CAFE24_MALL_ID || "tubeping";
const API_VERSION = "2026-03-01";

const APP_CREDENTIALS = [
  { id: process.env.CAFE24_CLIENT_ID || "z87I2H98I55vjYfonHPPhC", secret: process.env.CAFE24_CLIENT_SECRET || "sMdTZQkKLF1kNlBRqsdUTD" },
  { id: "5hl56sAYGJMmmrzCgZqwcC", secret: "vJghZUxLL9tgGmRFvs83BB" },
];

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
  for (const app of APP_CREDENTIALS) {
    try {
      const res = await fetch(`https://${MALL_ID}.cafe24api.com/api/v2/oauth/token`, {
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
      await sb.from("stores").update({
        access_token: data.access_token, refresh_token: data.refresh_token,
        token_expires_at: data.expires_at, updated_at: new Date().toISOString(),
      }).eq("id", store.id);
      return data.access_token;
    } catch { continue; }
  }
  return null;
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

type Cafe24Variant = {
  variant_code: string;
  options?: { name: string; value: string }[];
  price: string | number;
  quantity: number;
  display: string;
  selling: string;
};

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

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const conflicts: { cafe24_product_no: number; new_tp_code: string; reason: string }[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await cafe24Fetch(
      `https://${MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&offset=${offset}`
    );
    if (!data?.products?.length) break;

    for (const p of data.products) {
      const customCode: string = p.custom_product_code || p.product_code;
      if (!customCode) {
        skipped++;
        continue;
      }

      const img = p.list_image || p.detail_image || p.small_image || null;
      const supplierName = p.supplier_code
        ? supplierMap[p.supplier_code] || p.supplier_code
        : p.supplier_name || null;
      const productFieldsBase = {
        product_name: p.product_name || "",
        price: Number(p.price) || 0,
        supply_price: Number(p.supply_price) || 0,
        retail_price: Number(p.retail_price) || 0,
        image_url: img,
        selling: p.selling === "T" ? "T" : "F",
        description: p.simple_description || null,
        supplier: supplierName,
      };

      // 1) cafe24_product_no 기준으로 기존 매핑 찾기
      const { data: existingMapping } = await sb
        .from("product_cafe24_mappings")
        .select("id, product_id")
        .eq("store_id", storeId)
        .eq("cafe24_product_no", p.product_no)
        .maybeSingle();

      let productId: string | null = existingMapping?.product_id ?? null;

      // 2) 매핑 없으면 tp_code(자체코드)로 fallback 매칭
      if (!productId) {
        const { data: byCode } = await sb
          .from("products")
          .select("id")
          .eq("tp_code", customCode)
          .maybeSingle();
        if (byCode) productId = byCode.id;
      }

      // 신규 상품일 때만 배리언트 상세 fetch (속도 최적화)
      let variants: Cafe24Variant[] = [];
      if (!productId) {
        try {
          const detailData = await cafe24Fetch(
            `https://${MALL_ID}.cafe24api.com/api/v2/admin/products/${p.product_no}?embed=options,variants`
          );
          if (detailData?.product?.variants) variants = detailData.product.variants;
        } catch { /* ignore */ }
      }
      const totalStock = variants.length > 0
        ? variants.reduce((sum, v) => sum + (v.quantity || 0), 0)
        : 0;
      // 신규 등록에만 total_stock 포함, 업데이트 시엔 기존 값 유지
      const productFieldsForInsert = { ...productFieldsBase, total_stock: totalStock };
      const productFieldsForUpdate = productFieldsBase;

      if (productId) {
        // 기존 row 갱신 — tp_code 충돌 검사
        const { data: currentRow } = await sb
          .from("products")
          .select("tp_code")
          .eq("id", productId)
          .single();

        let updateTpCode = true;
        if (currentRow && currentRow.tp_code !== customCode) {
          const { data: conflictRow } = await sb
            .from("products")
            .select("id")
            .eq("tp_code", customCode)
            .neq("id", productId)
            .maybeSingle();
          if (conflictRow) {
            updateTpCode = false;
            conflicts.push({
              cafe24_product_no: p.product_no,
              new_tp_code: customCode,
              reason: `다른 상품이 이미 ${customCode}를 사용 중`,
            });
          }
        }

        await sb
          .from("products")
          .update(updateTpCode ? { tp_code: customCode, ...productFieldsForUpdate } : productFieldsForUpdate)
          .eq("id", productId);

        // 매핑 upsert (cafe24_product_code도 갱신)
        await sb
          .from("product_cafe24_mappings")
          .upsert(
            {
              product_id: productId,
              store_id: storeId,
              cafe24_product_no: p.product_no,
              cafe24_product_code: p.product_code,
              sync_status: "synced",
              last_sync_at: new Date().toISOString(),
            },
            { onConflict: "product_id,store_id" }
          );

        updated++;
        continue;
      }

      // 3) 신규 등록
      const { data: newProduct, error } = await sb
        .from("products")
        .insert({ tp_code: customCode, ...productFieldsForInsert })
        .select("id")
        .single();

      if (error || !newProduct) {
        skipped++;
        continue;
      }

      if (variants.length > 0) {
        const variantRows = variants.map((v) => ({
          product_id: newProduct.id,
          variant_code: v.variant_code || null,
          option_name: v.options?.length ? v.options.map((o) => o.name).join("/") : null,
          option_value: v.options?.length ? v.options.map((o) => o.value).join("/") : null,
          price: Number(v.price) || 0,
          quantity: v.quantity || 0,
          display: v.display || "T",
          selling: v.selling || "T",
        }));
        await sb.from("product_variants").insert(variantRows);
      }

      await sb
        .from("product_cafe24_mappings")
        .upsert(
          {
            product_id: newProduct.id,
            store_id: storeId,
            cafe24_product_no: p.product_no,
            cafe24_product_code: p.product_code,
            sync_status: "synced",
            last_sync_at: new Date().toISOString(),
          },
          { onConflict: "product_id,store_id" }
        );

      imported++;
    }

    if (data.products.length < limit) break;
    offset += limit;
  }

  return NextResponse.json({
    success: true,
    imported,
    updated,
    skipped,
    conflicts,
    message: `신규 ${imported}건, 갱신 ${updated}건, 스킵 ${skipped}건${conflicts.length ? `, 코드충돌 ${conflicts.length}건` : ""}`,
  });
}
