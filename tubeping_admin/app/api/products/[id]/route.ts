import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const VARIANT_SELECT = "product_variants(id, variant_code, option_name, option_value, price, quantity, display, selling)";
const MAPPING_SELECT = "product_cafe24_mappings(id, store_id, cafe24_product_no, cafe24_product_code, sync_status, last_sync_at)";

/**
 * GET /api/products/[id] — 상품 상세 (매핑 + 배리언트 포함)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("products")
    .select(`*, ${MAPPING_SELECT}, ${VARIANT_SELECT}`)
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: "상품 조회 실패" }, { status: 404 });
  }

  return NextResponse.json({ product: data });
}

/**
 * PUT /api/products/[id] — 상품 수정 (배리언트 포함)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const sb = getServiceClient();

  // 상품 기본 정보 수정
  const update: Record<string, unknown> = {};
  const allowed = ["product_name", "price", "supply_price", "retail_price", "image_url", "selling", "display", "approval_status", "category", "description", "memo", "supplier", "total_stock"];

  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (["price", "supply_price", "retail_price", "total_stock"].includes(key)) {
        update[key] = Number(body[key]) || 0;
      } else {
        update[key] = body[key];
      }
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await sb
      .from("products")
      .update(update)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // 배리언트 수정
  if (body.variants && Array.isArray(body.variants)) {
    for (const v of body.variants) {
      if (v.id) {
        // 기존 배리언트 수정
        const vUpdate: Record<string, unknown> = {};
        if (v.price !== undefined) vUpdate.price = Number(v.price) || 0;
        if (v.quantity !== undefined) vUpdate.quantity = Number(v.quantity) || 0;
        if (v.display !== undefined) vUpdate.display = v.display;
        if (v.selling !== undefined) vUpdate.selling = v.selling;
        if (v.option_name !== undefined) vUpdate.option_name = v.option_name;
        if (v.option_value !== undefined) vUpdate.option_value = v.option_value;

        if (Object.keys(vUpdate).length > 0) {
          await sb.from("product_variants").update(vUpdate).eq("id", v.id);
        }
      } else {
        // 새 배리언트 추가
        await sb.from("product_variants").insert({
          product_id: id,
          variant_code: v.variant_code || null,
          option_name: v.option_name || null,
          option_value: v.option_value || null,
          price: Number(v.price) || 0,
          quantity: Number(v.quantity) || 0,
          display: v.display || "T",
          selling: v.selling || "T",
        });
      }
    }

    // total_stock 재계산
    const { data: allVariants } = await sb
      .from("product_variants")
      .select("quantity")
      .eq("product_id", id);

    if (allVariants) {
      const totalStock = allVariants.reduce((sum, v) => sum + (v.quantity || 0), 0);
      await sb.from("products").update({ total_stock: totalStock }).eq("id", id);
    }
  }

  // 배리언트 삭제
  if (body.delete_variant_ids && Array.isArray(body.delete_variant_ids)) {
    for (const vid of body.delete_variant_ids) {
      await sb.from("product_variants").delete().eq("id", vid);
    }
  }

  // 최신 데이터 반환
  const { data, error: fetchErr } = await sb
    .from("products")
    .select(`*, ${MAPPING_SELECT}, ${VARIANT_SELECT}`)
    .eq("id", id)
    .single();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  return NextResponse.json({ product: data });
}

/**
 * DELETE /api/products/[id] — 상품 삭제
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();

  const { error } = await sb
    .from("products")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
