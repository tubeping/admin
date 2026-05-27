"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

interface Settlement {
  id: string;
  settlement_no: string;
  period: string;
  start_date: string;
  end_date: string;
  cafe24_sales: number;
  phone_sales: number;
  refund_amount: number;
  total_sales: number;
  pg_fee: number;
  cogs_taxable: number;
  cogs_exempt: number;
  cogs_exempt_vat: number;
  total_cogs: number;
  ship_taxable: number;
  ship_exempt: number;
  ship_exempt_vat: number;
  total_shipping: number;
  tpl_cost: number;
  other_cost: number;
  vat_amount: number;
  total_cost: number;
  net_profit: number;
  profit_rate: number;
  influencer_amount: number;
  withholding_tax: number;
  influencer_actual: number;
  company_amount: number;
  snap_influencer_rate: number;
  snap_company_rate: number;
  snap_settlement_type: string;
  snap_pg_fee_rate: number;
  status: string;
  total_orders: number;
  total_items: number;
  seller_confirmed: boolean;
  seller_confirmed_at: string | null;
  stores?: { name: string };
}

interface SettlementItem {
  id: string;
  cafe24_order_id: string;
  order_date: string;
  product_name: string;
  option_text: string;
  quantity: number;
  product_price: number;
  settled_amount: number;
  supply_total: number;
  supply_shipping: number;
  item_type: string;
  sales_channel: string;
  tax_type: string;
  supplier_name: string;
  shipping_fee: number;
}

interface ProductSummary {
  product_name: string;
  quantity: number;
  sales: number;
  cogs: number;
  shipping: number;
  profit: number;
  margin: number;
}

const W = (n: number) => `₩${n.toLocaleString()}`;
const CH: Record<string, string> = { cafe24: "자사몰", phone: "전화", sms: "문자", sample: "샘플", group: "공구" };
const CH_COLOR: Record<string, string> = {
  cafe24: "bg-blue-50 text-blue-700",
  phone: "bg-amber-50 text-amber-700",
  sms: "bg-purple-50 text-purple-700",
  sample: "bg-gray-100 text-gray-600",
  group: "bg-pink-50 text-pink-700",
};

export default function SettlementPortalPage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [tab, setTab] = useState<"summary" | "orders" | "products">("summary");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/settlement-portal?token=${token}`);
      if (!res.ok) { setError("정산서를 찾을 수 없습니다"); return; }
      const data = await res.json();
      setSettlement(data.settlement);
      setItems(data.items);
      setProducts(data.productSummary);
      setConfirmed(data.settlement.seller_confirmed || false);
      setConfirmedAt(data.settlement.seller_confirmed_at || null);
    } catch {
      setError("데이터를 불러올 수 없습니다");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleConfirm = async () => {
    if (!confirm("정산 내용을 확인하고 확정합니다.\n확정 후에는 취소할 수 없습니다.\n\n계속하시겠습니까?")) return;
    setConfirming(true);
    try {
      const res = await fetch("/admin/api/settlement-portal/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfirmed(true);
        setConfirmedAt(data.confirmed_at);
      }
    } finally {
      setConfirming(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
        <p className="text-sm text-slate-400">정산서를 불러오는 중...</p>
      </div>
    </div>
  );

  if (error || !settlement) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 flex items-center justify-center">
      <div className="text-center bg-white rounded-2xl shadow-sm border border-gray-100 px-12 py-10">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
        </div>
        <p className="text-gray-500 text-sm">{error || "정산서를 찾을 수 없습니다"}</p>
      </div>
    </div>
  );

  const s = settlement;
  const storeName = s.stores?.name || "판매자";
  const infPct = s.snap_influencer_rate ?? 70;
  const coPct = s.snap_company_rate ?? 30;
  const sType = s.snap_settlement_type || "사업자";

  const periodLabel = (() => {
    const [y, m] = s.period.split("-");
    return `${y}년 ${parseInt(m)}월`;
  })();

  // 주문 상세 합계
  const orderTotals = items.reduce((acc, item) => {
    acc.settled += item.settled_amount;
    acc.supply += item.supply_total;
    acc.profit += item.settled_amount - item.supply_total - item.supply_shipping;
    return acc;
  }, { settled: 0, supply: 0, profit: 0 });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/60 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center shadow-sm shadow-red-200">
                <span className="text-white text-[11px] font-extrabold tracking-tight">TP</span>
              </div>
              <div>
                <h1 className="text-[15px] font-bold text-gray-900 leading-tight">{storeName} 정산서</h1>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {s.settlement_no} · {periodLabel} · {sType}
                </p>
              </div>
            </div>
            {confirmed && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-full">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                <span className="text-[11px] font-medium text-emerald-700">확정 완료</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* 상단 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "순매출", value: s.total_sales, color: "from-blue-500 to-blue-600" },
            { label: "총비용", value: s.total_cost, color: "from-slate-500 to-slate-600" },
            { label: "순익", value: s.net_profit, color: s.net_profit >= 0 ? "from-emerald-500 to-emerald-600" : "from-red-500 to-red-600" },
            { label: `${storeName} 정산금`, value: sType === "프리랜서" && s.withholding_tax > 0 ? s.influencer_actual : s.influencer_amount, color: "from-violet-500 to-violet-600" },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <p className="text-[11px] font-medium text-gray-400 mb-1">{card.label}</p>
              <p className={`text-lg font-bold bg-gradient-to-r ${card.color} bg-clip-text text-transparent`}>
                {W(card.value)}
              </p>
            </div>
          ))}
        </div>

        {/* 탭 */}
        <div className="flex gap-1 mb-5 bg-white rounded-xl p-1 border border-gray-100 shadow-sm w-fit">
          {(["summary", "orders", "products"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-[13px] rounded-lg cursor-pointer transition-all ${
                tab === t
                  ? "bg-gray-900 text-white font-medium shadow-sm"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}>
              {t === "summary" ? "정산요약" : t === "orders" ? `주문상세 (${items.length})` : `상품별 (${products.length})`}
            </button>
          ))}
        </div>

        {/* ── 정산요약 ── */}
        {tab === "summary" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 매출 */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-50 bg-gradient-to-r from-blue-50/50 to-transparent">
                <h3 className="text-[13px] font-semibold text-blue-900">매출</h3>
              </div>
              <div className="px-5 py-4 space-y-2.5">
                <SRow label="자사몰 매출" value={s.cafe24_sales} />
                {s.phone_sales > 0 && <SRow label="전화주문 매출" value={s.phone_sales} />}
                {s.refund_amount !== 0 && <SRow label="환불/반품" value={s.refund_amount} negative />}
                <div className="border-t border-gray-100 pt-2.5">
                  <SRow label="순매출" value={s.total_sales} bold />
                </div>
              </div>
            </section>

            {/* 비용 */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-50 bg-gradient-to-r from-slate-50/80 to-transparent">
                <h3 className="text-[13px] font-semibold text-slate-800">비용</h3>
              </div>
              <div className="px-5 py-4 space-y-2.5">
                <SRow label={`PG수수료 (${s.snap_pg_fee_rate}%)`} value={s.pg_fee} />
                {s.cogs_exempt > 0 ? (
                  <>
                    <SRow label="제품원가 (과세)" value={s.cogs_taxable} />
                    <SRow label="제품원가 (면세)" value={s.cogs_exempt} />
                    <SRow label="면세 VAT 10%" value={s.cogs_exempt_vat} sub />
                  </>
                ) : (
                  <SRow label="제품원가" value={s.total_cogs} />
                )}
                {s.ship_exempt > 0 ? (
                  <>
                    <SRow label="배송비 (과세)" value={s.ship_taxable} />
                    <SRow label="배송비 (면세)" value={s.ship_exempt} />
                    <SRow label="면세 VAT 10%" value={s.ship_exempt_vat} sub />
                  </>
                ) : (
                  <SRow label="배송비" value={s.total_shipping} />
                )}
                {s.tpl_cost > 0 && <SRow label="3PL 물류비" value={s.tpl_cost} />}
                {s.other_cost > 0 && <SRow label="기타비용" value={s.other_cost} />}
                {s.vat_amount > 0 && <SRow label="부가세 (10%)" value={s.vat_amount} />}
                <div className="border-t border-gray-100 pt-2.5">
                  <SRow label="총비용" value={s.total_cost} bold />
                </div>
              </div>
            </section>

            {/* 순익 */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-50 bg-gradient-to-r from-emerald-50/50 to-transparent">
                <h3 className="text-[13px] font-semibold text-emerald-900">순익</h3>
              </div>
              <div className="px-5 py-4 space-y-2.5">
                <SRow label="순익" value={s.net_profit} bold />
                <div className="flex justify-between items-center">
                  <span className="text-[13px] text-gray-500">순익률</span>
                  <span className={`text-[13px] font-semibold px-2 py-0.5 rounded-md ${
                    s.profit_rate >= 30 ? "bg-emerald-50 text-emerald-700"
                    : s.profit_rate >= 15 ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-600"
                  }`}>{s.profit_rate}%</span>
                </div>
              </div>
            </section>

            {/* 수익 분배 */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-50 bg-gradient-to-r from-violet-50/50 to-transparent">
                <h3 className="text-[13px] font-semibold text-violet-900">수익 분배 ({infPct}:{coPct})</h3>
              </div>
              <div className="px-5 py-4 space-y-2.5">
                <SRow label={`${storeName} 정산금 (${infPct}%)`} value={s.influencer_amount} bold />
                {sType === "프리랜서" && s.withholding_tax > 0 && (
                  <>
                    <SRow label="원천세 (3.3%)" value={-s.withholding_tax} sub />
                    <div className="border-t border-gray-100 pt-2.5">
                      <SRow label={`${storeName} 실지급액`} value={s.influencer_actual} bold accent />
                    </div>
                  </>
                )}
                <SRow label={`신산애널리틱스 (${coPct}%)`} value={s.company_amount} />
              </div>
            </section>
          </div>
        )}

        {/* ── 주문상세 ── */}
        {tab === "orders" && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px]">
                <colgroup>
                  <col className="w-[60px]" />
                  <col className="w-[70px]" />
                  <col className="w-[180px]" />
                  <col className="w-[90px]" />
                  <col />
                  <col className="w-[50px]" />
                  <col className="w-[90px]" />
                  <col className="w-[100px]" />
                  <col className="w-[90px]" />
                  <col className="w-[90px]" />
                  <col className="w-[50px]" />
                  <col className="w-[100px]" />
                </colgroup>
                <thead>
                  <tr className="bg-gray-50/80">
                    {["구분", "판매방식", "주문번호", "주문일", "상품명", "수량", "단가", "정산매출", "공급가", "순익", "과세", "공급사"].map((h, i) => (
                      <th key={h} className={`px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap border-b border-gray-100 ${i >= 5 && i <= 9 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const profit = item.settled_amount - item.supply_total - item.supply_shipping;
                    return (
                      <tr key={item.id || i} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full ${
                            item.item_type === "취소" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
                          }`}>{item.item_type}</span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full ${CH_COLOR[item.sales_channel] || "bg-gray-100 text-gray-600"}`}>
                            {CH[item.sales_channel] || item.sales_channel || "기타"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[12px] font-mono text-gray-600 whitespace-nowrap">{item.cafe24_order_id}</td>
                        <td className="px-3 py-2.5 text-[12px] text-gray-500 whitespace-nowrap">{(item.order_date || "").slice(0, 10)}</td>
                        <td className="px-3 py-2.5 text-[12px] text-gray-700 truncate max-w-0" title={item.product_name}>{item.product_name}</td>
                        <td className="px-3 py-2.5 text-[12px] text-gray-600 text-right tabular-nums">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-[12px] text-gray-600 text-right tabular-nums whitespace-nowrap">{W(item.product_price)}</td>
                        <td className="px-3 py-2.5 text-[12px] font-semibold text-gray-900 text-right tabular-nums whitespace-nowrap">{W(item.settled_amount)}</td>
                        <td className="px-3 py-2.5 text-[12px] text-gray-500 text-right tabular-nums whitespace-nowrap">{W(item.supply_total)}</td>
                        <td className={`px-3 py-2.5 text-[12px] font-semibold text-right tabular-nums whitespace-nowrap ${profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{W(profit)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-gray-400 whitespace-nowrap">{item.tax_type}</td>
                        <td className="px-3 py-2.5 text-[12px] text-gray-500 whitespace-nowrap">{item.supplier_name}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50/80 border-t border-gray-200">
                    <td colSpan={7} className="px-3 py-3 text-[12px] font-semibold text-gray-700">합계 ({items.length}건)</td>
                    <td className="px-3 py-3 text-[12px] font-bold text-gray-900 text-right tabular-nums whitespace-nowrap">{W(orderTotals.settled)}</td>
                    <td className="px-3 py-3 text-[12px] font-semibold text-gray-600 text-right tabular-nums whitespace-nowrap">{W(orderTotals.supply)}</td>
                    <td className={`px-3 py-3 text-[12px] font-bold text-right tabular-nums whitespace-nowrap ${orderTotals.profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{W(orderTotals.profit)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ── 상품별 ── */}
        {tab === "products" && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50/80">
                    {["상품명", "수량", "매출", "매입가", "배송비", "이익", "마진율"].map((h, i) => (
                      <th key={h} className={`px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap border-b border-gray-100 ${i >= 1 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-3 text-[12px] text-gray-700 max-w-[350px] truncate" title={p.product_name}>{p.product_name}</td>
                      <td className="px-4 py-3 text-[12px] text-gray-600 text-right tabular-nums">{p.quantity}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-gray-900 text-right tabular-nums">{W(p.sales)}</td>
                      <td className="px-4 py-3 text-[12px] text-gray-500 text-right tabular-nums">{W(p.cogs)}</td>
                      <td className="px-4 py-3 text-[12px] text-gray-500 text-right tabular-nums">{W(p.shipping)}</td>
                      <td className={`px-4 py-3 text-[12px] font-semibold text-right tabular-nums ${p.profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{W(p.profit)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                          p.margin >= 30 ? "bg-emerald-50 text-emerald-700"
                          : p.margin >= 15 ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-600"
                        }`}>{p.margin}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 확정 영역 ── */}
        <div className="mt-8">
          {confirmed ? (
            <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl border border-emerald-200/60 p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm">
                  <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                </div>
                <div>
                  <p className="font-semibold text-emerald-800 text-[15px]">정산 확정이 완료되었습니다</p>
                  <p className="text-[13px] text-emerald-600/70 mt-0.5">
                    {confirmedAt ? new Date(confirmedAt).toLocaleString("ko-KR") + " 확정" : ""}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-4 bg-blue-50 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <p className="text-[15px] font-medium text-gray-800 mb-1">정산 내용을 확인해주세요</p>
              <p className="text-[13px] text-gray-400 mb-6">모든 내용이 정확하면 아래 버튼을 눌러 확정해주세요</p>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="px-10 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 cursor-pointer transition-all shadow-sm shadow-blue-200 active:scale-[0.98]"
              >
                {confirming ? "처리 중..." : "정산 확정"}
              </button>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <footer className="mt-10 pb-8 text-center">
          <div className="flex items-center justify-center gap-2 text-[11px] text-gray-300">
            <div className="w-5 h-5 bg-gray-200 rounded-md flex items-center justify-center">
              <span className="text-white text-[7px] font-bold">TP</span>
            </div>
            <span>TubePing Admin · 신산애널리틱스</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ── 정산요약 행 컴포넌트 ── */
function SRow({ label, value, bold, sub, negative, accent }: {
  label: string; value: number; bold?: boolean; sub?: boolean; negative?: boolean; accent?: boolean;
}) {
  const isNeg = value < 0 || negative;
  return (
    <div className="flex justify-between items-center">
      <span className={`text-[13px] ${sub ? "text-gray-400 pl-3" : bold ? "font-semibold text-gray-800" : "text-gray-500"}`}>{label}</span>
      <span className={`text-[13px] tabular-nums ${
        accent ? "font-bold text-violet-700"
        : bold ? "font-semibold text-gray-900"
        : isNeg ? "text-red-500"
        : sub ? "text-gray-400"
        : "text-gray-700"
      }`}>{W(value)}</span>
    </div>
  );
}
