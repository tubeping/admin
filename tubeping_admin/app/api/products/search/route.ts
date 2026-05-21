import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/products/search?q=... — 가벼운 상품 검색
 * stock-alerts 수동 매칭 등에서 사용. id/tp_code/상품명만 반환.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") || "").trim();
  const all = searchParams.get("all") === "1";
  const limit = Math.min(Number(searchParams.get("limit") || "20"), all ? 2000 : 50);

  const sb = getServiceClient();
  let query = sb
    .from("products")
    .select("id, tp_code, product_name, selling, supplier_id")
    .order("product_name")
    .limit(limit);

  if (all) {
    query = query.eq("selling", "T");
  } else {
    if (q.length < 2) {
      return NextResponse.json({ products: [] });
    }
    query = query.or(`product_name.ilike.%${q}%,tp_code.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data || [] });
}
