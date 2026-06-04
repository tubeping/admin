import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/settlement-portal?token=xxx[&period=YYYY-MM]
 * 토큰 기반 정산서 공개 조회 (판매사용)
 * - token 으로 판매사(store)를 인증한다.
 * - period 지정 시 같은 판매사의 해당 월 정산서를 조회 (월 전환 지원).
 * - availablePeriods: 해당 판매사가 조회 가능한 월 목록.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const period = request.nextUrl.searchParams.get("period");
  if (!token) {
    return NextResponse.json({ error: "token 필요" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1) 토큰 → 기준 정산서 (판매사 인증)
  const { data: base, error: baseErr } = await sb
    .from("settlements")
    .select("id, store_id, period, share_token")
    .eq("share_token", token)
    .single();

  if (baseErr || !base) {
    return NextResponse.json({ error: "정산서를 찾을 수 없습니다" }, { status: 404 });
  }

  // 2) 같은 판매사가 조회 가능한 월 목록
  const { data: periodRows } = await sb
    .from("settlements")
    .select("period, share_token, status")
    .eq("store_id", base.store_id)
    .order("period", { ascending: false });
  const availablePeriods = (periodRows || []).map((r) => ({
    period: r.period,
    share_token: r.share_token,
    status: r.status,
  }));

  // 3) 조회 대상: period 지정 시 같은 store 의 해당 월, 아니면 기준 정산서
  let settlementQuery = sb
    .from("settlements")
    .select("*, stores(name, mall_id, settlement_type, influencer_rate, company_rate)")
    .eq("store_id", base.store_id);
  settlementQuery = period
    ? settlementQuery.eq("period", period)
    : settlementQuery.eq("id", base.id);

  const { data: settlement, error } = await settlementQuery.single();

  if (error || !settlement) {
    return NextResponse.json({ error: "해당 월 정산서를 찾을 수 없습니다" }, { status: 404 });
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
    availablePeriods,
  });
}
