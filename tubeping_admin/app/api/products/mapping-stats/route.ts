import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/products/mapping-stats — 스토어별 매핑 통계
 */
export async function GET() {
  const sb = getServiceClient();

  const { data: stores } = await sb
    .from("stores")
    .select("id, name, mall_id, status, channel")
    .neq("status", "paused")
    .order("created_at");

  if (!stores) return NextResponse.json({ stats: [] });

  const { count: totalProducts } = await sb
    .from("products")
    .select("id", { count: "exact", head: true });

  const stats = [];
  for (const store of stores) {
    const { count: mapped } = await sb
      .from("product_cafe24_mappings")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id);

    stats.push({
      id: store.id,
      name: store.name,
      mall_id: store.mall_id,
      status: store.status,
      channel: store.channel,
      mapped: mapped || 0,
      unmapped: (totalProducts || 0) - (mapped || 0),
      total: totalProducts || 0,
    });
  }

  return NextResponse.json({ stats, totalProducts });
}
