"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

interface MallOrder {
  id: string;
  cafe24_order_id: string;
  order_date: string;
  product_name: string;
  option_text: string | null;
  quantity: number;
  product_price: number;
  order_amount: number;
  receiver_name: string;
  shipping_status: string;
  shipping_company: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  sales_channel: string | null;
  created_at: string;
}

interface Stats {
  phone: { total: number; pending: number; confirmed: number; shipping: number; delivered: number; unpaid: number; totalAmount: number };
  mall: { total: number; pending: number; shipping: number; delivered: number; totalAmount: number };
}

const MALL_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "대기", color: "text-amber-700", bg: "bg-amber-50" },
  ordered: { label: "발주완료", color: "text-blue-700", bg: "bg-blue-50" },
  shipping: { label: "배송중", color: "text-violet-700", bg: "bg-violet-50" },
  delivered: { label: "배송완료", color: "text-emerald-700", bg: "bg-emerald-50" },
  cancelled: { label: "취소", color: "text-red-700", bg: "bg-red-50" },
};

function detectChannel(salesChannel: string | null, orderId: string): string {
  // 명시적 sales_channel이 있으면 사용
  if (salesChannel === "phone") return "전화주문";
  if (salesChannel === "sample") return "샘플";

  // 주문번호 패턴으로 판별
  if (/^PT-/.test(orderId)) return "전화주문";
  if (/^MR-/.test(orderId)) return "수동";
  if (/^EXCEL-/.test(orderId)) return "엑셀";
  // 자사몰: YYYYMMDD-0000027 (날짜 8자리 + 7자리 이상 번호)
  if (/^\d{8}-\d{5,}$/.test(orderId)) return "자사몰";

  // 그 외 (20260424-4, 20260519(2)-4 등) → 전화주문
  if (/^\d{8}/.test(orderId)) return "전화주문";

  return salesChannel || "기타";
}

function formatDate(d: string) {
  if (!d) return "-";
  const date = new Date(d);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function formatAmount(amount: number) {
  if (!amount) return "-";
  return amount.toLocaleString();
}

export default function SellerPortalPage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [mallOrders, setMallOrders] = useState<MallOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [period, setPeriod] = useState("");
  const [tab, setTab] = useState<string>("all");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/seller-portal?token=${token}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "데이터를 불러올 수 없습니다.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setClientName(data.client.name);
      setMallOrders(data.mallOrders || []);
      setStats(data.stats);
      setPeriod(data.period || "");
      setError(null);
      setLastRefresh(new Date());
    } catch {
      setError("서버에 연결할 수 없습니다.");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#C41E1E] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">접근 불가</h2>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  // 채널별 분류
  const channelGroups = { 자사몰: [] as MallOrder[], 전화주문: [] as MallOrder[], 샘플: [] as MallOrder[], 기타: [] as MallOrder[] };
  for (const o of mallOrders) {
    const ch = detectChannel(o.sales_channel, o.cafe24_order_id);
    if (ch === "자사몰") channelGroups.자사몰.push(o);
    else if (ch === "전화주문") channelGroups.전화주문.push(o);
    else if (ch === "샘플") channelGroups.샘플.push(o);
    else channelGroups.기타.push(o);
  }
  const totalOrders = mallOrders.length;
  const totalAmount = (stats?.mall.totalAmount || 0);
  const periodLabel = period ? `${period.slice(0, 4)}년 ${parseInt(period.slice(5, 7))}월` : "";

  const tabs = [
    { key: "all", label: "전체", count: totalOrders },
    { key: "mall", label: "자사몰", count: channelGroups.자사몰.length },
    { key: "phone", label: "전화주문", count: channelGroups.전화주문.length },
    { key: "sample", label: "샘플", count: channelGroups.샘플.length },
    { key: "etc", label: "기타", count: channelGroups.기타.length },
  ].filter((t) => t.key === "all" || t.count > 0);

  const filteredMallOrders = tab === "all" ? mallOrders
    : tab === "mall" ? channelGroups.자사몰
    : tab === "phone" ? channelGroups.전화주문
    : tab === "sample" ? channelGroups.샘플
    : tab === "etc" ? channelGroups.기타
    : mallOrders;

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-[#C41E1E] rounded-md flex items-center justify-center shrink-0">
                <span className="text-white text-[10px] font-bold">TP</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-gray-900 truncate">{clientName}</h1>
                <p className="text-[11px] text-gray-400">{periodLabel} 주문 현황</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-gray-400 hidden sm:inline">
                {lastRefresh.toLocaleTimeString("ko-KR")} 기준
              </span>
              <button
                onClick={() => { setLoading(true); fetchData(); }}
                className="px-2.5 py-1.5 text-[11px] font-medium text-[#C41E1E] border border-[#C41E1E]/30 rounded-md hover:bg-red-50 transition-colors"
              >
                새로고침
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        {/* 통계 카드 */}
        <div className="grid grid-cols-4 gap-2.5">
          <StatCard label="전체 주문" value={totalOrders} suffix="건" color="gray" />
          <StatCard label="총 금액" value={totalAmount} suffix="원" format color="blue" />
          <StatCard label="배송중" value={stats?.mall.shipping || 0} suffix="건" color="violet" />
          <StatCard label="배송완료" value={stats?.mall.delivered || 0} suffix="건" color="green" />
        </div>

        {/* 탭 */}
        <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5 w-fit overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                tab === t.key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {t.label}
              <span className={`ml-1 text-[10px] ${tab === t.key ? "text-gray-500" : "text-gray-300"}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* 통합 주문 테이블 */}
        {filteredMallOrders.length > 0 && (
          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-400 whitespace-nowrap">주문번호</th>
                    <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 whitespace-nowrap">날짜</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-400">상품명</th>
                    <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 whitespace-nowrap">수량</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-400 whitespace-nowrap">금액</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-400 whitespace-nowrap">수령인</th>
                    <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 whitespace-nowrap">구분</th>
                    <th className="px-3 py-2 text-center text-[11px] font-semibold text-gray-400 whitespace-nowrap">상태</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-400 whitespace-nowrap">운송장</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredMallOrders.map((o) => {
                    const st = MALL_STATUS[o.shipping_status] || MALL_STATUS.pending;
                    const amount = o.order_amount || o.product_price || 0;
                    const channel = detectChannel(o.sales_channel, o.cafe24_order_id);
                    return (
                      <tr key={o.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-3 py-2 font-mono text-[11px] text-gray-500 whitespace-nowrap">{o.cafe24_order_id}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-500 text-center whitespace-nowrap">{formatDate(o.order_date)}</td>
                        <td className="px-3 py-2 text-xs text-gray-900 max-w-[220px]">
                          <div className="truncate">{o.product_name}</div>
                          {o.option_text && <div className="truncate text-[11px] text-gray-400">{o.option_text}</div>}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-gray-600">{o.quantity}</td>
                        <td className="px-3 py-2 text-right text-xs font-medium text-gray-900 whitespace-nowrap">
                          {formatAmount(amount)}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{o.receiver_name}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${
                            channel === "자사몰" ? "text-indigo-600 bg-indigo-50" :
                            channel === "샘플" ? "text-orange-600 bg-orange-50" :
                            channel === "전화주문" ? "text-teal-600 bg-teal-50" :
                            "text-gray-500 bg-gray-50"
                          }`}>
                            {channel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${st.color} ${st.bg}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-gray-500 whitespace-nowrap">
                          {o.tracking_number ? (
                            <span>{o.shipping_company} {o.tracking_number}</span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 주문 없음 */}
        {totalOrders === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center shadow-sm">
            <p className="text-gray-400 text-sm">이번 달 주문이 없습니다.</p>
          </div>
        )}

        {/* 푸터 */}
        <p className="text-center text-[11px] text-gray-300 py-3">30초마다 자동 새로고침</p>
      </main>
    </div>
  );
}

function StatCard({ label, value, suffix, color, format }: { label: string; value: number; suffix: string; color: string; format?: boolean }) {
  const colors: Record<string, string> = {
    gray: "border-gray-200 bg-white",
    blue: "border-blue-100 bg-blue-50/50",
    violet: "border-violet-100 bg-violet-50/50",
    green: "border-emerald-100 bg-emerald-50/50",
  };
  const textColors: Record<string, string> = {
    gray: "text-gray-900",
    blue: "text-blue-700",
    violet: "text-violet-700",
    green: "text-emerald-700",
  };
  const display = format ? value.toLocaleString() : String(value);
  return (
    <div className={`rounded-lg border p-3 shadow-sm ${colors[color] || colors.gray}`}>
      <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-base font-bold ${textColors[color] || textColors.gray}`}>
        {display}<span className="text-[11px] font-normal text-gray-400 ml-0.5">{suffix}</span>
      </p>
    </div>
  );
}
