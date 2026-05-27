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

function Row({ label, value, bold, highlight, sub, negative, isText }: {
  label: string; value: number | string; bold?: boolean; highlight?: boolean; sub?: boolean; negative?: boolean; isText?: boolean;
}) {
  const isNum = typeof value === "number";
  const isNeg = isNum && (value < 0 || negative);
  return (
    <div className={`flex justify-between py-2 px-3 rounded ${highlight ? "bg-gray-50" : ""}`}>
      <span className={`text-sm ${bold ? "font-semibold text-gray-900" : sub ? "text-gray-400" : "text-gray-600"}`}>{label}</span>
      <span className={`text-sm ${bold ? "font-semibold" : ""} ${isNeg ? "text-red-500" : "text-gray-900"}`}>
        {isText ? value : isNum ? W(value) : value}
      </span>
    </div>
  );
}

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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );

  if (error || !settlement) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-6xl mb-4">📋</p>
        <p className="text-gray-500">{error || "정산서를 찾을 수 없습니다"}</p>
      </div>
    </div>
  );

  const s = settlement;
  const storeName = s.stores?.name || "판매자";
  const infPct = s.snap_influencer_rate ?? 70;
  const coPct = s.snap_company_rate ?? 30;
  const sType = s.snap_settlement_type || "사업자";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">TP</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">{storeName} 정산서</h1>
              <p className="text-xs text-gray-500">
                {s.settlement_no} · {s.period} · {sType} · {infPct}:{coPct} 분배
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* 탭 */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          {(["summary", "orders", "products"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm rounded-md cursor-pointer transition-colors ${tab === t ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
              {t === "summary" ? "정산요약" : t === "orders" ? `주문상세 (${items.length})` : `상품별 (${products.length})`}
            </button>
          ))}
        </div>

        {/* 정산요약 */}
        {tab === "summary" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">매출</h3>
              <div className="space-y-1">
                <Row label="자사몰 매출" value={s.cafe24_sales} />
                {s.phone_sales > 0 && <Row label="전화주문 매출" value={s.phone_sales} />}
                {s.refund_amount !== 0 && <Row label="환불/반품" value={s.refund_amount} negative />}
                <Row label="순매출" value={s.total_sales} bold highlight />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">비용</h3>
              <div className="space-y-1">
                <Row label={`PG수수료 (${s.snap_pg_fee_rate}%)`} value={s.pg_fee} />
                {s.cogs_exempt > 0 ? (
                  <>
                    <Row label="제품원가 (과세)" value={s.cogs_taxable} />
                    <Row label="제품원가 (면세)" value={s.cogs_exempt} />
                    <Row label="  면세 VAT 10%" value={s.cogs_exempt_vat} sub />
                  </>
                ) : (
                  <Row label="제품원가" value={s.total_cogs} />
                )}
                {s.ship_exempt > 0 ? (
                  <>
                    <Row label="배송비 (과세)" value={s.ship_taxable} />
                    <Row label="배송비 (면세)" value={s.ship_exempt} />
                    <Row label="  면세 VAT 10%" value={s.ship_exempt_vat} sub />
                  </>
                ) : (
                  <Row label="배송비" value={s.total_shipping} />
                )}
                {s.tpl_cost > 0 && <Row label="3PL 물류비" value={s.tpl_cost} />}
                {s.other_cost > 0 && <Row label="기타비용" value={s.other_cost} />}
                {s.vat_amount > 0 && <Row label="부가세 (10%)" value={s.vat_amount} />}
                <Row label="총비용" value={s.total_cost} bold highlight />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">순익</h3>
              <div className="space-y-1">
                <Row label="순익" value={s.net_profit} bold />
                <Row label="순익률" value={`${s.profit_rate}%`} isText />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">수익 분배 ({infPct}:{coPct})</h3>
              <div className="space-y-1">
                <Row label={`${storeName} 정산금 (${infPct}%)`} value={s.influencer_amount} bold />
                {sType === "프리랜서" && s.withholding_tax > 0 && (
                  <>
                    <Row label="  원천세 (3.3%)" value={-s.withholding_tax} sub />
                    <Row label={`  ${storeName} 실지급액`} value={s.influencer_actual} bold highlight />
                  </>
                )}
                <Row label={`신산애널리틱스 (${coPct}%)`} value={s.company_amount} />
              </div>
            </div>
          </div>
        )}

        {/* 주문상세 */}
        {tab === "orders" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {["구분", "판매방식", "주문번호", "주문일", "상품명", "수량", "단가", "정산매출", "공급가", "순익", "과세", "공급사"].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item, i) => {
                  const profit = item.settled_amount - item.supply_total - item.supply_shipping;
                  return (
                    <tr key={item.id || i} className={i % 2 === 1 ? "bg-gray-50/50" : ""}>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${item.item_type === "취소" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                          {item.item_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{CH[item.sales_channel] || item.sales_channel || "기타"}</td>
                      <td className="px-3 py-2 text-xs font-mono">{item.cafe24_order_id}</td>
                      <td className="px-3 py-2 text-xs">{(item.order_date || "").slice(0, 10)}</td>
                      <td className="px-3 py-2 text-xs max-w-[200px] truncate">{item.product_name}</td>
                      <td className="px-3 py-2 text-xs text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-xs text-right">{W(item.product_price)}</td>
                      <td className="px-3 py-2 text-xs text-right font-medium">{W(item.settled_amount)}</td>
                      <td className="px-3 py-2 text-xs text-right">{W(item.supply_total)}</td>
                      <td className={`px-3 py-2 text-xs text-right font-medium ${profit >= 0 ? "text-green-600" : "text-red-500"}`}>{W(profit)}</td>
                      <td className="px-3 py-2 text-xs">{item.tax_type}</td>
                      <td className="px-3 py-2 text-xs">{item.supplier_name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 상품별 */}
        {tab === "products" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {["상품명", "수량", "매출", "매입가", "배송비", "이익", "마진율"].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((p, i) => (
                  <tr key={i} className={i % 2 === 1 ? "bg-gray-50/50" : ""}>
                    <td className="px-3 py-2 text-xs max-w-[300px] truncate">{p.product_name}</td>
                    <td className="px-3 py-2 text-xs text-right">{p.quantity}</td>
                    <td className="px-3 py-2 text-xs text-right">{W(p.sales)}</td>
                    <td className="px-3 py-2 text-xs text-right">{W(p.cogs)}</td>
                    <td className="px-3 py-2 text-xs text-right">{W(p.shipping)}</td>
                    <td className={`px-3 py-2 text-xs text-right font-medium ${p.profit >= 0 ? "text-green-600" : "text-red-500"}`}>{W(p.profit)}</td>
                    <td className={`px-3 py-2 text-xs text-right font-medium ${p.margin >= 30 ? "text-green-600" : p.margin < 15 ? "text-red-500" : ""}`}>{p.margin}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 확정 영역 */}
        <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
          {confirmed ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <div>
                <p className="font-semibold text-green-700">정산 확정 완료</p>
                <p className="text-sm text-gray-500">
                  {confirmedAt ? new Date(confirmedAt).toLocaleString("ko-KR") : ""}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-4">정산 내용을 확인 후 아래 버튼을 눌러 확정해주세요.</p>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {confirming ? "처리 중..." : "정산 확정"}
              </button>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="mt-6 text-center text-xs text-gray-400 pb-8">
          TubePing Admin · 신산애널리틱스
        </div>
      </div>
    </div>
  );
}
