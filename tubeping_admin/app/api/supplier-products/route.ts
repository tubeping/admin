import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/supplier-products — 공급사별 상품가격 목록
 *   ?supplier_id=xxx  (선택) 특정 공급사 필터
 *   ?product_id=xxx   (선택) 특정 상품 필터
 * POST /api/supplier-products — 등록/수정 (upsert)
 * DELETE /api/supplier-products?id=xxx — 삭제
 */

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const supplierId = searchParams.get("supplier_id");
  const productId = searchParams.get("product_id");

  const sb = getServiceClient();
  let query = sb
    .from("supplier_products")
    .select("*, suppliers:supplier_id(id, name), products:product_id(id, product_name, price)")
    .order("created_at", { ascending: false });

  if (supplierId) query = query.eq("supplier_id", supplierId);
  if (productId) query = query.eq("product_id", productId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { supplier_id, product_id, supply_price, supply_shipping_fee, tax_type, supplier_product_code } = body;

  if (!supplier_id || !product_id) {
    return NextResponse.json({ error: "supplier_id, product_id 필수" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("supplier_products")
    .upsert(
      {
        supplier_id,
        product_id,
        supply_price: supply_price || 0,
        supply_shipping_fee: supply_shipping_fee || 0,
        tax_type: tax_type || "과세",
        supplier_product_code: supplier_product_code || null,
      },
      { onConflict: "supplier_id,product_id" }
    )
    .select("*, suppliers:supplier_id(id, name), products:product_id(id, product_name, price)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const sb = getServiceClient();
  const { error } = await sb.from("supplier_products").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
