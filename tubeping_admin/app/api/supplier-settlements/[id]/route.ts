import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { loadSupplyContext, computeItem, periodToRange } from "@/lib/settlement-engine";

// 상세 집계도 목록/생성과 같은 소스(주문 orders, 출고일 기준)를 읽어야
// 카드 요약과 숫자가 일치한다.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/supplier-settlements/[id] — 공급사 정산 상세 (상품별 + 일자별)
 *
 * 목록/생성(POST)과 동일하게 orders 를 출고일(shipped_at) 기준으로 집계한다.
 * 공급사는 출고일로 청구하므로 상세도 출고일 기준이어야 카드 요약과 일치한다.
 */
export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const sb = getServiceClient();

  const { data: ss, error } = await sb
    .from("supplier_settlements")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !ss) {
    return NextResponse.json({ error: "정산을 찾을 수 없습니다" }, { status: 404 });
  }

  // 해당 기간의 출고 주문을 이 공급사 기준으로 가져온다 (출고일 기준)
  const range = periodToRange(ss.period);
  let items: (ReturnType<typeof computeItem> & { shipped_at: string | null })[] = [];
  if (range) {
    let oq = sb
      .from("orders")
      .select("*, suppliers!supplier_id(id, name)")
      .gte("shipped_at", range.startDate)
      .lte("shipped_at", range.endDate + "T23:59:59");

    if (ss.supplier_id) {
      oq = oq.eq("supplier_id", ss.supplier_id);
    } else {
      oq = oq.is("supplier_id", null);
    }

    const { data: orders } = await oq;
    if (orders && orders.length > 0) {
      const supplyCtx = await loadSupplyContext(sb, orders);
      // 출고일을 보존해 일자별 집계에 사용한다 (computeItem 은 order_date 만 반환)
      items = orders
        .map((o) => ({
          ...computeItem(o, supplyCtx),
          shipped_at: o.shipped_at as string | null,
        }))
        .filter((it) => it.item_type === "매출");
    }
  }

  // 상품별 집계
  const prodMap: Record<
    string,
    { name: string; qty: number; supply: number; shipping: number; sales: number }
  > = {};
  // 일자별 집계 (출고일 기준)
  const dateMap: Record<
    string,
    { date: string; count: number; qty: number; supply: number; shipping: number; sales: number }
  > = {};

  for (const item of items) {
    const pname = item.product_name || "기타";
    if (!prodMap[pname]) {
      prodMap[pname] = { name: pname, qty: 0, supply: 0, shipping: 0, sales: 0 };
    }
    prodMap[pname].qty += item.quantity || 0;
    prodMap[pname].supply += item.supply_total || 0;
    prodMap[pname].shipping += item.supply_shipping || 0;
    prodMap[pname].sales += item.settled_amount || 0;

    const dkey = (item.shipped_at || "").slice(0, 10) || "미상";
    if (!dateMap[dkey]) {
      dateMap[dkey] = { date: dkey, count: 0, qty: 0, supply: 0, shipping: 0, sales: 0 };
    }
    dateMap[dkey].count += 1;
    dateMap[dkey].qty += item.quantity || 0;
    dateMap[dkey].supply += item.supply_total || 0;
    dateMap[dkey].shipping += item.supply_shipping || 0;
    dateMap[dkey].sales += item.settled_amount || 0;
  }

  const products = Object.values(prodMap).sort((a, b) => b.supply - a.supply);
  const byDate = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ supplierSettlement: ss, items, products, byDate });
}

/**
 * PATCH /api/supplier-settlements/[id] — 상태 변경
 * body: { status, memo?, invoice_no? }
 *
 * 상태 플로우: draft → sent → confirmed → invoiced → paid
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json();
  const { status, memo, invoice_no } = body;

  const sb = getServiceClient();

  const update: Record<string, unknown> = {};

  if (status) {
    update.status = status;
    const now = new Date().toISOString();
    if (status === "sent") update.sent_at = now;
    if (status === "confirmed") update.confirmed_at = now;
    if (status === "invoiced") update.invoiced_at = now;
    if (status === "paid") update.paid_at = now;
  }

  if (memo !== undefined) update.memo = memo;
  if (invoice_no !== undefined) update.invoice_no = invoice_no;

  const { data, error } = await sb
    .from("supplier_settlements")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ supplierSettlement: data });
}
