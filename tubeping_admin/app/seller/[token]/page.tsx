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
  sales_channel: string | null;
}

interface Stats {
  total: number; pending: number; shipping: number; delivered: number; cancelled: number; totalAmount: number;
}

const MALL_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "대기", color: "text-amber-700", bg: "bg-amber-50 border border-amber-200" },
  ordered: { label: "발주완료", color: "text-blue-700", bg: "bg-blue-50 border border-blue-200" },
  shipping: { label: "배송중", color: "text-violet-700", bg: "bg-violet-50 border border-violet-200" },
  delivered: { label: "배송완료", color: "text-emerald-700", bg: "bg-emerald-50 border border-emerald-200" },
  cancelled: { label: "취소", color: "text-red-700", bg: "bg-red-50 border border-red-200" },
};

// 택배사별 배송조회 URL
function getTrackingUrl(company: string | null, trackingNumber: string): string | null {
  if (!company) return null;
  const c = company.trim();
  // CJ대한통운
  if (/cj|대한통운/i.test(c)) return `https://trace.cjlogistics.com/next/tracking.html?wblNo=${trackingNumber}`;
  // 한진택배
  if (/한진/i.test(c)) return `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mession=&inv_no=${trackingNumber}`;
  // 롯데택배
  if (/롯데/i.test(c)) return `https://www.lotteglogis.com/home/reservation/tracking/link498?InvNo=${trackingNumber}`;
  // 우체국
  if (/우체국|우편/i.test(c)) return `https://service.epost.go.kr/trace.RetrieveDomRi498.postal?sid1=${trackingNumber}`;
  // 로젠택배
  if (/로젠/i.test(c)) return `https://www.ilogen.com/web/personal/trace/${trackingNumber}`;
  // 경동택배
  if (/경동/i.test(c)) return `https://kdexp.com/service/shipment/item.do?barcode=${trackingNumber}`;
  // 대신택배
  if (/대신/i.test(c)) return `https://www.ds3211.co.kr/freight/internalFreightSearch.do?billno=${trackingNumber}`;
  // 합동택배
  if (/합동/i.test(c)) return `https://www.hdexp.co.kr/shipment/delivery_search_direct.asp?invoice_no=${trackingNumber}`;
  // 건영택배
  if (/건영/i.test(c)) return `https://www.kunyoung.com/goods/goods_search.php?search_type=1&search=${trackingNumber}`;
  // 천일택배
  if (/천일/i.test(c)) return `https://www.chunil.co.kr/HTrace/HTrace.jsp?transNo=${trackingNumber}`;
  // GS포스트박스 / CVSnet
  if (/gs|cvs|편의점/i.test(c)) return `https://www.cvsnet.co.kr/invoice/tracking.do?invoice_no=${trackingNumber}`;
  // 기본: 스마트택배
  return `https://trace.cjlogistics.com/next/tracking.html?wblNo=${trackingNumber}`;
}

function detectChannel(salesChannel: string | null, orderId: string): string {
  // sales_channel 우선 판단
  if (salesChannel === "phone") return "전화주문";
  if (salesChannel === "sms") return "문자주문";
  if (salesChannel === "sample") return "샘플";
  if (salesChannel === "group") return "공구주문";
  if (salesChannel === "etc") return "기타";
  // 주문번호 접두사로 판단
  if (/^TEL-/.test(orderId)) return "전화주문";
  if (/^SMS-/.test(orderId)) return "문자주문";
  if (/^ETC-/.test(orderId)) return "기타";
  if (/^SPL-/.test(orderId)) return "샘플";
  if (/^JP-/.test(orderId)) return "공구주문";
  // 자사몰 (카페24 주문번호 형태: YYYYMMDD-NNNNNNN)
  if (/^\d{8}-\d{5,}$/.test(orderId)) return "자사몰";
  return "기타";
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

  // 월 선택 (기본: 당월)
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/seller-portal?token=${token}&month=${selectedMonth}`);
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
  }, [token, selectedMonth]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-[#C41E1E] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-400 font-medium">주문 현황을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-10 max-w-md text-center">
          <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">접근할 수 없습니다</h2>
          <p className="text-sm text-gray-400 leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  const channelGroups = { 자사몰: [] as MallOrder[], 전화주문: [] as MallOrder[], 문자주문: [] as MallOrder[], 샘플: [] as MallOrder[], 기타: [] as MallOrder[] };
  for (const o of mallOrders) {
    const ch = detectChannel(o.sales_channel, o.cafe24_order_id);
    if (ch in channelGroups) (channelGroups as Record<string, MallOrder[]>)[ch].push(o);
    else channelGroups.기타.push(o);
  }
  const totalOrders = mallOrders.length;
  const totalAmount = stats?.totalAmount || 0;
  const shippingCount = stats?.shipping || 0;
  const deliveredCount = stats?.delivered || 0;
  const periodLabel = period ? `${period.slice(0, 4)}년 ${parseInt(period.slice(5, 7))}월` : "";

  const tabs = [
    { key: "all", label: "전체", count: totalOrders },
    { key: "mall", label: "자사몰", count: channelGroups.자사몰.length },
    { key: "phone", label: "전화주문", count: channelGroups.전화주문.length },
    { key: "sms", label: "문자주문", count: channelGroups.문자주문.length },
    { key: "sample", label: "샘플", count: channelGroups.샘플.length },
    { key: "etc", label: "기타", count: channelGroups.기타.length },
  ].filter((t) => t.key === "all" || t.count > 0);

  const filteredMallOrders = tab === "all" ? mallOrders
    : tab === "mall" ? channelGroups.자사몰
    : tab === "phone" ? channelGroups.전화주문
    : tab === "sms" ? channelGroups.문자주문
    : tab === "sample" ? channelGroups.샘플
    : tab === "etc" ? channelGroups.기타
    : mallOrders;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f9fb] to-[#f0f2f5]">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-[#C41E1E] to-[#a01818] rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-white text-xs font-bold tracking-tight">TP</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-[15px] font-bold text-gray-900 truncate">{clientName}</h1>
                <p className="text-[11px] text-gray-400 mt-0.5">{periodLabel} 주문 현황</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* 월 이동 */}
              <div className="flex items-center bg-gray-50 rounded-lg border border-gray-200">
                <button
                  onClick={() => {
                    const [y, m] = selectedMonth.split("-").map(Number);
                    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
                    setSelectedMonth(prev);
                  }}
                  className="px-2 py-1.5 text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <span className="px-2 py-1.5 text-xs font-semibold text-gray-700 min-w-[72px] text-center whitespace-nowrap">
                  {parseInt(selectedMonth.slice(0, 4))}년 {parseInt(selectedMonth.slice(5))}월
                </span>
                <button
                  onClick={() => {
                    const [y, m] = selectedMonth.split("-").map(Number);
                    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
                    if (next <= currentMonth) setSelectedMonth(next);
                  }}
                  disabled={selectedMonth >= currentMonth}
                  className="px-2 py-1.5 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
              <span className="text-[11px] text-gray-300 hidden sm:inline">
                {lastRefresh.toLocaleTimeString("ko-KR")}
              </span>
              <button
                onClick={() => { setLoading(true); fetchData(); }}
                className="px-3 py-1.5 text-[11px] font-semibold text-white bg-[#C41E1E] rounded-lg hover:bg-[#a01818] transition-all shadow-sm active:scale-95"
              >
                새로고침
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* 통계 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="전체 주문" value={totalOrders} suffix="건" icon="📦" color="gray" />
          <StatCard label="총 금액" value={totalAmount} suffix="원" icon="💰" format color="blue" />
          <StatCard label="배송중" value={shippingCount} suffix="건" icon="🚚" color="violet" />
          <StatCard label="배송완료" value={deliveredCount} suffix="건" icon="✅" color="green" />
        </div>

        {/* 탭 */}
        <div className="flex gap-1 bg-gray-100/80 rounded-xl p-1 w-fit overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                tab === t.key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                tab === t.key ? "bg-gray-100 text-gray-600" : "text-gray-300"
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* 주문 테이블 */}
        {filteredMallOrders.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">주문번호</th>
                    <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">날짜</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">상품명</th>
                    <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">수량</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">금액</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">수령인</th>
                    <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">구분</th>
                    <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">상태</th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[220px]">운송장</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredMallOrders.map((o) => {
                    const st = MALL_STATUS[o.shipping_status] || MALL_STATUS.pending;
                    const amount = o.order_amount || o.product_price || 0;
                    const channel = detectChannel(o.sales_channel, o.cafe24_order_id);
                    const trackingUrl = o.tracking_number ? getTrackingUrl(o.shipping_company, o.tracking_number) : null;
                    return (
                      <tr key={o.id} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-[11px] text-gray-400 whitespace-nowrap">{o.cafe24_order_id}</td>
                        <td className="px-3 py-3 text-[11px] text-gray-500 text-center whitespace-nowrap">{formatDate(o.order_date)}</td>
                        <td className="px-3 py-3 text-xs text-gray-900 max-w-[260px]">
                          <div className="truncate font-medium">{o.product_name}</div>
                          {o.option_text && <div className="truncate text-[11px] text-gray-400 mt-0.5">{o.option_text}</div>}
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-gray-600 font-medium">{o.quantity}</td>
                        <td className="px-3 py-3 text-right text-xs font-semibold text-gray-900 whitespace-nowrap tabular-nums">
                          {formatAmount(amount)}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">{o.receiver_name}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                            channel === "자사몰" ? "text-indigo-600 bg-indigo-50" :
                            channel === "샘플" ? "text-orange-600 bg-orange-50" :
                            channel === "전화주문" ? "text-teal-600 bg-teal-50" :
                            channel === "문자주문" ? "text-cyan-600 bg-cyan-50" :
                            "text-gray-500 bg-gray-50"
                          }`}>
                            {channel}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${st.color} ${st.bg}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-[11px] whitespace-nowrap min-w-[220px]">
                          {o.tracking_number ? (
                            trackingUrl ? (
                              <a
                                href={trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 transition-colors group"
                              >
                                <span className="font-medium">{o.shipping_company}</span>
                                <span className="font-mono text-blue-500 group-hover:underline">{o.tracking_number}</span>
                                <svg className="w-3 h-3 text-blue-400 group-hover:text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            ) : (
                              <span className="text-gray-500">{o.shipping_company} {o.tracking_number}</span>
                            )
                          ) : (
                            <span className="text-gray-200">—</span>
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
          <div className="bg-white rounded-xl border border-gray-200/60 p-16 text-center shadow-sm">
            <div className="text-4xl mb-4">📭</div>
            <p className="text-gray-400 text-sm font-medium">이번 달 주문이 없습니다.</p>
          </div>
        )}

        {/* 푸터 */}
        <p className="text-center text-[11px] text-gray-300 py-4">30초마다 자동 새로고침</p>
      </main>
    </div>
  );
}

function StatCard({ label, value, suffix, color, format, icon }: { label: string; value: number; suffix: string; color: string; format?: boolean; icon: string }) {
  const colors: Record<string, string> = {
    gray: "border-gray-100 bg-white",
    blue: "border-blue-100 bg-gradient-to-br from-blue-50 to-white",
    violet: "border-violet-100 bg-gradient-to-br from-violet-50 to-white",
    green: "border-emerald-100 bg-gradient-to-br from-emerald-50 to-white",
  };
  const textColors: Record<string, string> = {
    gray: "text-gray-900",
    blue: "text-blue-700",
    violet: "text-violet-700",
    green: "text-emerald-700",
  };
  const display = format ? value.toLocaleString() : String(value);
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${colors[color] || colors.gray}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium text-gray-400">{label}</p>
        <span className="text-base">{icon}</span>
      </div>
      <p className={`text-xl font-bold ${textColors[color] || textColors.gray}`}>
        {display}<span className="text-[11px] font-normal text-gray-400 ml-1">{suffix}</span>
      </p>
    </div>
  );
}
