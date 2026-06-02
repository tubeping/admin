import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { loadSupplyContext, computeItem, type ComputedItem } from "@/lib/settlement-engine";

/**
 * POST /api/settlements/calculate
 * 정산서 자동 계산 + 생성
 * body: {
 *   store_id, period: "2026-03",
 *   include_no_tracking?: boolean,   // 송장미등록건 포함 여부 (기본: true)
 *   date_basis?: "order_date" | "shipped_at",  // 정산 기준: 주문일 / 송장등록일
 *   start_date?: string,             // 정산 시작일 (기본: 기간 1일)
 *   end_date?: string,               // 정산 종료일 (기본: 기간 말일)
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { store_id, period, include_no_tracking = true, date_basis = "order_date", start_date: customStart, end_date: customEnd } = body;

  if (!store_id || !period) {
    return NextResponse.json({ error: "store_id, period 필수" }, { status: 400 });
  }

  // 기간 파싱
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) {
    return NextResponse.json({ error: "period 형식: YYYY-MM" }, { status: 400 });
  }
  const startDate = customStart || `${period}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = customEnd || `${period}-${String(lastDay).padStart(2, "0")}`;

  const sb = getServiceClient();

  // ── 1. 스토어(판매사) 정보 ──
  const { data: store, error: storeErr } = await sb
    .from("stores")
    .select("*")
    .eq("id", store_id)
    .single();

  if (storeErr || !store) {
    return NextResponse.json({ error: "스토어를 찾을 수 없습니다" }, { status: 404 });
  }

  const infRate = Number(store.influencer_rate ?? 70) / 100;
  const coRate = Number(store.company_rate ?? 30) / 100;
  const pgFeeRate = Number(store.pg_fee_rate ?? 3.74) / 100;
  const settlementType = store.settlement_type || "사업자";
  const tplCost = Number(store.tpl_cost ?? 0);
  const otherCost = Number(store.other_cost ?? 0);

  // ── 2. 해당 기간 주문 가져오기 ──
  // date_basis: 정산 기준 날짜 필드 선택
  const dateField = date_basis === "shipped_at" ? "shipped_at" : "order_date";

  let ordQuery = sb
    .from("orders")
    .select("*, suppliers(id, name)")
    .eq("store_id", store_id)
    .gte(dateField, startDate)
    .lte(dateField, endDate + "T23:59:59")
    .order("order_date", { ascending: true });

  // 송장등록일 기준이면 shipped_at이 null인 건은 자동 제외됨
  // 주문일 기준 + 송장미등록건 제외 옵션
  if (date_basis === "order_date" && !include_no_tracking) {
    ordQuery = ordQuery.or("tracking_number.neq.,shipping_status.eq.cancelled");
  }

  const { data: orders, error: ordErr } = await ordQuery;

  if (ordErr) {
    return NextResponse.json({ error: ordErr.message }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: "해당 기간에 주문이 없습니다" }, { status: 400 });
  }

  // ── 3. 공급가 컨텍스트 (공용 엔진) ──
  // 공급가 lookup·면세 VAT·샘플/취소/증정 처리는 settlement-engine 한 곳에서 관리.
  const supplyCtx = await loadSupplyContext(sb, orders);

  // ── 4. 주문별 정산 계산 ──
  const items: ComputedItem[] = [];
  let cafe24Sales = 0;
  const phoneSales = 0;
  let refundTotal = 0;

  for (const order of orders) {
    const item = computeItem(order, supplyCtx, store.name || "");
    items.push(item);

    if (item.item_type === "취소") {
      refundTotal += item.settled_amount;
    } else {
      // 증정은 settled_amount=0 이라 가산해도 영향 없음
      cafe24Sales += item.settled_amount;
    }
  }

  const totalSales = cafe24Sales + phoneSales + refundTotal;

  // ── 5. 비용 계산 ──
  const activeItems = items.filter((i) => i.item_type === "매출");

  // PG수수료 (전화주문 제외)
  const pgFee = Math.round(cafe24Sales * pgFeeRate);

  // 제품원가/배송비 (과세/면세 분리)
  let cogsTaxable = 0, cogsExempt = 0, cogsExemptVat = 0;
  let shipTaxable = 0, shipExempt = 0, shipExemptVat = 0;

  for (const item of activeItems) {
    if (item.tax_type === "면세") {
      // 이미 1.1배 된 금액 → 원가/VAT 분리
      const rawCogs = Math.round(item.supply_total / 1.1);
      cogsExempt += rawCogs;
      cogsExemptVat += item.supply_total - rawCogs;
      const rawShip = Math.round(item.supply_shipping / 1.1);
      shipExempt += rawShip;
      shipExemptVat += item.supply_shipping - rawShip;
    } else {
      cogsTaxable += item.supply_total;
      shipTaxable += item.supply_shipping;
    }
  }

  const totalCogs = cogsTaxable + cogsExempt + cogsExemptVat;
  const totalShipping = shipTaxable + shipExempt + shipExemptVat;

  // 총비용
  const costBeforeVat = pgFee + totalCogs + totalShipping + tplCost + otherCost;
  let vatAmount = 0;

  if (settlementType === "프리랜서") {
    const profitBeforeVat = totalSales - costBeforeVat;
    vatAmount = profitBeforeVat > 0 ? Math.round(profitBeforeVat * 0.1) : 0;
  }

  const totalCost = costBeforeVat + vatAmount;
  const netProfit = totalSales - totalCost;
  const profitRate = totalSales > 0 ? Math.round((netProfit / totalSales) * 1000) / 10 : 0;

  // ── 6. 분배 ──
  const influencerAmount = netProfit > 0 ? Math.round(netProfit * infRate) : 0;
  const withholdingTax = settlementType === "프리랜서" && influencerAmount > 0
    ? Math.round(influencerAmount * 0.033) : 0;
  const influencerActual = influencerAmount - withholdingTax;
  const companyAmount = netProfit > 0 ? Math.round(netProfit * coRate) : 0;

  // ── 7. 기존 정산 체크 (같은 기간 draft면 덮어쓰기) ──
  const { data: existing } = await sb
    .from("settlements")
    .select("id, status")
    .eq("store_id", store_id)
    .eq("period", period)
    .single();

  if (existing && existing.status !== "draft") {
    return NextResponse.json({
      error: `이미 ${existing.status === "confirmed" ? "확정" : "지급완료"}된 정산이 있습니다. 삭제 후 재생성하세요.`,
    }, { status: 409 });
  }

  // 기존 draft 삭제 (CASCADE로 items도 삭제)
  if (existing) {
    await sb.from("settlements").delete().eq("id", existing.id);
  }

  // ── 8. 정산번호 생성 ──
  const { data: seqData } = await sb.rpc("generate_settlement_no", { p_period: period });
  const settlementNo = seqData || `STL-${period.replace("-", "")}-001`;

  // ── 9. 저장 ──
  const { data: settlement, error: insErr } = await sb
    .from("settlements")
    .insert({
      settlement_no: settlementNo,
      store_id,
      period,
      start_date: startDate,
      end_date: endDate,
      cafe24_sales: cafe24Sales,
      phone_sales: phoneSales,
      refund_amount: refundTotal,
      total_sales: totalSales,
      pg_fee: pgFee,
      cogs_taxable: cogsTaxable,
      cogs_exempt: cogsExempt,
      cogs_exempt_vat: cogsExemptVat,
      total_cogs: totalCogs,
      ship_taxable: shipTaxable,
      ship_exempt: shipExempt,
      ship_exempt_vat: shipExemptVat,
      total_shipping: totalShipping,
      tpl_cost: tplCost,
      other_cost: otherCost,
      vat_amount: vatAmount,
      total_cost: totalCost,
      net_profit: netProfit,
      profit_rate: profitRate,
      influencer_amount: influencerAmount,
      withholding_tax: withholdingTax,
      influencer_actual: influencerActual,
      company_amount: companyAmount,
      snap_influencer_rate: store.influencer_rate,
      snap_company_rate: store.company_rate,
      snap_settlement_type: settlementType,
      snap_pg_fee_rate: store.pg_fee_rate,
      status: "draft",
      total_orders: new Set(orders.map((o: Record<string, unknown>) => o.cafe24_order_id)).size,
      total_items: items.length,
    })
    .select()
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // 상세 아이템 저장
  const itemRows = items.map((item) => ({
    settlement_id: settlement.id,
    ...item,
  }));

  // 50개씩 배치 삽입
  for (let i = 0; i < itemRows.length; i += 50) {
    const batch = itemRows.slice(i, i + 50);
    const { error: itemErr } = await sb.from("settlement_items").insert(batch);
    if (itemErr) {
      console.error("settlement_items insert error:", itemErr);
    }
  }

  return NextResponse.json({ settlement });
}
