import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/products/search?q=... — 가벼운 상품 검색
 * stock-alerts 수동 매칭 등에서 사용. id/tp_code/상품명만 반환.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(Number(searchParams.get("limit") || "20"), 50);
  if (q.length < 2) {
    return NextResponse.json({ products: [] });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("products")
    .select("id, tp_code, product_name, selling, supplier_id")
    .or(`product_name.ilike.%${q}%,tp_code.ilike.%${q}%`)
    .order("product_name")
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data || [] });
}
