import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/supplier-settlements/[id] — 공급사 정산 상세 (아이템 포함)
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

  // 해당 기간의 settlement_items에서 이 공급사 아이템 가져오기
  const { data: settlements } = await sb
    .from("settlements")
    .select("id")
    .eq("period", ss.period);

  let items: Record<string, unknown>[] = [];
  if (settlements && settlements.length > 0) {
    const sIds = settlements.map((s) => s.id);
    let q = sb
      .from("settlement_items")
      .select("*")
      .in("settlement_id", sIds)
      .eq("item_type", "매출")
      .order("product_name");

    if (ss.supplier_id) {
      q = q.eq("supplier_id", ss.supplier_id);
    } else {
      q = q.is("supplier_id", null);
    }

    const { data } = await q;
    items = data || [];
  }

  // 상품별 집계
  const prodMap: Record<
    string,
    { name: string; qty: number; supply: number; shipping: number; sales: number }
  > = {};
  for (const item of items) {
    const pname = (item.product_name as string) || "기타";
    if (!prodMap[pname]) {
      prodMap[pname] = { name: pname, qty: 0, supply: 0, shipping: 0, sales: 0 };
    }
    prodMap[pname].qty += (item.quantity as number) || 0;
    prodMap[pname].supply += (item.supply_total as number) || 0;
    prodMap[pname].shipping += (item.supply_shipping as number) || 0;
    prodMap[pname].sales += (item.settled_amount as number) || 0;
  }

  const products = Object.values(prodMap).sort((a, b) => b.supply - a.supply);

  return NextResponse.json({ supplierSettlement: ss, items, products });
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
