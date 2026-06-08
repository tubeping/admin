"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  shipping_fee: number;
  supply_price: number;
  supply_shipping_fee: number;
  receiver_name: string;
  shipping_status: string;
  shipping_company: string | null;
  tracking_number: string | null;
  sales_channel: string | null;
  admin_note: string;
  seller_note: string;
}

interface Stats {
  total: number; pending: number; ordered: number; shipping: number; delivered: number; cancelled: number; totalAmount: number;
}

const MALL_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "대기", color: "text-amber-700", bg: "bg-amber-50 border border-amber-200" },
  ordered: { label: "발주완료", color: "text-blue-700", bg: "bg-blue-50 border border-blue-200" },
  shipping: { label: "배송중", color: "text-violet-700", bg: "bg-violet-50 border border-violet-200" },
  delivered: { label: "배송완료", color: "text-emerald-700", bg: "bg-emerald-50 border border-emerald-200" },
  cancelled: { label: "취소", color: "text-red-700", bg: "bg-red-50 border border-red-200" },
};

function getTrackingUrl(company: string | null, trackingNumber: string): string | null {
  if (!company) return null;
  const c = company.trim();
  if (/cj|대한통운/i.test(c)) return `https://trace.cjlogistics.com/next/tracking.html?wblNo=${trackingNumber}`;
  if (/한진/i.test(c)) return `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mession=&inv_no=${trackingNumber}`;
  if (/롯데/i.test(c)) return `https://www.lotteglogis.com/home/reservation/tracking/link498?InvNo=${trackingNumber}`;
  if (/우체국|우편/i.test(c)) return `https://service.epost.go.kr/trace.RetrieveDomRi498.postal?sid1=${trackingNumber}`;
  if (/로젠/i.test(c)) return `https://www.ilogen.com/web/personal/trace/${trackingNumber}`;
  if (/경동/i.test(c)) return `https://kdexp.com/service/shipment/item.do?barcode=${trackingNumber}`;
  if (/대신/i.test(c)) return `https://www.ds3211.co.kr/freight/internalFreightSearch.do?billno=${trackingNumber}`;
  if (/합동/i.test(c)) return `https://www.hdexp.co.kr/shipment/delivery_search_direct.asp?invoice_no=${trackingNumber}`;
  if (/건영/i.test(c)) return `https://www.kunyoung.com/goods/goods_search.php?search_type=1&search=${trackingNumber}`;
  if (/천일/i.test(c)) return `https://www.chunil.co.kr/HTrace/HTrace.jsp?transNo=${trackingNumber}`;
  if (/gs|cvs|편의점/i.test(c)) return `https://www.cvsnet.co.kr/invoice/tracking.do?invoice_no=${trackingNumber}`;
  return `https://trace.cjlogistics.com/next/tracking.html?wblNo=${trackingNumber}`;
}

function detectChannel(salesChannel: string | null, orderId: string): string {
  if (salesChannel === "phone") return "전화주문";
  if (salesChannel === "sms") return "문자주문";
  if (salesChannel === "sample") return "샘플";
  if (salesChannel === "group") return "공구주문";
  if (salesChannel === "gift") return "증정";
  if (salesChannel === "etc") return "기타";
  if (/^TEL-/.test(orderId)) return "전화주문";
  if (/^SMS-/.test(orderId)) return "문자주문";
  if (/^ETC-/.test(orderId)) return "기타";
  if (/^SPL-/.test(orderId)) return "샘플";
  if (/^JP-/.test(orderId)) return "공구주문";
  if (/^GFT-/.test(orderId)) return "증정";
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

const CHANNEL_KEYS = ["자사몰", "공구주문", "전화주문", "문자주문", "샘플", "증정", "기타"] as const;

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sellerNotes, setSellerNotes] = useState<Record<string, string>>({});
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  const [currentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  // 탭/월 변경 시 선택 초기화
  useEffect(() => { setSelectedIds(new Set()); }, [tab, selectedMonth, filters]);

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
      // 비고 초기화
      const noteMap: Record<string, string> = {};
      for (const o of (data.mallOrders || [])) {
        if (o.seller_note) noteMap[o.id] = o.seller_note;
      }
      setSellerNotes(noteMap);
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

  // 채널별 그룹핑 (memoized)
  const channelGroups = useMemo(() => {
    const groups: Record<string, MallOrder[]> = {};
    for (const k of CHANNEL_KEYS) groups[k] = [];
    for (const o of mallOrders) {
      const ch = detectChannel(o.sales_channel, o.cafe24_order_id);
      (groups[ch] || groups["기타"]).push(o);
    }
    return groups;
  }, [mallOrders]);

  const totalOrders = mallOrders.length;
  const totalAmount = stats?.totalAmount || 0;
  const shippingCount = stats?.shipping || 0;
  const deliveredCount = stats?.delivered || 0;
  const periodLabel = period ? `${period.slice(0, 4)}년 ${parseInt(period.slice(5, 7))}월` : "";

  const tabs = useMemo(() => [
    { key: "all", label: "전체", count: totalOrders },
    ...CHANNEL_KEYS
      .map((ch) => ({ key: ch, label: ch, count: channelGroups[ch]?.length || 0 }))
      .filter((t) => t.count > 0),
  ], [totalOrders, channelGroups]);

  const tabOrders = useMemo(() =>
    tab === "all" ? mallOrders : (channelGroups[tab] || mallOrders)
  , [tab, mallOrders, channelGroups]);

  const filteredMallOrders = useMemo(() => {
    const hasAny = Object.values(filters).some((v) => v);
    if (!hasAny) return tabOrders;
    return tabOrders.filter((o) => {
      const fOrderId = filters.orderId?.toLowerCase();
      const fProduct = filters.product?.toLowerCase();
      const fReceiver = filters.receiver?.toLowerCase();
      if (fOrderId && !o.cafe24_order_id.toLowerCase().includes(fOrderId)) return false;
      if (fProduct && !o.product_name.toLowerCase().includes(fProduct) && !(o.option_text || "").toLowerCase().includes(fProduct)) return false;
      if (fReceiver && !o.receiver_name.toLowerCase().includes(fReceiver)) return false;
      if (filters.status) {
        const st = MALL_STATUS[o.shipping_status]?.label || "";
        if (st !== filters.status) return false;
      }
      if (filters.channel) {
        const ch = detectChannel(o.sales_channel, o.cafe24_order_id);
        if (ch !== filters.channel) return false;
      }
      return true;
    });
  }, [tabOrders, filters]);

  const hasFilters = Object.values(filters).some((v) => v);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredIds = useMemo(() => new Set(filteredMallOrders.map((o) => o.id)), [filteredMallOrders]);
  const isAllSelected = filteredMallOrders.length > 0 && filteredMallOrders.every((o) => selectedIds.has(o.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (filteredIds.size > 0 && filteredIds.size === prev.size && [...filteredIds].every((id) => prev.has(id))) {
        return new Set();
      }
      return new Set(filteredIds);
    });
  }, [filteredIds]);

  const saveSellerNote = useCallback(async (orderId: string) => {
    const note = sellerNotes[orderId] || "";
    await fetch("/admin/api/seller-portal/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, items: [{ id: orderId, seller_note: note }] }),
    });
    setEditingNoteId(null);
  }, [token, sellerNotes]);

  const handleExcelDownload = useCallback(async () => {
    const XLSX = await import("xlsx");
    const target = selectedIds.size > 0
      ? filteredMallOrders.filter((o) => selectedIds.has(o.id))
      : filteredMallOrders;
    const rows = target.map((o) => {
      const channel = detectChannel(o.sales_channel, o.cafe24_order_id);
      const st = MALL_STATUS[o.shipping_status] || MALL_STATUS.pending;
      return {
        "주문번호": o.cafe24_order_id,
        "날짜": o.order_date ? new Date(o.order_date).toLocaleDateString("ko-KR") : "",
        "상품명": o.product_name,
        "옵션": o.option_text || "",
        "수량": o.quantity,
        "판매금액": o.order_amount || (o.product_price || 0) * o.quantity || 0,
        "공급액": (o.supply_price || 0) * o.quantity,
        "배송비": o.shipping_fee || 0,
        "공급배송비": o.supply_shipping_fee || 0,
        "수령인": o.receiver_name,
        "구분": channel,
        "상태": st.label,
        "택배사": o.shipping_company || "",
        "운송장번호": o.tracking_number || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 20 }, { wch: 6 },
      { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "주문현황");
    const tabLabel = tabs.find((t) => t.key === tab)?.label || "전체";
    XLSX.writeFile(wb, `${clientName}_${selectedMonth}_${tabLabel}_주문현황.xlsx`);
  }, [selectedIds, filteredMallOrders, tabs, tab, clientName, selectedMonth]);

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f9fb] to-[#f0f2f5]">
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3.5">
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

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="전체 주문" value={totalOrders} suffix="건" icon="📦" color="gray" />
          <StatCard label="총 금액" value={totalAmount} suffix="원" icon="💰" format color="blue" />
          <StatCard label="배송중" value={shippingCount} suffix="건" icon="🚚" color="violet" />
          <StatCard label="배송완료" value={deliveredCount} suffix="건" icon="✅" color="green" />
        </div>

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

        {tabOrders.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200/60 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/40">
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                <button
                  onClick={toggleSelectAll}
                  className="md:hidden px-2 py-1 rounded-md border border-gray-200 text-gray-500 active:scale-95"
                >
                  {isAllSelected ? "선택해제" : "전체선택"}
                </button>
                <span>{filteredMallOrders.length}건{hasFilters ? " (필터 적용)" : ""}</span>
                {hasFilters && (
                  <button onClick={() => setFilters({})} className="text-red-400 hover:text-red-600 underline">필터 초기화</button>
                )}
                {selectedIds.size > 0 && (
                  <span className="text-[#C41E1E] font-semibold">{selectedIds.size}건 선택</span>
                )}
              </div>
              <button
                onClick={handleExcelDownload}
                disabled={filteredMallOrders.length === 0}
                className="px-3 py-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {selectedIds.size > 0 ? `선택 ${selectedIds.size}건 다운로드` : "엑셀 다운로드"}
              </button>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="px-2 py-3 text-center w-10">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-[#C41E1E] focus:ring-[#C41E1E] cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">주문번호</th>
                    <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">날짜</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">상품명</th>
                    <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">수량</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">판매금액</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">공급액</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">배송비</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">수령인</th>
                    <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">구분</th>
                    <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">상태</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">운송장</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">담당자 비고</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">판매사 비고</th>
                  </tr>
                  <tr className="bg-white border-b border-gray-100">
                    <td className="px-2 py-1.5" />
                    <td className="px-4 py-1.5">
                      <input type="text" placeholder="검색" value={filters.orderId || ""} onChange={(e) => setFilters((f) => ({ ...f, orderId: e.target.value }))} className="w-full px-2 py-1 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:border-blue-300 bg-gray-50/50" />
                    </td>
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5">
                      <input type="text" placeholder="검색" value={filters.product || ""} onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value }))} className="w-full px-2 py-1 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:border-blue-300 bg-gray-50/50" />
                    </td>
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5">
                      <input type="text" placeholder="검색" value={filters.receiver || ""} onChange={(e) => setFilters((f) => ({ ...f, receiver: e.target.value }))} className="w-full px-2 py-1 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:border-blue-300 bg-gray-50/50" />
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={filters.channel || ""} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))} className="w-full px-1 py-1 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:border-blue-300 bg-gray-50/50">
                        <option value="">전체</option>
                        {CHANNEL_KEYS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={filters.status || ""} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="w-full px-1 py-1 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:border-blue-300 bg-gray-50/50">
                        <option value="">전체</option>
                        {Object.values(MALL_STATUS).map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredMallOrders.map((o) => {
                    const st = MALL_STATUS[o.shipping_status] || MALL_STATUS.pending;
                    const saleAmount = o.order_amount || (o.product_price || 0) * o.quantity || 0;
                    const supplyAmount = (o.supply_price || 0) * o.quantity;
                    const shippingFee = o.shipping_fee || 0;
                    const channel = detectChannel(o.sales_channel, o.cafe24_order_id);
                    const trackingUrl = o.tracking_number ? getTrackingUrl(o.shipping_company, o.tracking_number) : null;
                    return (
                      <tr key={o.id} className={`hover:bg-blue-50/30 transition-colors ${selectedIds.has(o.id) ? "bg-blue-50/40" : ""}`}>
                        <td className="px-2 py-3 text-center">
                          <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} className="w-3.5 h-3.5 rounded border-gray-300 text-[#C41E1E] focus:ring-[#C41E1E] cursor-pointer" />
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-gray-400 whitespace-nowrap">{o.cafe24_order_id}</td>
                        <td className="px-3 py-3 text-[11px] text-gray-500 text-center whitespace-nowrap">{formatDate(o.order_date)}</td>
                        <td className="px-3 py-3 text-xs text-gray-900 max-w-[260px]">
                          <div className="truncate font-medium">{o.product_name}</div>
                          {o.option_text && <div className="truncate text-[11px] text-gray-400 mt-0.5">{o.option_text}</div>}
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-gray-600 font-medium">{o.quantity}</td>
                        <td className="px-3 py-3 text-right text-xs font-semibold text-gray-900 whitespace-nowrap tabular-nums">{formatAmount(saleAmount)}</td>
                        <td className="px-3 py-3 text-right text-xs text-gray-600 whitespace-nowrap tabular-nums">{supplyAmount ? formatAmount(supplyAmount) : "-"}</td>
                        <td className="px-3 py-3 text-right text-xs text-gray-600 whitespace-nowrap tabular-nums">{shippingFee ? formatAmount(shippingFee) : "-"}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">{o.receiver_name}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                            channel === "자사몰" ? "text-indigo-600 bg-indigo-50" :
                            channel === "샘플" ? "text-orange-600 bg-orange-50" :
                            channel === "전화주문" ? "text-teal-600 bg-teal-50" :
                            channel === "문자주문" ? "text-cyan-600 bg-cyan-50" :
                            channel === "공구주문" ? "text-pink-600 bg-pink-50" :
                            channel === "증정" ? "text-purple-600 bg-purple-50" :
                            "text-gray-500 bg-gray-50"
                          }`}>{channel}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${st.color} ${st.bg}`}>{st.label}</span>
                        </td>
                        <td className="px-3 py-3 text-[11px] whitespace-nowrap">
                          {o.tracking_number ? (
                            trackingUrl ? (
                              <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="group inline-flex flex-col leading-tight" title={`${o.shipping_company || ""} ${o.tracking_number}`}>
                                <span className="text-[10px] text-gray-400 group-hover:text-gray-600">{o.shipping_company}</span>
                                <span className="inline-flex items-center gap-1 font-mono text-blue-600 group-hover:underline">
                                  {o.tracking_number}
                                  <svg className="w-2.5 h-2.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </span>
                              </a>
                            ) : (
                              <span className="inline-flex flex-col leading-tight text-gray-500">
                                <span className="text-[10px] text-gray-400">{o.shipping_company}</span>
                                <span className="font-mono">{o.tracking_number}</span>
                              </span>
                            )
                          ) : (
                            <span className="text-gray-200">—</span>
                          )}
                        </td>
                        {/* 담당자 비고 (읽기전용) */}
                        <td className="px-3 py-3 text-[11px] text-gray-500 min-w-[96px]">
                          {o.admin_note || <span className="text-gray-200">-</span>}
                        </td>
                        {/* 판매사 비고 (편집가능) */}
                        <td className="px-3 py-3 min-w-[120px]">
                          {editingNoteId === o.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={sellerNotes[o.id] || ""}
                                onChange={e => setSellerNotes(prev => ({ ...prev, [o.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === "Enter") saveSellerNote(o.id); if (e.key === "Escape") setEditingNoteId(null); }}
                                className="flex-1 px-2 py-1 text-[11px] border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                autoFocus
                              />
                              <button onClick={() => saveSellerNote(o.id)} className="text-[10px] text-blue-600 hover:text-blue-800 cursor-pointer whitespace-nowrap">저장</button>
                            </div>
                          ) : (
                            <span
                              onClick={() => { setEditingNoteId(o.id); setSellerNotes(prev => ({ ...prev, [o.id]: prev[o.id] || o.seller_note || "" })); }}
                              className={`text-[11px] cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded ${sellerNotes[o.id] || o.seller_note ? "text-gray-700" : "text-gray-300"}`}
                            >
                              {sellerNotes[o.id] || o.seller_note || "클릭하여 입력"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 모바일: 카드 리스트 */}
            <div className="md:hidden divide-y divide-gray-100">
              {filteredMallOrders.map((o) => {
                const st = MALL_STATUS[o.shipping_status] || MALL_STATUS.pending;
                const saleAmount = o.order_amount || (o.product_price || 0) * o.quantity || 0;
                const supplyAmount = (o.supply_price || 0) * o.quantity;
                const shippingFee = o.shipping_fee || 0;
                const channel = detectChannel(o.sales_channel, o.cafe24_order_id);
                const trackingUrl = o.tracking_number ? getTrackingUrl(o.shipping_company, o.tracking_number) : null;
                const selected = selectedIds.has(o.id);
                return (
                  <div key={o.id} className={`px-3.5 py-3 ${selected ? "bg-blue-50/40" : ""}`}>
                    <div className="flex items-start gap-2.5">
                      <input type="checkbox" checked={selected} onChange={() => toggleSelect(o.id)} className="mt-1 w-4 h-4 rounded border-gray-300 text-[#C41E1E] focus:ring-[#C41E1E] cursor-pointer shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 leading-snug break-words">{o.product_name}</p>
                            {o.option_text && <p className="text-[11px] text-gray-400 mt-0.5 break-words">{o.option_text}</p>}
                          </div>
                          <span className={`shrink-0 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${st.color} ${st.bg}`}>{st.label}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px] text-gray-500">
                          <span className={`inline-block font-semibold px-1.5 py-0.5 rounded-full ${
                            channel === "자사몰" ? "text-indigo-600 bg-indigo-50" :
                            channel === "샘플" ? "text-orange-600 bg-orange-50" :
                            channel === "전화주문" ? "text-teal-600 bg-teal-50" :
                            channel === "문자주문" ? "text-cyan-600 bg-cyan-50" :
                            channel === "공구주문" ? "text-pink-600 bg-pink-50" :
                            channel === "증정" ? "text-purple-600 bg-purple-50" :
                            "text-gray-500 bg-gray-50"
                          }`}>{channel}</span>
                          <span>{formatDate(o.order_date)}</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-gray-700 font-medium">{o.receiver_name}</span>
                          <span className="font-mono text-gray-300 text-[10px]">{o.cafe24_order_id}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-xs">
                          <span className="font-bold text-gray-900 tabular-nums">{saleAmount > 0 ? <>{formatAmount(saleAmount)}<span className="text-[10px] font-normal text-gray-400 ml-0.5">원</span></> : <span className="text-gray-300">-</span>}</span>
                          <span className="text-gray-400">수량 {o.quantity}</span>
                          {supplyAmount > 0 && <span className="text-gray-400 tabular-nums">공급 {formatAmount(supplyAmount)}</span>}
                          {shippingFee > 0 && <span className="text-gray-400 tabular-nums">배송 {formatAmount(shippingFee)}</span>}
                        </div>

                        {o.tracking_number && (
                          <div className="mt-2 text-[11px]">
                            {trackingUrl ? (
                              <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-600">
                                <span className="text-gray-400">{o.shipping_company}</span>
                                <span className="font-mono underline">{o.tracking_number}</span>
                                <svg className="w-3 h-3 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              </a>
                            ) : (
                              <span className="text-gray-500"><span className="text-gray-400">{o.shipping_company}</span> <span className="font-mono">{o.tracking_number}</span></span>
                            )}
                          </div>
                        )}

                        {o.admin_note && (
                          <div className="mt-2 text-[11px] text-gray-600 bg-amber-50/60 border border-amber-100 rounded-md px-2 py-1 break-words">
                            <span className="text-amber-600 font-medium">담당자</span> {o.admin_note}
                          </div>
                        )}

                        <div className="mt-2">
                          {editingNoteId === o.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={sellerNotes[o.id] || ""}
                                onChange={e => setSellerNotes(prev => ({ ...prev, [o.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === "Enter") saveSellerNote(o.id); if (e.key === "Escape") setEditingNoteId(null); }}
                                placeholder="판매사 비고 입력"
                                className="flex-1 px-2 py-1.5 text-[12px] border border-blue-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
                                autoFocus
                              />
                              <button onClick={() => saveSellerNote(o.id)} className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-blue-500 rounded-md active:scale-95 whitespace-nowrap">저장</button>
                            </div>
                          ) : (
                            <span
                              onClick={() => { setEditingNoteId(o.id); setSellerNotes(prev => ({ ...prev, [o.id]: prev[o.id] || o.seller_note || "" })); }}
                              className={`inline-block text-[11px] cursor-pointer px-2 py-1 rounded-md border border-dashed ${sellerNotes[o.id] || o.seller_note ? "text-gray-700 border-gray-200 bg-gray-50" : "text-gray-400 border-gray-200"}`}
                            >
                              {sellerNotes[o.id] || o.seller_note ? `📝 ${sellerNotes[o.id] || o.seller_note}` : "📝 비고 입력"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {totalOrders === 0 && (
          <div className="bg-white rounded-xl border border-gray-200/60 p-16 text-center shadow-sm">
            <div className="text-4xl mb-4">📭</div>
            <p className="text-gray-400 text-sm font-medium">이번 달 주문이 없습니다.</p>
          </div>
        )}

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
