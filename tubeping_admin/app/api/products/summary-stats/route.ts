import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/products/summary-stats — 상품 요약 통계 (상단 카드용)
 * 전체 상품 수, 판매중 수, 총 매핑 수, 미매핑 수, 카테고리 목록
 */
export async function GET() {
  const sb = getServiceClient();

  const [totalRes, sellingRes, mappingsRes, categoriesRes] = await Promise.all([
    sb.from("products").select("id", { count: "exact", head: true }),
    sb.from("products").select("id", { count: "exact", head: true }).eq("selling", "T"),
    sb.from("product_cafe24_mappings").select("id", { count: "exact", head: true }),
    sb.from("products").select("category").not("category", "is", null),
  ]);

  const total = totalRes.count || 0;
  const selling = sellingRes.count || 0;
  const totalMappings = mappingsRes.count || 0;

  // 미매핑 상품 수: 매핑이 하나도 없는 상품
  const { count: mappedProducts } = await sb
    .from("product_cafe24_mappings")
    .select("product_id", { count: "exact", head: true });

  // distinct mapped product count
  const { data: mappedDistinct } = await sb
    .from("product_cafe24_mappings")
    .select("product_id")
    .limit(10000);

  const uniqueMapped = new Set((mappedDistinct || []).map((r: { product_id: string }) => r.product_id)).size;
  const unmapped = total - uniqueMapped;

  const categories = [...new Set((categoriesRes.data || []).map((r: { category: string }) => r.category))].sort();

  return NextResponse.json({
    total,
    selling,
    totalMappings,
    unmapped,
    categories,
  });
}
