import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * /api/products/[id]/options
 *
 * 028 안전 모드:
 *   - product_options 테이블은 그대로 유지 (정산/seller-portal SELECT 영향 0)
 *   - product_variants에 옵션 가격 컬럼 추가됨
 *   - 이 라우트는 양쪽에 동일 데이터를 dual-write 한다 (코드 레벨 sync)
 *
 *   GET    — product_variants에서 옵션 목록 (옵션 가격 포함)
 *   POST   — 옵션 일괄 upsert → variants + options 양쪽
 *   PATCH  — 단일 옵션 수정 → variants(id) + options(option_text)
 *   DELETE — 옵션 삭제 → variants + options
 */

interface OptionInput {
  option_text: string;
  supply_price?: number;
  retail_price?: number;
  supply_shipping_fee?: number;
  tax_type?: string;
  variant_code?: string | null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("product_variants")
    .select("id, product_id, option_text, supply_price, retail_price, supply_shipping_fee, tax_type, variant_code, created_at, updated_at")
    .eq("product_id", id)
    .not("option_text", "is", null)
    .neq("option_text", "")
    .order("option_text", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ options: data || [] });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const options: OptionInput[] = Array.isArray(body.options) ? body.options : [];
  if (options.length === 0) {
    return NextResponse.json({ error: "options 배열 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 기존 (option_text → variant id) 인덱스
  const { data: existing } = await sb
    .from("product_variants")
    .select("id, option_text")
    .eq("product_id", id)
    .not("option_text", "is", null);
  const existingMap = new Map<string, string>();
  for (const v of existing || []) {
    if (v.option_text) existingMap.set(v.option_text, v.id);
  }

  const cleaned = options
    .map((o) => ({
      option_text: (o.option_text || "").trim(),
      supply_price: Number(o.supply_price) || 0,
      retail_price: Number(o.retail_price) || 0,
      supply_shipping_fee: Number(o.supply_shipping_fee) || 0,
      tax_type: o.tax_type || "과세",
      variant_code: o.variant_code || null,
    }))
    .filter((o) => o.option_text);

  if (cleaned.length === 0) {
    return NextResponse.json({ error: "유효한 옵션 없음" }, { status: 400 });
  }

  const saved: unknown[] = [];

  // 1. product_variants 쪽 upsert
  for (const o of cleaned) {
    const existingId = existingMap.get(o.option_text);
    if (existingId) {
      const { data, error } = await sb
        .from("product_variants")
        .update({
          supply_price: o.supply_price,
          retail_price: o.retail_price,
          supply_shipping_fee: o.supply_shipping_fee,
          tax_type: o.tax_type,
          variant_code: o.variant_code,
        })
        .eq("id", existingId)
        .select("id, product_id, option_text, supply_price, retail_price, supply_shipping_fee, tax_type, variant_code, created_at, updated_at")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (data) saved.push(data);
    } else {
      const eqIdx = o.option_text.indexOf("=");
      const option_name = eqIdx > 0 ? o.option_text.slice(0, eqIdx).trim() : null;
      const option_value = eqIdx > 0 ? o.option_text.slice(eqIdx + 1).trim() : o.option_text;

      const { data, error } = await sb
        .from("product_variants")
        .insert({
          product_id: id,
          variant_code: o.variant_code,
          option_name,
          option_value,
          option_text: o.option_text,
          price: o.retail_price,
          supply_price: o.supply_price,
          retail_price: o.retail_price,
          supply_shipping_fee: o.supply_shipping_fee,
          tax_type: o.tax_type,
          quantity: 0,
          display: "T",
          selling: "T",
        })
        .select("id, product_id, option_text, supply_price, retail_price, supply_shipping_fee, tax_type, variant_code, created_at, updated_at")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (data) saved.push(data);
    }
  }

  // 2. product_options 쪽 upsert (dual-write — 정산/seller-portal이 보는 데이터)
  const optionRows = cleaned.map((o) => ({
    product_id: id,
    option_text: o.option_text,
    supply_price: o.supply_price,
    retail_price: o.retail_price,
    supply_shipping_fee: o.supply_shipping_fee,
    tax_type: o.tax_type,
    variant_code: o.variant_code,
  }));
  const { error: poErr } = await sb
    .from("product_options")
    .upsert(optionRows, { onConflict: "product_id,option_text" });
  if (poErr) {
    return NextResponse.json({
      error: `옵션 가격은 저장됐으나 정산용 미러링 실패: ${poErr.message}`,
      options: saved,
      count: saved.length,
    }, { status: 500 });
  }

  return NextResponse.json({ options: saved, count: saved.length });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { option_id, ...updates } = body as { option_id?: string; [k: string]: unknown };
  if (!option_id) return NextResponse.json({ error: "option_id 필수" }, { status: 400 });

  const allowed = ["supply_price", "retail_price", "supply_shipping_fee", "tax_type", "option_text", "variant_code"];
  const filtered: Record<string, unknown> = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) filtered[k] = updates[k];
  }
  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: "수정할 필드 없음" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. product_variants 업데이트 + 결과로 product_id, option_text 확보
  const { data, error } = await sb
    .from("product_variants")
    .update(filtered)
    .eq("id", option_id)
    .select("id, product_id, option_text, supply_price, retail_price, supply_shipping_fee, tax_type, variant_code, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 2. product_options 미러링 — (product_id, option_text) 기준 upsert
  if (data?.option_text) {
    const poRow = {
      product_id: data.product_id,
      option_text: data.option_text,
      supply_price: data.supply_price,
      retail_price: data.retail_price,
      supply_shipping_fee: data.supply_shipping_fee,
      tax_type: data.tax_type,
      variant_code: data.variant_code,
    };
    const { error: poErr } = await sb
      .from("product_options")
      .upsert(poRow, { onConflict: "product_id,option_text" });
    if (poErr) console.error("[options/PATCH] dual-write failed:", poErr);
  }

  return NextResponse.json({ option: data });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const optionIdFromQuery = url.searchParams.get("option_id");
  const body = await req.json().catch(() => ({}));
  const optionId = optionIdFromQuery || body.option_id;
  if (!optionId) return NextResponse.json({ error: "option_id 필수" }, { status: 400 });

  const sb = getServiceClient();

  // 삭제 전 option_text 조회 → product_options 정리에 사용
  const { data: target } = await sb
    .from("product_variants")
    .select("id, product_id, option_text")
    .eq("id", optionId)
    .maybeSingle();

  const { error } = await sb.from("product_variants").delete().eq("id", optionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // product_options에서 동일 (product_id, option_text) 정리
  // 단, 다른 variant가 같은 option_text를 쓰는 중이면 보존
  if (target?.option_text) {
    const { data: remaining } = await sb
      .from("product_variants")
      .select("id")
      .eq("product_id", target.product_id)
      .eq("option_text", target.option_text)
      .limit(1);
    if (!remaining || remaining.length === 0) {
      await sb
        .from("product_options")
        .delete()
        .eq("product_id", target.product_id)
        .eq("option_text", target.option_text);
    }
  }

  return NextResponse.json({ deleted: true });
}
