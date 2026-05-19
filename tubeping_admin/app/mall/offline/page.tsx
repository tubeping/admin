"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface OfflineClient {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  business_no: string | null;
  memo: string | null;
  status: string;
}

interface Product {
  tp_code: string;
  image_url: string | null;
}

interface OfflineOrder {
  id: string;
  order_number: string;
  client_id: string;
  order_date: string;
  product_id: string | null;
  product_name: string;
  option_text: string | null;
  quantity: number;
  purchase_price: number;
  supply_price: number;
  total_amount: number;
  shipping_method: string;
  shipping_company: string | null;
  tracking_number: string | null;
  shipping_cost: number;
  shipped_at: string | null;
  status: string;
  payment_status: string;
  paid_at: string | null;
  memo: string | null;
  created_at: string;
  offline_clients: { id: string; name: string; contact_name: string | null; phone: string | null } | null;
  products: Product | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  confirmed: "확정",
  shipped: "출고",
  delivered: "납품완료",
  cancelled: "취소",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  confirmed: "bg-blue-100 text-blue-700",
  shipped: "bg-yellow-100 text-yellow-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};
const PAYMENT_LABEL: Record<string, string> = { unpaid: "미입금", paid: "입금완료" };
const PAYMENT_STYLE: Record<string, string> = { unpaid: "text-red-500", paid: "text-green-600" };
const SHIPPING_LABEL: Record<string, string> = { courier: "택배", freight: "용달" };

function today() { return new Date().toISOString().slice(0, 10); }

export default function OfflinePage() {
  const [orders, setOrders] = useState<OfflineOrder[]>([]);
  const [clients, setClients] = useState<OfflineClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 필터
  const [filterClient, setFilterClient] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPayment, setFilterPayment] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [dateTo, setDateTo] = useState(today());
  const [searchKeyword, setSearchKeyword] = useState("");

  // 모달
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OfflineOrder | null>(null);

  // 신규 주문 폼
  const [form, setForm] = useState({
    client_id: "", product_name: "", option_text: "", quantity: 1,
    purchase_price: 0, supply_price: 0, shipping_method: "courier",
    shipping_company: "", shipping_cost: 0, memo: "", order_date: today(),
  });

  // 거래처 폼
  const [clientForm, setClientForm] = useState({
    name: "", contact_name: "", phone: "", address: "", business_no: "", memo: "",
  });
  const [editingClient, setEditingClient] = useState<OfflineClient | null>(null);

  // 상품 검색
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<{ id: string; tp_code: string; product_name: string; supply_price: number; price: number }[]>([]);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterClient) params.set("client_id", filterClient);
    if (filterStatus) params.set("status", filterStatus);
    if (filterPayment) params.set("payment_status", filterPayment);
    if (dateFrom) params.set("start_date", dateFrom);
    if (dateTo) params.set("end_date", dateTo);
    if (searchKeyword) params.set("keyword", searchKeyword);
    const res = await fetch(`/admin/api/offline-orders?${params}`);
    if (res.ok) {
      const data = await res.json();
      setOrders(data.orders || []);
    }
    setLoading(false);
  }, [filterClient, filterStatus, filterPayment, dateFrom, dateTo, searchKeyword]);

  const fetchClients = useCallback(async () => {
    const res = await fetch("/admin/api/offline-clients?status=active");
    if (res.ok) {
      const data = await res.json();
      setClients(data.clients || []);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // 상품 검색
  useEffect(() => {
    if (productSearch.length < 2) { setProductResults([]); return; }
    const timer = setTimeout(async () => {
      const res = await fetch(`/admin/api/products/search?q=${encodeURIComponent(productSearch)}`);
      if (res.ok) {
        const data = await res.json();
        setProductResults(data.products || data || []);
        setShowProductDropdown(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  // 통계
  const stats = useMemo(() => {
    const totalQty = orders.reduce((s, o) => s + o.quantity, 0);
    const totalAmount = orders.reduce((s, o) => s + o.purchase_price * o.quantity, 0); // 납품금액 = 공급가 × 수량
    const totalSales = orders.reduce((s, o) => s + o.supply_price * o.quantity, 0); // 판매금액 = 판매가 × 수량
    const totalShipping = orders.reduce((s, o) => s + o.shipping_cost, 0);
    const totalMargin = orders.reduce((s, o) => s + ((o.supply_price - o.purchase_price) * o.quantity - o.shipping_cost) / 2, 0);
    const unpaidCount = orders.filter((o) => o.payment_status === "unpaid" && o.status !== "cancelled").length;
    const unpaidAmount = orders.filter((o) => o.payment_status === "unpaid" && o.status !== "cancelled").reduce((s, o) => s + o.purchase_price * o.quantity, 0);
    return { totalQty, totalAmount, totalSales, totalMargin, totalShipping, unpaidCount, unpaidAmount, count: orders.length };
  }, [orders]);

  // 주문 저장
  const handleSaveOrder = async () => {
    if (!form.client_id) { alert("거래처를 선택해주세요."); return; }
    if (!form.product_name) { alert("상품명을 입력해주세요."); return; }

    if (editingOrder) {
      const res = await fetch("/admin/api/offline-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [editingOrder.id],
          updates: {
            ...form,
            total_amount: form.supply_price * form.quantity,
          },
        }),
      });
      if (res.ok) {
        setShowOrderModal(false);
        setEditingOrder(null);
        fetchOrders();
      } else {
        const data = await res.json();
        alert(`오류: ${data.error}`);
      }
    } else {
      const res = await fetch("/admin/api/offline-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowOrderModal(false);
        fetchOrders();
      } else {
        const data = await res.json();
        alert(`오류: ${data.error}`);
      }
    }
  };

  // 거래처 저장
  const handleSaveClient = async () => {
    if (!clientForm.name) { alert("거래처명을 입력해주세요."); return; }
    if (editingClient) {
      const res = await fetch("/admin/api/offline-clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingClient.id, ...clientForm }),
      });
      if (res.ok) {
        setShowClientModal(false);
        setEditingClient(null);
        fetchClients();
      }
    } else {
      const res = await fetch("/admin/api/offline-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientForm),
      });
      if (res.ok) {
        setShowClientModal(false);
        fetchClients();
      }
    }
  };

  // 상태 일괄 변경
  const handleBulkStatusChange = async (status: string) => {
    if (selected.size === 0) return;
    const updates: Record<string, unknown> = { status };
    if (status === "shipped") updates.shipped_at = new Date().toISOString();
    await fetch("/admin/api/offline-orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), updates }),
    });
    setSelected(new Set());
    fetchOrders();
  };

  // 입금 처리
  const handleBulkPayment = async () => {
    if (selected.size === 0) return;
    await fetch("/admin/api/offline-orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: Array.from(selected),
        updates: { payment_status: "paid", paid_at: new Date().toISOString() },
      }),
    });
    setSelected(new Set());
    fetchOrders();
  };

  // 삭제
  const handleDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}건을 삭제하시겠습니까?`)) return;
    await fetch("/admin/api/offline-orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    setSelected(new Set());
    fetchOrders();
  };

  const openNewOrder = () => {
    setEditingOrder(null);
    setForm({
      client_id: "", product_name: "", option_text: "", quantity: 1,
      purchase_price: 0, supply_price: 0, shipping_method: "courier",
      shipping_company: "", shipping_cost: 0, memo: "", order_date: today(),
    });
    setProductSearch("");
    setShowOrderModal(true);
  };

  const openEditOrder = (o: OfflineOrder) => {
    setEditingOrder(o);
    setForm({
      client_id: o.client_id, product_name: o.product_name, option_text: o.option_text || "",
      quantity: o.quantity, purchase_price: o.purchase_price, supply_price: o.supply_price,
      shipping_method: o.shipping_method, shipping_company: o.shipping_company || "",
      shipping_cost: o.shipping_cost, memo: o.memo || "", order_date: o.order_date,
    });
    setProductSearch(o.product_name);
    setShowOrderModal(true);
  };

  const openNewClient = () => {
    setEditingClient(null);
    setClientForm({ name: "", contact_name: "", phone: "", address: "", business_no: "", memo: "" });
    setShowClientModal(true);
  };

  const openEditClient = (c: OfflineClient) => {
    setEditingClient(c);
    setClientForm({
      name: c.name, contact_name: c.contact_name || "", phone: c.phone || "",
      address: c.address || "", business_no: c.business_no || "", memo: c.memo || "",
    });
    setShowClientModal(true);
  };

  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-gray-900">오프라인 납품</h1>
        <div className="text-sm text-gray-500">
          전체 <span className="font-bold text-gray-900">{stats.count}</span>건
        </div>
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 grid grid-cols-6 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">거래처</label>
          <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5">
            <option value="">전체</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">상태</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5">
            <option value="">전체</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">입금상태</label>
          <select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5">
            <option value="">전체</option>
            <option value="unpaid">미입금</option>
            <option value="paid">입금완료</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">시작일</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">종료일</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">검색</label>
          <input type="text" placeholder="상품명, 납품번호" value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-7 gap-3 mb-4">
        {[
          { label: "주문수량", value: `${stats.totalQty}개` },
          { label: "납품금액", value: `₩${stats.totalAmount.toLocaleString()}` },
          { label: "판매금액", value: `₩${stats.totalSales.toLocaleString()}` },
          { label: "마진", value: `₩${stats.totalMargin.toLocaleString()}`, color: stats.totalMargin > 0 ? "text-green-600" : "text-red-600" },
          { label: "배송비", value: `₩${stats.totalShipping.toLocaleString()}` },
          { label: "미입금", value: `${stats.unpaidCount}건`, color: "text-red-500" },
          { label: "미입금 금액", value: `₩${stats.unpaidAmount.toLocaleString()}`, color: "text-red-500" },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500">{s.label}</div>
            <div className={`text-lg font-bold mt-0.5 ${s.color || "text-gray-900"}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 액션 바 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={openNewOrder}
          className="px-3 py-1.5 bg-[#C41E1E] text-white text-xs font-medium rounded-lg hover:bg-[#A01818] cursor-pointer">
          + 납품 등록
        </button>
        <button onClick={openNewClient}
          className="px-3 py-1.5 bg-gray-700 text-white text-xs font-medium rounded-lg hover:bg-gray-800 cursor-pointer">
          + 거래처 등록
        </button>

        {selected.size > 0 && (
          <>
            <span className="text-xs text-gray-500 ml-2">{selected.size}건 선택</span>
            <button onClick={() => handleBulkStatusChange("confirmed")}
              className="px-2.5 py-1.5 text-xs border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 cursor-pointer">확정</button>
            <button onClick={() => handleBulkStatusChange("shipped")}
              className="px-2.5 py-1.5 text-xs border border-yellow-300 text-yellow-700 rounded-lg hover:bg-yellow-50 cursor-pointer">출고</button>
            <button onClick={() => handleBulkStatusChange("delivered")}
              className="px-2.5 py-1.5 text-xs border border-green-300 text-green-700 rounded-lg hover:bg-green-50 cursor-pointer">납품완료</button>
            <button onClick={handleBulkPayment}
              className="px-2.5 py-1.5 text-xs border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 cursor-pointer">입금처리</button>
            <button onClick={handleDelete}
              className="px-2.5 py-1.5 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50 cursor-pointer">삭제</button>
            <button onClick={() => {
              const ids = Array.from(selected).join(",");
              window.open(`/admin/mall/offline/invoice?ids=${ids}`, "_blank");
            }}
              className="px-2.5 py-1.5 text-xs border border-gray-400 text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer font-medium">거래명세서</button>
          </>
        )}

        {/* 거래처 관리 드롭다운 */}
        <div className="ml-auto relative group">
          <button className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">
            거래처 관리
          </button>
          <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-30 max-h-80 overflow-y-auto">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-xs">
                <div>
                  <span className="font-medium">{c.name}</span>
                  {c.contact_name && <span className="text-gray-400 ml-1">({c.contact_name})</span>}
                </div>
                <button onClick={() => openEditClient(c)} className="text-blue-500 hover:underline cursor-pointer">수정</button>
              </div>
            ))}
            {clients.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">등록된 거래처가 없습니다</div>}
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-xs text-gray-500 font-medium">
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" checked={allSelected} onChange={(e) => {
                    setSelected(e.target.checked ? new Set(orders.map((o) => o.id)) : new Set());
                  }} className="w-3.5 h-3.5 cursor-pointer" />
                </th>
                <th className="px-3 py-2.5 text-left">No</th>
                <th className="px-3 py-2.5 text-left">납품번호</th>
                <th className="px-3 py-2.5 text-left">거래처</th>
                <th className="px-3 py-2.5 text-left">실제납품처</th>
                <th className="px-3 py-2.5 text-left">상품정보</th>
                <th className="px-3 py-2.5 text-right">수량</th>
                <th className="px-3 py-2.5 text-right">공급가</th>
                <th className="px-3 py-2.5 text-right">판매가</th>
                <th className="px-3 py-2.5 text-right">납품금액</th>
                <th className="px-3 py-2.5 text-right">마진</th>
                <th className="px-3 py-2.5 text-right">택배비</th>
                <th className="px-3 py-2.5 text-center">배송</th>
                <th className="px-3 py-2.5 text-center">상태</th>
                <th className="px-3 py-2.5 text-center">입금</th>
                <th className="px-3 py-2.5 text-left">납품일</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={16} className="text-center py-10 text-gray-400">로딩 중...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={16} className="text-center py-10 text-gray-400">납품 내역이 없습니다</td></tr>
              ) : orders.map((o, idx) => {
                const margin = ((o.supply_price - o.purchase_price) * o.quantity - o.shipping_cost) / 2;
                const marginRate = o.supply_price > 0 ? (margin / (o.supply_price * o.quantity) * 100).toFixed(1) : "0";
                return (
                  <tr key={o.id} className={`border-b border-gray-100 hover:bg-gray-50 ${selected.has(o.id) ? "bg-blue-50" : ""}`}>
                    <td className="px-3 py-2.5 text-center">
                      <input type="checkbox" checked={selected.has(o.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          e.target.checked ? next.add(o.id) : next.delete(o.id);
                          setSelected(next);
                        }} className="w-3.5 h-3.5 cursor-pointer" />
                    </td>
                    <td className="px-3 py-2.5 text-gray-400">{orders.length - idx}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => openEditOrder(o)} className="text-blue-600 hover:underline cursor-pointer text-xs font-medium">
                        {o.order_number}
                      </button>
                      <div className="text-[10px] text-gray-400">{o.order_date}</div>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-xs">제이드상사</td>
                    <td className="px-3 py-2.5 text-xs">{o.offline_clients?.name || "-"}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-xs">{o.product_name}</div>
                      {o.option_text && <div className="text-[10px] text-gray-400">{o.option_text}</div>}
                      {o.products?.tp_code && <div className="text-[10px] text-blue-500">{o.products.tp_code}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right">{o.quantity}</td>
                    <td className="px-3 py-2.5 text-right text-gray-500">₩{o.purchase_price.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right">₩{o.supply_price.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-medium">₩{(o.purchase_price * o.quantity).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={margin >= 0 ? "text-green-600" : "text-red-500"}>
                        ₩{margin.toLocaleString()}
                      </span>
                      <div className="text-[10px] text-gray-400">{marginRate}%</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        type="number"
                        defaultValue={o.shipping_cost}
                        key={`ship-${o.id}-${o.shipping_cost}`}
                        className="w-20 text-xs text-right border border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none rounded px-1.5 py-0.5 bg-transparent"
                        min={0}
                        onBlur={async (e) => {
                          const val = parseInt(e.target.value) || 0;
                          if (val === o.shipping_cost) return;
                          await fetch("/admin/api/offline-orders", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ids: [o.id], updates: { shipping_cost: val } }),
                          });
                          fetchOrders();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${o.shipping_method === "freight" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"}`}>
                        {SHIPPING_LABEL[o.shipping_method] || o.shipping_method}
                      </span>
                      {o.tracking_number && <div className="text-[10px] text-gray-400 mt-0.5">{o.tracking_number}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <select
                        value={o.status}
                        className={`text-xs px-1.5 py-0.5 rounded border-0 cursor-pointer ${STATUS_STYLE[o.status] || ""}`}
                        onChange={async (e) => {
                          const updates: Record<string, unknown> = { status: e.target.value };
                          if (e.target.value === "shipped") updates.shipped_at = new Date().toISOString();
                          await fetch("/admin/api/offline-orders", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ids: [o.id], updates }),
                          });
                          fetchOrders();
                        }}
                      >
                        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        className={`text-xs font-medium px-2 py-0.5 rounded cursor-pointer hover:opacity-70 ${o.payment_status === "paid" ? "bg-green-100 text-green-700" : "bg-red-50 text-red-500"}`}
                        onClick={async () => {
                          const next = o.payment_status === "paid" ? "unpaid" : "paid";
                          await fetch("/admin/api/offline-orders", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              ids: [o.id],
                              updates: { payment_status: next, paid_at: next === "paid" ? new Date().toISOString() : null },
                            }),
                          });
                          fetchOrders();
                        }}
                        title="클릭해서 입금 상태 변경"
                      >
                        {PAYMENT_LABEL[o.payment_status] || o.payment_status}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{o.order_date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 하단 요약 */}
      {orders.length > 0 && (
        <div className="mt-3 flex gap-4 text-xs text-gray-500 justify-end">
          <span>조회: <b className="text-gray-900">{stats.count}건</b></span>
          <span>수량: <b className="text-gray-900">{stats.totalQty}개</b></span>
          <span>납품금액: <b className="text-gray-900">₩{stats.totalAmount.toLocaleString()}</b></span>
          <span>마진: <b className="text-green-600">₩{stats.totalMargin.toLocaleString()}</b></span>
        </div>
      )}

      {/* 납품 등록/수정 모달 */}
      {showOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowOrderModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editingOrder ? "납품 수정" : "납품 등록"}</h2>
            <div className="grid grid-cols-2 gap-3">
              {/* 거래처 */}
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">거래처 *</label>
                <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
                  <option value="">선택</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name} {c.contact_name ? `(${c.contact_name})` : ""}</option>)}
                </select>
              </div>

              {/* 상품 검색 */}
              <div className="col-span-2 relative">
                <label className="text-xs text-gray-500 mb-1 block">상품 검색</label>
                <input type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                  onFocus={() => productResults.length > 0 && setShowProductDropdown(true)}
                  placeholder="상품명 또는 TP코드로 검색"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
                {showProductDropdown && productResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {productResults.map((p) => (
                      <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs cursor-pointer"
                        onClick={() => {
                          setForm({
                            ...form,
                            product_name: p.product_name,
                            purchase_price: p.supply_price,
                            supply_price: p.price,
                          });
                          setProductSearch(p.product_name);
                          setShowProductDropdown(false);
                        }}>
                        <span className="text-blue-500 font-mono mr-2">{p.tp_code}</span>
                        <span>{p.product_name}</span>
                        <span className="text-gray-400 ml-2">매입 ₩{p.supply_price.toLocaleString()} / 공급 ₩{p.price.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 상품명 */}
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">상품명 *</label>
                <input type="text" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>

              {/* 옵션 */}
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">옵션</label>
                <input type="text" value={form.option_text} onChange={(e) => setForm({ ...form, option_text: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">수량</label>
                <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" min={1} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">납품일</label>
                <input type="date" value={form.order_date} onChange={(e) => setForm({ ...form, order_date: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">매입가 (원)</label>
                <input type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: parseInt(e.target.value) || 0 })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">공급가 (원)</label>
                <input type="number" value={form.supply_price} onChange={(e) => setForm({ ...form, supply_price: parseInt(e.target.value) || 0 })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>

              {/* 마진 표시 */}
              <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 text-xs flex justify-between">
                <span>총 납품금액: <b>₩{(form.supply_price * form.quantity).toLocaleString()}</b></span>
                <span>마진: <b className={((form.supply_price - form.purchase_price) * form.quantity - form.shipping_cost) >= 0 ? "text-green-600" : "text-red-500"}>
                  ₩{(((form.supply_price - form.purchase_price) * form.quantity - form.shipping_cost) / 2).toLocaleString()}
                  ({form.supply_price > 0 ? (((form.supply_price - form.purchase_price) * form.quantity - form.shipping_cost) / 2 / (form.supply_price * form.quantity) * 100).toFixed(1) : 0}%)
                </b></span>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">배송방식</label>
                <select value={form.shipping_method} onChange={(e) => setForm({ ...form, shipping_method: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
                  <option value="courier">택배</option>
                  <option value="freight">용달</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">배송업체</label>
                <input type="text" value={form.shipping_company} onChange={(e) => setForm({ ...form, shipping_company: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" placeholder="택배사 / 용달업체" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">배송비 (원)</label>
                <input type="number" value={form.shipping_cost} onChange={(e) => setForm({ ...form, shipping_cost: parseInt(e.target.value) || 0 })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">메모</label>
                <input type="text" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowOrderModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
              <button onClick={handleSaveOrder}
                className="px-4 py-2 text-sm bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818] cursor-pointer">
                {editingOrder ? "수정" : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 거래처 등록/수정 모달 */}
      {showClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowClientModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editingClient ? "거래처 수정" : "거래처 등록"}</h2>
            <div className="grid gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">거래처명 *</label>
                <input type="text" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">담당자명</label>
                  <input type="text" value={clientForm.contact_name} onChange={(e) => setClientForm({ ...clientForm, contact_name: e.target.value })}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">연락처</label>
                  <input type="text" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">주소</label>
                <input type="text" value={clientForm.address} onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">사업자번호</label>
                <input type="text" value={clientForm.business_no} onChange={(e) => setClientForm({ ...clientForm, business_no: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">메모</label>
                <input type="text" value={clientForm.memo} onChange={(e) => setClientForm({ ...clientForm, memo: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowClientModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
              <button onClick={handleSaveClient}
                className="px-4 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 cursor-pointer">
                {editingClient ? "수정" : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
