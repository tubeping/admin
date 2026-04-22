"use client";

import { useState, useEffect, useCallback } from "react";

interface Product {
  id: string;
  tp_code: string;
  product_name: string;
  price: number;
  supply_price: number;
}

interface RecentOrder {
  id: string;
  order_id: string;
  product_name: string;
  receiver_name: string;
  payment_amount: number;
  created_at: string;
  shipping_status: string;
}

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
  const [recent, setRecent] = useState<RecentOrder[]>([]);
  const [buyerSameAsReceiver, setBuyerSameAsReceiver] = useState(true);

  // 상품 검색
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

  // 전화주문 목록 (PT-로 시작하는 전부, 최근 100건)
  const fetchRecent = useCallback(async () => {
    const res = await fetch("/admin/api/orders?limit=200");
    const data = await res.json();
    const phoneOrders = (data.orders || []).filter((o: { cafe24_order_id?: string }) =>
      (o.cafe24_order_id || "").startsWith("PT-")
    );
    setRecent(phoneOrders.slice(0, 100).map((o: { id: string; cafe24_order_id: string; product_name: string; receiver_name: string; payment_amount: number; order_amount: number; created_at: string; shipping_status: string }) => ({
      id: o.id,
      order_id: o.cafe24_order_id,
      product_name: o.product_name,
      receiver_name: o.receiver_name,
      payment_amount: o.payment_amount || o.order_amount,
      created_at: o.created_at,
      shipping_status: o.shipping_status,
    })));
  }, []);

  // 수동 토글
  const togglePayment = async (orderId: string, currentStatus: string) => {
    const newStatus = currentStatus === "pending" ? "ordered" : "pending";
    const label = newStatus === "ordered" ? "입금확인" : "입금전";
    if (!confirm(`${label}으로 변경하시겠습니까?`)) return;
    await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [orderId], updates: { shipping_status: newStatus } }),
    });
    fetchRecent();
  };

  // 시트 수동 동기화
  const [syncing, setSyncing] = useState(false);
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
      fetchRecent();
    } catch (e) {
      alert(`실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

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
      // 폼 초기화
      setForm({
        product_name: "", tp_code: "", option_text: "",
        quantity: 1, unit_price: 0,
        buyer_name: "", buyer_phone: "",
        receiver_name: "", receiver_phone: "", receiver_address: "", receiver_zipcode: "",
        memo: "",
      });
      setBuyerSameAsReceiver(true);
      fetchRecent();
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => alert("복사됨"));
  };

  const amount = form.unit_price * form.quantity;

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">전화주문 입력</h1>
        <p className="text-xs text-gray-500 mt-1">
          주문 저장 즉시 고유 입금액이 부여됩니다. 고객이 안내받은 금액으로 입금하면 자동으로 입금확인 처리돼요.
        </p>
      </div>

      {/* 입금액 안내 */}
      {lastResult && (
        <div className="mb-6 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-green-600 font-semibold">✓ 주문 등록됨 · {lastResult.order_id}</p>
              <p className="text-sm text-gray-700 mt-1">고객에게 안내할 입금액:</p>
              <p className="text-3xl font-bold text-green-700 mt-1">₩{lastResult.payment_amount.toLocaleString()}</p>
              <p className="text-[11px] text-gray-500 mt-2">
                신한 140-014-420770 · 주식회사 신산애널리틱스
              </p>
            </div>
            <button
              onClick={() => copyToClipboard(`${lastResult.payment_amount.toLocaleString()}원\n신한 140-014-420770\n(주)신산애널리틱스`)}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
            >
              입금안내 복사
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* 입력 폼 */}
        <div className="col-span-2 bg-white rounded-xl border p-5 space-y-4">
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

        {/* 최근 전화주문 */}
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">최근 전화주문</p>
          {recent.length === 0 ? (
            <p className="text-xs text-gray-400">최근 주문 없음</p>
          ) : (
            <div className="space-y-2">
              {recent.map((r) => (
                <div key={r.id} className="border rounded-lg p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-gray-500">{r.order_id}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.shipping_status === "ordered" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {r.shipping_status === "ordered" ? "입금완료" : "입금대기"}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-gray-800 mt-1 truncate">{r.product_name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{r.receiver_name} · ₩{r.payment_amount?.toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
