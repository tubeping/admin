import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * /api/products/[id]/options
 * 상품의 옵션별 공급가/판매가 관리
 *
 *   GET    — 옵션 목록
 *   POST   — 옵션 추가 또는 일괄 upsert (body: { options: [{...}] })
 *   PATCH  — 단일 옵션 수정 (body: { option_id, supply_price?, retail_price?, ... })
 *   DELETE — 옵션 삭제 (body: { option_id } 또는 ?option_id=)
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
    .from("product_options")
    .select("*")
    .eq("product_id", id)
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
  const rows = options
    .filter((o) => o.option_text && o.option_text.trim())
    .map((o) => ({
      product_id: id,
      option_text: o.option_text.trim(),
      supply_price: Number(o.supply_price) || 0,
      retail_price: Number(o.retail_price) || 0,
      supply_shipping_fee: Number(o.supply_shipping_fee) || 0,
      tax_type: o.tax_type || "과세",
      variant_code: o.variant_code || null,
    }));
  if (rows.length === 0) {
    return NextResponse.json({ error: "유효한 옵션 없음" }, { status: 400 });
  }
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("product_options")
    .upsert(rows, { onConflict: "product_id,option_text" })
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ options: data || [], count: data?.length || 0 });
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
  const { data, error } = await sb.from("product_options").update(filtered).eq("id", option_id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ option: data });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const optionIdFromQuery = url.searchParams.get("option_id");
  const body = await req.json().catch(() => ({}));
  const optionId = optionIdFromQuery || body.option_id;
  if (!optionId) return NextResponse.json({ error: "option_id 필수" }, { status: 400 });

  const sb = getServiceClient();
  const { error } = await sb.from("product_options").delete().eq("id", optionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
