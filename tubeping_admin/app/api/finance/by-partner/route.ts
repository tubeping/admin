import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/finance/by-partner?year=2026
 *
 * 거래처(판매사·공급사)별 월별 손익 피벗.
 * 데이터 소스:
 *   - settlements (판매사 정산)       — store별 매출/비용/순익/회사정산/인플루언서정산
 *   - supplier_settlements (공급사 정산) — supplier별 공급가/배송비/합계/건수
 *
 * 응답:
 *   months: [YYYY-MM, ...]
 *   stores: [{ id, name, settlement_type, by_month: { [m]: { total_sales,total_cost,net_profit,company_amount,influencer_amount } }, total: {…} }]
 *   suppliers: [{ id, name, by_month: { [m]: { total_supply,total_shipping,total_amount,total_sales,item_count } }, total: {…} }]
 *   summary: 연간 합계 (회사 종합 손익 추정 포함)
 */
export const dynamic = "force-dynamic";

const SM_KEYS = ["total_sales", "total_cost", "net_profit", "company_amount", "influencer_amount"] as const;
const SP_KEYS = ["total_supply", "total_shipping", "total_amount", "total_sales", "item_count"] as const;

type StoreMetric = Record<typeof SM_KEYS[number], number>;
type SupplierMetric = Record<typeof SP_KEYS[number], number>;

const zeroStore = (): StoreMetric => ({ total_sales: 0, total_cost: 0, net_profit: 0, company_amount: 0, influencer_amount: 0 });
const zeroSupplier = (): SupplierMetric => ({ total_supply: 0, total_shipping: 0, total_amount: 0, total_sales: 0, item_count: 0 });

export async function GET(req: NextRequest) {
  const year = req.nextUrl.searchParams.get("year") || String(new Date().getFullYear());
  try {
    const sb = getServiceClient();

    const [stR, ssR] = await Promise.all([
      sb.from("settlements")
        .select("store_id, period, total_sales, total_cost, net_profit, company_amount, influencer_amount, snap_settlement_type, stores:store_id(name)")
        .like("period", `${year}-%`),
      sb.from("supplier_settlements")
        .select("supplier_id, supplier_name, period, total_supply, total_shipping, total_amount, total_sales, item_count")
        .like("period", `${year}-%`),
    ]);
    if (stR.error) throw new Error(stR.error.message);
    if (ssR.error) throw new Error(ssR.error.message);

    const months: string[] = [];
    for (let m = 1; m <= 12; m++) months.push(`${year}-${String(m).padStart(2, "0")}`);

    // 판매사 집계
    type StoreJoin = { name?: string | null };
    type StoreRow = {
      store_id: string; period: string;
      total_sales: number; total_cost: number; net_profit: number;
      company_amount: number; influencer_amount: number;
      snap_settlement_type: string | null;
      stores: StoreJoin | StoreJoin[] | null;
    };
    const storesMap = new Map<string, { id: string; name: string; settlement_type: string | null; by_month: Record<string, StoreMetric>; total: StoreMetric }>();
    for (const r of (stR.data ?? []) as StoreRow[]) {
      const joined = Array.isArray(r.stores) ? r.stores[0] : r.stores;
      const name = joined?.name || "(이름 없음)";
      const key = r.store_id;
      if (!storesMap.has(key)) storesMap.set(key, { id: key, name, settlement_type: r.snap_settlement_type, by_month: {}, total: zeroStore() });
      const s = storesMap.get(key)!;
      if (!s.by_month[r.period]) s.by_month[r.period] = zeroStore();
      const m = s.by_month[r.period];
      for (const k of SM_KEYS) {
        const v = (r as unknown as Record<string, number>)[k] || 0;
        m[k] += v;
        s.total[k] += v;
      }
      // 가장 최근 정산조건 유지
      if (r.snap_settlement_type) s.settlement_type = r.snap_settlement_type;
    }

    // 공급사 집계
    type SupplierRow = {
      supplier_id: string | null; supplier_name: string; period: string;
      total_supply: number; total_shipping: number; total_amount: number; total_sales: number; item_count: number;
    };
    const suppliersMap = new Map<string, { id: string | null; name: string; by_month: Record<string, SupplierMetric>; total: SupplierMetric }>();
    for (const r of (ssR.data ?? []) as SupplierRow[]) {
      const key = r.supplier_id || `name:${r.supplier_name}`;
      if (!suppliersMap.has(key)) suppliersMap.set(key, { id: r.supplier_id, name: r.supplier_name, by_month: {}, total: zeroSupplier() });
      const s = suppliersMap.get(key)!;
      if (!s.by_month[r.period]) s.by_month[r.period] = zeroSupplier();
      const m = s.by_month[r.period];
      for (const k of SP_KEYS) {
        const v = (r as unknown as Record<string, number>)[k] || 0;
        m[k] += v;
        s.total[k] += v;
      }
    }

    const stores = [...storesMap.values()].sort((a, b) => b.total.total_sales - a.total.total_sales);
    const suppliers = [...suppliersMap.values()].sort((a, b) => b.total.total_amount - a.total.total_amount);

    // 종합: 회사 손익 = (판매사 정산 순익 중 회사 몫) - 공급사 결제(매입은 정산 매출이라기보다 외부 매입원가지만,
    // settlements.total_cost에 이미 원가가 들어가 있으므로 중복 회피 — 회사 종합 손익 = 판매사 net_profit 의 회사몫 합.
    const sales_total = stores.reduce((t, s) => t + s.total.total_sales, 0);
    const cost_total = stores.reduce((t, s) => t + s.total.total_cost, 0);
    const net_total = stores.reduce((t, s) => t + s.total.net_profit, 0);
    const company_total = stores.reduce((t, s) => t + s.total.company_amount, 0);
    const influencer_total = stores.reduce((t, s) => t + s.total.influencer_amount, 0);
    const supplier_amount_total = suppliers.reduce((t, s) => t + s.total.total_amount, 0);
    const supplier_supply_total = suppliers.reduce((t, s) => t + s.total.total_supply, 0);

    // 월별 종합
    const monthly_summary = months.map((m) => {
      let sales = 0, cost = 0, net = 0, company = 0, influencer = 0, sup_amount = 0;
      for (const s of stores) { const mm = s.by_month[m]; if (mm) { sales += mm.total_sales; cost += mm.total_cost; net += mm.net_profit; company += mm.company_amount; influencer += mm.influencer_amount; } }
      for (const s of suppliers) { const mm = s.by_month[m]; if (mm) { sup_amount += mm.total_amount; } }
      return { month: m, sales, cost, net, company, influencer, supplier_amount: sup_amount };
    });

    return NextResponse.json({
      year: Number(year),
      months,
      stores,
      suppliers,
      summary: {
        sales_total, cost_total, net_total, company_total, influencer_total,
        supplier_amount_total, supplier_supply_total,
        store_count: stores.length, supplier_count: suppliers.length,
      },
      monthly_summary,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
