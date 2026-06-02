import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const VARIANT_SELECT = "product_variants(id, variant_code, option_name, option_value, option_text, price, supply_price, retail_price, supply_shipping_fee, tax_type, quantity, display, selling)";
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
  const allowed = ["tp_code", "product_name", "price", "supply_price", "retail_price", "image_url", "selling", "display", "approval_status", "category", "description", "memo", "supplier", "total_stock", "fulfillment_warehouse_supplier_id"];

  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (["price", "supply_price", "retail_price", "total_stock"].includes(key)) {
        update[key] = Number(body[key]) || 0;
      } else if (key === "tp_code") {
        const v = String(body[key]).trim();
        if (v) update[key] = v;
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
      if (error.code === "23505") {
        return NextResponse.json({ error: "이미 존재하는 자체코드입니다" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // option_text 자동 계산 (option_name + option_value 기반)
  const computeOptionText = (v: Record<string, unknown>): string | null => {
    if (typeof v.option_text === "string" && v.option_text.trim()) return v.option_text.trim();
    const name = typeof v.option_name === "string" ? v.option_name.trim() : "";
    const value = typeof v.option_value === "string" ? v.option_value.trim() : "";
    const joined = `${name}=${value}`.replace(/^=+|=+$/g, "");
    return joined || null;
  };

  // 배리언트 수정
  if (body.variants && Array.isArray(body.variants)) {
    for (const v of body.variants) {
      const optionText = computeOptionText(v);

      if (v.id) {
        // 기존 배리언트 수정
        const vUpdate: Record<string, unknown> = {};
        if (v.price !== undefined) vUpdate.price = Number(v.price) || 0;
        if (v.supply_price !== undefined) vUpdate.supply_price = Number(v.supply_price) || 0;
        if (v.retail_price !== undefined) vUpdate.retail_price = Number(v.retail_price) || 0;
        if (v.supply_shipping_fee !== undefined) vUpdate.supply_shipping_fee = Number(v.supply_shipping_fee) || 0;
        if (v.tax_type !== undefined) vUpdate.tax_type = v.tax_type || "과세";
        if (v.quantity !== undefined) vUpdate.quantity = Number(v.quantity) || 0;
        if (v.display !== undefined) vUpdate.display = v.display;
        if (v.selling !== undefined) vUpdate.selling = v.selling;
        if (v.option_name !== undefined) vUpdate.option_name = v.option_name;
        if (v.option_value !== undefined) vUpdate.option_value = v.option_value;
        if (v.variant_code !== undefined) vUpdate.variant_code = v.variant_code || null;
        if (v.option_text !== undefined || v.option_name !== undefined || v.option_value !== undefined) {
          vUpdate.option_text = optionText;
        }

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
          option_text: optionText,
          price: Number(v.price) || 0,
          supply_price: Number(v.supply_price) || 0,
          retail_price: Number(v.retail_price) || 0,
          supply_shipping_fee: Number(v.supply_shipping_fee) || 0,
          tax_type: v.tax_type || "과세",
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

    // ── Dual-write: product_options에도 미러링 ──
    // 정산/seller-portal이 옛 product_options를 그대로 SELECT하므로
    // variants 저장 시 동일 데이터를 product_options에 upsert (option_text 기준).
    // option_text가 비어 있으면 미러링하지 않음.
    const optionRowsToUpsert = body.variants
      .map((v: Record<string, unknown>) => ({
        v,
        optionText: computeOptionText(v),
      }))
      .filter((r: { optionText: string | null }) => r.optionText && r.optionText.length > 0)
      .map(({ v, optionText }: { v: Record<string, unknown>; optionText: string }) => ({
        product_id: id,
        option_text: optionText,
        supply_price: Number(v.supply_price) || 0,
        retail_price: Number(v.retail_price) || 0,
        supply_shipping_fee: Number(v.supply_shipping_fee) || 0,
        tax_type: typeof v.tax_type === "string" && v.tax_type ? v.tax_type : "과세",
        variant_code: typeof v.variant_code === "string" ? v.variant_code : null,
      }));

    if (optionRowsToUpsert.length > 0) {
      const { error: poErr } = await sb
        .from("product_options")
        .upsert(optionRowsToUpsert, { onConflict: "product_id,option_text" });
      if (poErr) {
        console.error("[products/PUT] product_options dual-write failed:", poErr);
        // dual-write 실패는 운영 차단 사유가 아니므로 로그만 남기고 계속 진행
      }
    }
  }

  // 배리언트 삭제
  if (body.delete_variant_ids && Array.isArray(body.delete_variant_ids)) {
    // 삭제 전에 option_text를 조회해서 product_options에서도 같이 지움 (dual-write)
    const { data: toDelete } = await sb
      .from("product_variants")
      .select("id, option_text")
      .in("id", body.delete_variant_ids);

    for (const vid of body.delete_variant_ids) {
      await sb.from("product_variants").delete().eq("id", vid);
    }

    // 같은 option_text를 가진 product_options 행도 정리
    // (주의: 다른 variant가 같은 option_text를 쓰지 않을 때만)
    const deletedTexts = (toDelete || [])
      .map((v) => v.option_text)
      .filter((t): t is string => !!t && t.length > 0);

    if (deletedTexts.length > 0) {
      // 남은 variants에 동일 option_text가 있는지 확인
      const { data: remaining } = await sb
        .from("product_variants")
        .select("option_text")
        .eq("product_id", id)
        .in("option_text", deletedTexts);
      const stillUsed = new Set((remaining || []).map((r) => r.option_text));
      const safeToDelete = deletedTexts.filter((t) => !stillUsed.has(t));
      if (safeToDelete.length > 0) {
        await sb
          .from("product_options")
          .delete()
          .eq("product_id", id)
          .in("option_text", safeToDelete);
      }
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
