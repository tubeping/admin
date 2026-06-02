import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { loadSupplyContext, computeItem, periodToRange } from "@/lib/settlement-engine";

/**
 * GET /api/settlements/supplier-summary
 * 공급사별 정산 요약 (기간 내 주문 orders 를 supplier 기준으로 직접 집계)
 * ?period=2026-04
 */
export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get("period");
  if (!period) {
    return NextResponse.json({ error: "period 필수" }, { status: 400 });
  }

  const range = periodToRange(period);
  if (!range) {
    return NextResponse.json({ error: "period 형식: YYYY-MM" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 해당 기간 전체 주문 (모든 판매사) — 주문일 기준
  const { data: orders, error } = await sb
    .from("orders")
    .select("*, suppliers(id, name)")
    .gte("order_date", range.startDate)
    .lte("order_date", range.endDate + "T23:59:59");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ suppliers: [] });
  }

  const supplyCtx = await loadSupplyContext(sb, orders);

  // 공급사별 집계
  const map: Record<string, {
    supplier_id: string;
    supplier_name: string;
    item_count: number;
    total_quantity: number;
    total_supply: number;      // 공급가 합계
    total_shipping: number;    // 공급배송비 합계
    total_amount: number;      // 지급 총액
    total_sales: number;       // 판매금액 (정산매출)
    products: Record<string, { name: string; qty: number; supply: number; shipping: number }>;
  }> = {};

  for (const order of orders) {
    const item = computeItem(order, supplyCtx);
    if (item.item_type !== "매출") continue;
    const sid = item.supplier_id || "unassigned";
    const sname = item.supplier_name || "미배정";
    if (!map[sid]) {
      map[sid] = {
        supplier_id: sid,
        supplier_name: sname,
        item_count: 0,
        total_quantity: 0,
        total_supply: 0,
        total_shipping: 0,
        total_amount: 0,
        total_sales: 0,
        products: {},
      };
    }
    const s = map[sid];
    s.item_count++;
    s.total_quantity += item.quantity || 0;
    s.total_supply += item.supply_total || 0;
    s.total_shipping += item.supply_shipping || 0;
    s.total_amount += (item.supply_total || 0) + (item.supply_shipping || 0);
    s.total_sales += item.settled_amount || 0;

    // 상품별
    const pname = item.product_name || "기타";
    if (!s.products[pname]) {
      s.products[pname] = { name: pname, qty: 0, supply: 0, shipping: 0 };
    }
    s.products[pname].qty += item.quantity || 0;
    s.products[pname].supply += item.supply_total || 0;
    s.products[pname].shipping += item.supply_shipping || 0;
  }

  const suppliers = Object.values(map)
    .map((s) => ({
      ...s,
      products: Object.values(s.products).sort((a, b) => b.supply - a.supply),
    }))
    .sort((a, b) => b.total_amount - a.total_amount);

  return NextResponse.json({ suppliers });
}
