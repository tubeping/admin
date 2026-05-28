import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/settlement-portal?token=xxx
 * 토큰 기반 정산서 공개 조회 (판매사용)
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token 필요" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: settlement, error } = await sb
    .from("settlements")
    .select("*, stores(name, mall_id, settlement_type, influencer_rate, company_rate)")
    .eq("share_token", token)
    .single();

  if (error || !settlement) {
    return NextResponse.json({ error: "정산서를 찾을 수 없습니다" }, { status: 404 });
  }

  // 상세 아이템 (최대 5000건)
  const { data: items } = await sb
    .from("settlement_items")
    .select("*")
    .eq("settlement_id", settlement.id)
    .order("order_date", { ascending: true })
    .limit(5000);

  // 상품별 요약
  const productMap: Record<string, {
    product_name: string; quantity: number; sales: number; cogs: number; shipping: number;
  }> = {};

  for (const item of (items || [])) {
    const key = item.product_name || "기타";
    if (!productMap[key]) {
      productMap[key] = { product_name: key, quantity: 0, sales: 0, cogs: 0, shipping: 0 };
    }
    productMap[key].quantity += item.quantity || 0;
    productMap[key].sales += item.settled_amount || 0;
    productMap[key].cogs += item.supply_total || 0;
    productMap[key].shipping += item.supply_shipping || 0;
  }

  const productSummary = Object.values(productMap)
    .filter(p => p.sales > 0 || p.quantity > 0)
    .sort((a, b) => b.sales - a.sales)
    .map(p => ({
      ...p,
      profit: p.sales - p.cogs - p.shipping,
      margin: p.sales > 0 ? Math.round(((p.sales - p.cogs - p.shipping) / p.sales) * 1000) / 10 : 0,
    }));

  return NextResponse.json({
    settlement,
    items: items || [],
    productSummary,
  });
}
