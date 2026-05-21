"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

interface PhoneOrder {
  id: string;
  order_number: string;
  order_date: string;
  product_name: string;
  option_text: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  recipient_name: string;
  status: string;
  payment_status: string;
  shipping_company: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  created_at: string;
}

interface MallOrder {
  id: string;
  cafe24_order_id: string;
  order_date: string;
  product_name: string;
  option_text: string | null;
  quantity: number;
  order_amount: number;
  receiver_name: string;
  shipping_status: string;
  shipping_company: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  sales_channel: string;
  created_at: string;
}

interface Stats {
  phone: { total: number; pending: number; confirmed: number; shipping: number; delivered: number; unpaid: number; totalAmount: number };
  mall: { total: number; pending: number; shipping: number; delivered: number; totalAmount: number };
}

const PHONE_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "접수", color: "text-amber-700", bg: "bg-amber-50" },
  confirmed: { label: "확정", color: "text-blue-700", bg: "bg-blue-50" },
  transferred: { label: "이관", color: "text-teal-700", bg: "bg-teal-50" },
  shipping: { label: "배송중", color: "text-violet-700", bg: "bg-violet-50" },
  delivered: { label: "배송완료", color: "text-emerald-700", bg: "bg-emerald-50" },
  cancelled: { label: "취소", color: "text-red-700", bg: "bg-red-50" },
};

const MALL_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "대기", color: "text-amber-700", bg: "bg-amber-50" },
  ordered: { label: "발주완료", color: "text-blue-700", bg: "bg-blue-50" },
  shipping: { label: "배송중", color: "text-violet-700", bg: "bg-violet-50" },
  delivered: { label: "배송완료", color: "text-emerald-700", bg: "bg-emerald-50" },
  cancelled: { label: "취소", color: "text-red-700", bg: "bg-red-50" },
};

export default function SellerPortalPage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [phoneOrders, setPhoneOrders] = useState<PhoneOrder[]>([]);
  const [mallOrders, setMallOrders] = useState<MallOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<"all" | "phone" | "mall">("all");
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
      setPhoneOrders(data.phoneOrders || []);
      setMallOrders(data.mallOrders || []);
      setStats(data.stats);
      setError(null);
      setLastRefresh(new Date());
    } catch {
      setError("서버에 연결할 수 없습니다.");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchData();
    // 30초마다 자동 새로고침
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#C41E1E] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">주문 현황을 불러오는 중...</p>
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

  const totalOrders = (stats?.phone.total || 0) + (stats?.mall.total || 0);
  const totalAmount = (stats?.phone.totalAmount || 0) + (stats?.mall.totalAmount || 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#C41E1E] rounded-lg flex items-center justify-center">
                <span className="text-white text-xs font-bold">TP</span>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">{clientName}</h1>
                <p className="text-xs text-gray-500">주문 현황 대시보드</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">
                {lastRefresh.toLocaleTimeString("ko-KR")} 기준
              </span>
              <button
                onClick={() => { setLoading(true); fetchData(); }}
                className="px-3 py-1.5 text-xs font-medium text-[#C41E1E] border border-[#C41E1E] rounded-lg hover:bg-red-50 transition-colors"
              >
                새로고침
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* 통계 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="전체 주문" value={`${totalOrders}건`} color="gray" />
          <StatCard label="총 금액" value={`${totalAmount.toLocaleString()}원`} color="blue" />
          <StatCard
            label="배송중"
            value={`${(stats?.phone.shipping || 0) + (stats?.mall.shipping || 0)}건`}
            color="violet"
          />
          <StatCard
            label="배송완료"
            value={`${(stats?.phone.delivered || 0) + (stats?.mall.delivered || 0)}건`}
            color="green"
          />
        </div>

        {/* 전화주문 미입금 알림 */}
        {(stats?.phone.unpaid || 0) > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-red-600 text-sm font-medium">
              미입금 {stats?.phone.unpaid}건
            </span>
            <span className="text-red-500 text-xs">입금 확인이 필요한 전화주문이 있습니다.</span>
          </div>
        )}

        {/* 탭 */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {[
            { key: "all" as const, label: "전체", count: totalOrders },
            { key: "phone" as const, label: "전화주문", count: stats?.phone.total || 0 },
            { key: "mall" as const, label: "자사몰", count: stats?.mall.total || 0 },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label} <span className="text-xs text-gray-400 ml-1">{t.count}</span>
            </button>
          ))}
        </div>

        {/* 전화주문 테이블 */}
        {(tab === "all" || tab === "phone") && phoneOrders.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {tab === "all" && (
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-bold text-gray-700">전화주문</h3>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">주문번호</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">주문일</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">상품명</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">수량</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">금액</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">수령인</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">상태</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">입금</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">운송장</th>
                  </tr>
                </thead>
                <tbody>
                  {phoneOrders.map((o) => {
                    const st = PHONE_STATUS[o.status] || PHONE_STATUS.pending;
                    return (
                      <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{o.order_number}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-600">{o.order_date}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-900 max-w-[250px] truncate">
                          {o.product_name}
                          {o.option_text && <span className="text-gray-400 ml-1">({o.option_text})</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-700">{o.quantity}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-900">
                          {(o.total_amount || 0).toLocaleString()}원
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-700">{o.recipient_name}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.color} ${st.bg}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            o.payment_status === "paid" ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"
                          }`}>
                            {o.payment_status === "paid" ? "입금" : "미입금"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {o.tracking_number
                            ? `${o.shipping_company || ""} ${o.tracking_number}`
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 자사몰 주문 테이블 */}
        {(tab === "all" || tab === "mall") && mallOrders.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {tab === "all" && (
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-bold text-gray-700">자사몰 주문</h3>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">주문번호</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">주문일</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">상품명</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">수량</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">금액</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">수령인</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">배송상태</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">운송장</th>
                  </tr>
                </thead>
                <tbody>
                  {mallOrders.map((o) => {
                    const st = MALL_STATUS[o.shipping_status] || MALL_STATUS.pending;
                    return (
                      <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{o.cafe24_order_id}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-600">
                          {o.order_date ? new Date(o.order_date).toLocaleDateString("ko-KR") : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-900 max-w-[250px] truncate">
                          {o.product_name}
                          {o.option_text && <span className="text-gray-400 ml-1">({o.option_text})</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-700">{o.quantity}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-medium text-gray-900">
                          {(o.order_amount || 0).toLocaleString()}원
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-700">{o.receiver_name}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.color} ${st.bg}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {o.tracking_number
                            ? `${o.shipping_company || ""} ${o.tracking_number}`
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 주문 없음 */}
        {totalOrders === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-400 text-sm">아직 등록된 주문이 없습니다.</p>
          </div>
        )}

        {/* 푸터 */}
        <div className="text-center py-4">
          <p className="text-xs text-gray-400">30초마다 자동 새로고침 됩니다</p>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    gray: "bg-gray-50 border-gray-200",
    blue: "bg-blue-50 border-blue-200",
    violet: "bg-violet-50 border-violet-200",
    green: "bg-emerald-50 border-emerald-200",
  };
  const textColors: Record<string, string> = {
    gray: "text-gray-900",
    blue: "text-blue-900",
    violet: "text-violet-900",
    green: "text-emerald-900",
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.gray}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${textColors[color] || textColors.gray}`}>{value}</p>
    </div>
  );
}
