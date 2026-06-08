"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface Product {
  id: string;
  tp_code: string;
  product_name: string;
  price: number;
  supply_price: number;
}

interface PhoneOrder {
  id: string;
  cafe24_order_id: string;
  order_date: string;
  product_name: string;
  option_text: string;
  quantity: number;
  product_price: number;
  order_amount: number;
  payment_amount: number;
  buyer_name: string;
  buyer_phone: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  receiver_zipcode: string;
  memo: string;
  shipping_status: string;
  supplier_id: string | null;
  purchase_order_id: string | null;
  suppliers: { name: string; email: string } | null;
  purchase_orders: { id: string; po_number: string; status: string } | null;
}

type TabKey = "all" | "pending" | "ready_po" | "in_po";

const TAB_LABEL: Record<TabKey, string> = {
  all: "전체",
  pending: "입금대기",
  ready_po: "발주대기",
  in_po: "발주완료",
};

export default function PhoneOrderPage() {
  const [form, setForm] = useState({
    product_name: "",
    tp_code: "",
    option_text: "",
    quantity: 1,
    unit_price: 0,
    buyer_name: "",
    buyer_phone: "",
    receiver_name: "",
    receiver_phone: "",
    receiver_address: "",
    receiver_zipcode: "",
    memo: "",
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ order_id: string; payment_amount: number } | null>(null);
  const [orders, setOrders] = useState<PhoneOrder[]>([]);
  const [buyerSameAsReceiver, setBuyerSameAsReceiver] = useState(true);
  const [tab, setTab] = useState<TabKey>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  const searchProducts = useCallback(async (kw: string) => {
    if (!kw || kw.length < 1) { setProducts([]); return; }
    const res = await fetch(`/admin/api/products?keyword=${encodeURIComponent(kw)}&limit=10`);
    const data = await res.json();
    setProducts(data.products || []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchProducts(form.product_name), 200);
    return () => clearTimeout(t);
  }, [form.product_name, searchProducts]);

  const fetchOrders = useCallback(async () => {
    const res = await fetch("/admin/api/orders?limit=500");
    const data = await res.json();
    const phoneOrders = (data.orders || []).filter((o: PhoneOrder) =>
      (o.cafe24_order_id || "").startsWith("PT-")
    );
    setOrders(phoneOrders);
  }, []);

  const syncSheet = async () => {
    if (!confirm("Google Sheet에서 전화주문을 지금 동기화합니다. 계속할까요?")) return;
    setSyncing(true);
    try {
      const res = await fetch("/admin/api/orders/morning-collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSvQIEMjooRsJH0uRpQQRINDQebSMqTKB_tlLkvr9woGi5QdmdrBkfbgrrVtUwXpQ/pub?output=csv" }),
      });
      const data = await res.json();
      alert(`시트 ${data.total_rows || 0}행 · 신규 ${data.imported || 0} · 이미 등록 ${data.skipped_already || 0} · 입금대기 ${data.skipped_no_payment || 0}`);
      fetchOrders();
    } catch (e) {
      alert(`실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const selectProduct = (p: Product) => {
    setForm((f) => ({
      ...f,
      product_name: p.product_name,
      tp_code: p.tp_code,
      unit_price: p.price,
    }));
    setShowDropdown(false);
  };

  const handleSubmit = async () => {
    if (!form.product_name) { alert("상품을 선택하세요."); return; }
    if (!form.receiver_name || !form.receiver_phone || !form.receiver_address) {
      alert("수령인, 연락처, 주소는 필수입니다."); return;
    }
    if (form.quantity < 1 || form.unit_price < 0) { alert("수량/단가 확인"); return; }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        buyer_name: buyerSameAsReceiver ? form.receiver_name : form.buyer_name,
        buyer_phone: buyerSameAsReceiver ? form.receiver_phone : form.buyer_phone,
      };
      const res = await fetch("/admin/api/orders/phone-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { alert(`실패: ${data.error}`); return; }
      setLastResult({ order_id: data.order_id, payment_amount: data.payment_amount });
      setForm({
        product_name: "", tp_code: "", option_text: "",
        quantity: 1, unit_price: 0,
        buyer_name: "", buyer_phone: "",
        receiver_name: "", receiver_phone: "", receiver_address: "", receiver_zipcode: "",
        memo: "",
      });
      setBuyerSameAsReceiver(true);
      fetchOrders();
    } finally {
      setSubmitting(false);
    }
  };

  const togglePayment = async (orderId: string, currentStatus: string) => {
    const newStatus = currentStatus === "pending" ? "ordered" : "pending";
    const label = newStatus === "ordered" ? "입금확인" : "입금전";
    if (!confirm(`${label}으로 변경하시겠습니까?`)) return;
    await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [orderId], updates: { shipping_status: newStatus } }),
    });
    fetchOrders();
  };

  const bulkConfirmPayment = async () => {
    const ids = Array.from(selected).filter((id) => {
      const o = orders.find((x) => x.id === id);
      return o && o.shipping_status === "pending";
    });
    if (ids.length === 0) { alert("입금대기 상태인 주문이 선택되지 않았습니다."); return; }
    if (!confirm(`${ids.length}건을 입금확인 처리하시겠습니까?`)) return;
    await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, updates: { shipping_status: "ordered" } }),
    });
    setSelected(new Set());
    fetchOrders();
  };

  const bulkCreatePO = async () => {
    const targets = Array.from(selected).map((id) => orders.find((o) => o.id === id)).filter(Boolean) as PhoneOrder[];
    if (targets.length === 0) { alert("선택된 주문이 없습니다."); return; }
    const alreadyPO = targets.filter((o) => o.purchase_order_id);
    const pending = targets.filter((o) => o.shipping_status === "pending");
    let warn = "";
    if (pending.length > 0) warn += `\n· 입금대기 ${pending.length}건 포함`;
    if (alreadyPO.length > 0) warn += `\n· 이미 발주된 주문 ${alreadyPO.length}건 포함 (중복 생성됩니다)`;
    if (!confirm(`${targets.length}건의 발주서를 생성합니다. (창고발주는 자동 라우팅)${warn}\n\n계속할까요?`)) return;

    setBulkBusy(true);
    try {
      const res = await fetch("/admin/api/purchase-orders/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: targets.map((o) => o.id) }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`발주 실패: ${data.error || res.status}`); return; }
      const lines = (data.results || []).map((r: { supplier_name: string; po_number?: string; order_count: number; is_warehouse: boolean; email_sent: boolean; error?: string }) => {
        const tag = r.is_warehouse ? "[창고] " : "";
        const status = r.email_sent ? "✓" : "✗";
        const err = r.error ? ` (${r.error})` : "";
        return `${status} ${tag}${r.supplier_name}: ${r.po_number || "?"} (${r.order_count}건)${err}`;
      });
      let msg = `발주 결과: PO ${data.created_count}건 생성, 메일 ${data.email_success}건 발송`;
      if (lines.length) msg += `\n\n${lines.join("\n")}`;
      if (data.skipped?.length) msg += `\n\n건너뜀 ${data.skipped.length}건`;
      alert(msg);
      setSelected(new Set());
      fetchOrders();
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { alert("선택된 주문이 없습니다."); return; }
    const withPO = ids.filter((id) => orders.find((o) => o.id === id)?.purchase_order_id);
    if (withPO.length > 0) {
      alert(`이미 발주된 주문이 ${withPO.length}건 포함되어 있어 삭제할 수 없습니다.\n발주를 먼저 취소해주세요.`);
      return;
    }
    if (!confirm(`${ids.length}건의 전화주문을 삭제합니다.\n정산항목까지 함께 삭제됩니다. 계속할까요?`)) return;
    const res = await fetch("/admin/api/orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (!res.ok) { alert(`삭제 실패: ${data.error}`); return; }
    setSelected(new Set());
    fetchOrders();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => alert("복사됨"));
  };

  const amount = form.unit_price * form.quantity;

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (tab === "pending" && o.shipping_status !== "pending") return false;
      if (tab === "ready_po" && (o.shipping_status === "pending" || o.purchase_order_id)) return false;
      if (tab === "in_po" && !o.purchase_order_id) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${o.cafe24_order_id} ${o.product_name} ${o.receiver_name} ${o.receiver_phone} ${o.buyer_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, tab, search]);

  const stats = useMemo(() => ({
    total: orders.length,
    pending: orders.filter((o) => o.shipping_status === "pending").length,
    readyPO: orders.filter((o) => o.shipping_status !== "pending" && !o.purchase_order_id && o.shipping_status !== "cancelled").length,
    inPO: orders.filter((o) => !!o.purchase_order_id).length,
    totalAmount: orders.reduce((s, o) => s + (o.order_amount || 0), 0),
  }), [orders]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) setSelected(new Set());
    else setSelected(new Set(filtered.map((o) => o.id)));
  };

  const statusBadge = (o: PhoneOrder) => {
    if (o.purchase_order_id && o.purchase_orders) {
      return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700" title={o.purchase_orders.po_number}>발주 {o.purchase_orders.po_number}</span>;
    }
    if (o.shipping_status === "pending") {
      return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">입금대기</span>;
    }
    if (o.shipping_status === "cancelled") {
      return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">취소</span>;
    }
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">발주대기</span>;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">전화주문 관리</h1>
          <p className="text-xs text-gray-500 mt-1">
            전화로 받은 주문을 직접 입력하고, 입금확인 후 원하는 시점에 발주서로 전환합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={syncSheet}
            disabled={syncing}
            className="px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? "동기화 중..." : "시트 동기화 (레거시)"}
          </button>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="px-3 py-2 text-xs font-medium bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818]"
          >
            {formOpen ? "입력폼 닫기" : "+ 신규 전화주문"}
          </button>
        </div>
      </div>

      {lastResult && (
        <div className="mb-5 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-green-600 font-semibold">✓ 주문 등록됨 · {lastResult.order_id}</p>
              <p className="text-xs text-gray-700 mt-1">고객에게 안내할 입금액:</p>
              <p className="text-2xl font-bold text-green-700 mt-0.5">₩{lastResult.payment_amount.toLocaleString()}</p>
              <p className="text-[11px] text-gray-500 mt-1">신한 140-014-420770 · 주식회사 신산애널리틱스</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyToClipboard(`${lastResult.payment_amount.toLocaleString()}원\n신한 140-014-420770\n(주)신산애널리틱스`)}
                className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
              >
                입금안내 복사
              </button>
              <button
                onClick={() => setLastResult(null)}
                className="text-gray-400 hover:text-gray-600 text-sm"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          { label: "전체 전화주문", value: `${stats.total}건` },
          { label: "입금대기", value: `${stats.pending}건`, hl: stats.pending > 0 },
          { label: "발주대기", value: `${stats.readyPO}건`, hl: stats.readyPO > 0 },
          { label: "발주완료", value: `${stats.inPO}건` },
          { label: "총 주문금액", value: `₩${stats.totalAmount.toLocaleString()}` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-lg border border-gray-200 px-3 py-2.5">
            <p className="text-[11px] text-gray-400">{s.label}</p>
            <p className={`text-sm font-bold mt-0.5 ${s.hl ? "text-[#C41E1E]" : "text-gray-900"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="bg-white rounded-xl border p-5 mb-5">
          <p className="text-sm font-semibold text-gray-800 mb-4">신규 전화주문 입력</p>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">상품 (TP코드/이름 검색)</label>
              <div className="relative">
                <input
                  type="text"
                  value={form.product_name}
                  onChange={(e) => {
                    setForm({ ...form, product_name: e.target.value });
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="상품명 입력..."
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                {showDropdown && products.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
                    {products.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => selectProduct(p)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-0 flex items-center gap-2"
                      >
                        <span className="font-mono text-[10px] font-bold text-[#C41E1E] bg-[#FFF0F5] px-1.5 py-0.5 rounded">{p.tp_code}</span>
                        <span className="flex-1 truncate">{p.product_name}</span>
                        <span className="text-xs text-gray-500">₩{p.price.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {form.tp_code && <p className="text-[10px] text-gray-400 mt-1">선택: <span className="font-mono">{form.tp_code}</span></p>}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">옵션</label>
                <input
                  type="text"
                  value={form.option_text}
                  onChange={(e) => setForm({ ...form, option_text: e.target.value })}
                  placeholder="없으면 비워두기"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">수량</label>
                <input
                  type="number" min={1}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) || 1 })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">단가 (원)</label>
                <input
                  type="number" min={0}
                  value={form.unit_price}
                  onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) || 0 })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            {amount > 0 && (
              <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between">
                <span className="text-xs text-gray-600">주문 금액 (예상)</span>
                <span className="text-lg font-bold">₩{amount.toLocaleString()}</span>
              </div>
            )}

            <div className="border-t pt-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">수령인 정보</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">수령인</label>
                  <input
                    type="text"
                    value={form.receiver_name}
                    onChange={(e) => setForm({ ...form, receiver_name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">연락처</label>
                  <input
                    type="tel"
                    value={form.receiver_phone}
                    onChange={(e) => setForm({ ...form, receiver_phone: e.target.value })}
                    placeholder="010-0000-0000"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[120px_1fr] gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">우편번호</label>
                  <input
                    type="text"
                    value={form.receiver_zipcode}
                    onChange={(e) => setForm({ ...form, receiver_zipcode: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">배송지</label>
                  <input
                    type="text"
                    value={form.receiver_address}
                    onChange={(e) => setForm({ ...form, receiver_address: e.target.value })}
                    placeholder="도로명 주소 + 상세주소"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <label className="flex items-center gap-2 mb-3">
                <input type="checkbox" checked={buyerSameAsReceiver} onChange={(e) => setBuyerSameAsReceiver(e.target.checked)} />
                <span className="text-sm text-gray-700">주문자 = 수령인</span>
              </label>
              {!buyerSameAsReceiver && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">주문자명</label>
                    <input
                      type="text"
                      value={form.buyer_name}
                      onChange={(e) => setForm({ ...form, buyer_name: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">주문자 연락처</label>
                    <input
                      type="tel"
                      value={form.buyer_phone}
                      onChange={(e) => setForm({ ...form, buyer_phone: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">배송메시지 (선택)</label>
              <textarea
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
                rows={2}
                placeholder="부재 시 문 앞, 경비실 맡겨주세요 등"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 bg-[#C41E1E] text-white rounded-lg font-semibold hover:bg-[#A01818] disabled:opacity-50"
            >
              {submitting ? "저장 중..." : "주문 저장 + 입금액 발급"}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex border border-gray-300 rounded-lg overflow-hidden">
          {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => {
            const count =
              key === "all" ? stats.total :
              key === "pending" ? stats.pending :
              key === "ready_po" ? stats.readyPO :
              stats.inPO;
            return (
              <button
                key={key}
                onClick={() => { setTab(key); setSelected(new Set()); }}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${tab === key ? "bg-[#C41E1E] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {TAB_LABEL[key]} ({count})
              </button>
            );
          })}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="주문번호 / 상품 / 수령인 / 연락처 검색"
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-64"
        />

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-gray-500">선택 {selected.size}건</span>
              <button
                onClick={bulkConfirmPayment}
                className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 cursor-pointer"
              >
                입금확인 처리
              </button>
              <button
                onClick={bulkCreatePO}
                disabled={bulkBusy}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50"
              >
                {bulkBusy ? "발주 중..." : `선택 발주 (${selected.size})`}
              </button>
              <button
                onClick={bulkDelete}
                className="px-3 py-1.5 border border-red-300 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 cursor-pointer"
              >
                삭제
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
              <th className="px-3 py-2.5 w-10 text-center">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <th className="text-left px-3 py-2.5 font-medium">주문번호</th>
              <th className="text-left px-3 py-2.5 font-medium">일시</th>
              <th className="text-left px-3 py-2.5 font-medium">상품</th>
              <th className="text-center px-3 py-2.5 font-medium">수량</th>
              <th className="text-right px-3 py-2.5 font-medium">금액</th>
              <th className="text-left px-3 py-2.5 font-medium">수령인</th>
              <th className="text-left px-3 py-2.5 font-medium">연락처</th>
              <th className="text-left px-3 py-2.5 font-medium">주소</th>
              <th className="text-center px-3 py-2.5 font-medium">상태</th>
              <th className="text-center px-3 py-2.5 font-medium">액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-8 text-gray-400 text-xs">조건에 맞는 전화주문이 없습니다.</td>
              </tr>
            ) : filtered.map((o) => (
              <tr key={o.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggleSelect(o.id)}
                    className="rounded"
                  />
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-gray-700">{o.cafe24_order_id}</td>
                <td className="px-3 py-2.5 text-[11px] text-gray-500">
                  {o.order_date ? new Date(o.order_date).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}
                </td>
                <td className="px-3 py-2.5 text-gray-800 max-w-[260px]">
                  <div className="truncate" title={o.product_name}>{o.product_name}</div>
                  {o.option_text && <div className="text-[10px] text-gray-400 truncate">{o.option_text}</div>}
                </td>
                <td className="px-3 py-2.5 text-center text-gray-700">{o.quantity}</td>
                <td className="px-3 py-2.5 text-right text-gray-800">
                  ₩{(o.payment_amount || o.order_amount).toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-gray-700">{o.receiver_name}</td>
                <td className="px-3 py-2.5 text-[12px] text-gray-600">{o.receiver_phone}</td>
                <td className="px-3 py-2.5 text-[11px] text-gray-500 max-w-[220px]">
                  <div className="truncate" title={o.receiver_address}>{o.receiver_address}</div>
                  {o.memo && <div className="text-[10px] text-gray-400 truncate" title={o.memo}>📝 {o.memo}</div>}
                </td>
                <td className="px-3 py-2.5 text-center">{statusBadge(o)}</td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => togglePayment(o.id, o.shipping_status)}
                    className="text-[11px] text-gray-600 hover:text-[#C41E1E] underline"
                  >
                    {o.shipping_status === "pending" ? "입금확인" : "입금취소"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
