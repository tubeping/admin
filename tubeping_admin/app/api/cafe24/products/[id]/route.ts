import { NextRequest, NextResponse } from "next/server";
import { getActiveStores, cafe24Fetch, type StoreInfo } from "@/lib/cafe24";

const MALL_ID = "tubeping";

let _store: StoreInfo | null = null;
async function getMasterStore(): Promise<StoreInfo | null> {
  if (_store) return _store;
  const stores = await getActiveStores();
  _store = stores.find((s) => s.mall_id === MALL_ID) || null;
  return _store;
}

async function cafe24Request(path: string, options?: RequestInit) {
  const store = await getMasterStore();
  if (!store) return { ok: false, status: 500, data: null, error: "마스터 스토어 없음" };

  const res = await cafe24Fetch(store, path, options);
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, status: res.status, data: null, error: err };
  }
  return { ok: true, status: res.status, data: await res.json(), error: null };
}

/**
 * GET /api/cafe24/products/[id]
 * 상품 상세 조회 (옵션, 배리언트 포함)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const productRes = await cafe24Request(`/products/${id}?embed=options,variants`);

  if (!productRes.ok) {
    return NextResponse.json(
      { error: "상품 조회 실패", detail: productRes.error },
      { status: productRes.status }
    );
  }

  return NextResponse.json(productRes.data);
}

/**
 * PUT /api/cafe24/products/[id]
 * 상품 수정 (판매가, 공급가, 재고, 배송, 옵션 등)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  // 1. 상품 기본 정보 수정
  const productUpdate: Record<string, unknown> = {};

  if (body.product_name !== undefined) productUpdate.product_name = body.product_name;
  if (body.price !== undefined) productUpdate.price = body.price;
  if (body.supply_price !== undefined) productUpdate.supply_price = body.supply_price;
  if (body.retail_price !== undefined) productUpdate.retail_price = body.retail_price;
  if (body.selling !== undefined) productUpdate.selling = body.selling;
  if (body.simple_description !== undefined) productUpdate.simple_description = body.simple_description;
  if (body.description !== undefined) productUpdate.description = body.description;

  // 배송 관련
  if (body.shipping_scope !== undefined) productUpdate.shipping_scope = body.shipping_scope;
  if (body.shipping_fee_type !== undefined) productUpdate.shipping_fee_type = body.shipping_fee_type;
  if (body.shipping_rates !== undefined) productUpdate.shipping_rates = body.shipping_rates;
  if (body.shipping_fee !== undefined) productUpdate.shipping_fee = body.shipping_fee;
  if (body.prepaid_shipping_fee !== undefined) productUpdate.prepaid_shipping_fee = body.prepaid_shipping_fee;
  if (body.clearance_category_code !== undefined) productUpdate.clearance_category_code = body.clearance_category_code;

  if (Object.keys(productUpdate).length > 0) {
    const res = await cafe24Request(`/products/${id}`, {
      method: "PUT",
      body: JSON.stringify({ shop_no: 1, request: productUpdate }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "상품 수정 실패", detail: res.error },
        { status: res.status }
      );
    }
  }

  // 2. 배리언트(재고/옵션별 가격) 수정
  if (body.variants && Array.isArray(body.variants)) {
    for (const variant of body.variants) {
      if (!variant.variant_code) continue;

      const variantUpdate: Record<string, unknown> = {};
      if (variant.quantity !== undefined) variantUpdate.quantity = variant.quantity;
      if (variant.price !== undefined) variantUpdate.price = variant.price;
      if (variant.display !== undefined) variantUpdate.display = variant.display;
      if (variant.selling !== undefined) variantUpdate.selling = variant.selling;

      if (Object.keys(variantUpdate).length > 0) {
        await cafe24Request(`/products/${id}/variants/${variant.variant_code}`, {
          method: "PUT",
          body: JSON.stringify({ shop_no: 1, request: variantUpdate }),
        });
      }
    }
  }

  // 수정 후 최신 상품 정보 반환
  const updatedRes = await cafe24Request(`/products/${id}?embed=options,variants`);

  if (!updatedRes.ok) {
    return NextResponse.json({ success: true, message: "수정 완료 (상세 재조회 실패)" });
  }

  return NextResponse.json({ success: true, product: updatedRes.data?.product });
}
