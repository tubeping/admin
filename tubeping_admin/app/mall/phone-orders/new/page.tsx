"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface PhoneOrderClient {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
}

interface OrderItem {
  product_name: string;
  option_text: string;
  quantity: number;
  unit_price: number;
}

export default function NewPhoneOrderPage() {
  const router = useRouter();
  const [clients, setClients] = useState<PhoneOrderClient[]>([]);
  const [saving, setSaving] = useState(false);

  // 주문 기본 정보
  const [clientId, setClientId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));

  // 상품 목록 (여러 상품 한 번에 접수)
  const [items, setItems] = useState<OrderItem[]>([
    { product_name: "", option_text: "", quantity: 1, unit_price: 0 },
  ]);

  // 입금자
  const [depositorName, setDepositorName] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("unpaid");

  // 수령인
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientZipcode, setRecipientZipcode] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");

  // 배송
  const [shippingCompany, setShippingCompany] = useState("");
  const [memo, setMemo] = useState("");

  // 빠른 판매처 추가
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/phone-order-clients?status=active");
      const data = await res.json();
      setClients(data.clients || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const addItem = () => {
    setItems([...items, { product_name: "", option_text: "", quantity: 1, unit_price: 0 }]);
  };

  const removeItem = (idx: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: keyof OrderItem, value: string | number) => {
    const next = [...items];
    (next[idx] as Record<string, unknown>)[field] = value;
    setItems(next);
  };

  const addClient = async () => {
    if (!newClientName.trim()) return;
    try {
      const res = await fetch("/admin/api/phone-order-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newClientName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchClients();
        setClientId(data.id);
        setNewClientName("");
        setShowNewClient(false);
      } else {
        const err = await res.json();
        alert(err.error || "판매처 등록 실패");
      }
    } catch { /* ignore */ }
  };

  const handleSubmit = async () => {
    if (!clientId) { alert("판매처를 선택해주세요."); return; }
    if (!recipientName.trim()) { alert("수령인을 입력해주세요."); return; }

    const validItems = items.filter((item) => item.product_name.trim());
    if (validItems.length === 0) { alert("상품명을 1개 이상 입력해주세요."); return; }

    setSaving(true);
    try {
      for (const item of validItems) {
        const res = await fetch("/admin/api/phone-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            order_date: orderDate,
            product_name: item.product_name,
            option_text: item.option_text || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            depositor_name: depositorName || null,
            payment_status: paymentStatus,
            recipient_name: recipientName,
            recipient_phone: recipientPhone || null,
            recipient_zipcode: recipientZipcode || null,
            recipient_address: recipientAddress || null,
            delivery_message: deliveryMessage || null,
            shipping_company: shippingCompany || null,
            memo: memo || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || "주문 접수 실패");
          setSaving(false);
          return;
        }
      }
      router.push("/mall/phone-orders");
    } catch {
      alert("주문 접수 중 오류 발생");
    }
    setSaving(false);
  };

  const inputClass = "w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E] outline-none";
  const labelClass = "block text-xs font-semibold text-gray-600 mb-1";

  return (
    <div className="max-w-4xl space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">전화주문 접수</h1>
          <p className="text-sm text-gray-500 mt-0.5">전화/문자로 접수된 주문을 등록합니다</p>
        </div>
      </div>

      {/* 기본 정보 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-900">기본 정보</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>판매처 *</label>
            <div className="flex gap-2">
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={`${inputClass} flex-1`}
              >
                <option value="">판매처 선택</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowNewClient(!showNewClient)}
                className="px-3 py-2 text-sm font-medium text-[#C41E1E] border border-[#C41E1E] rounded-lg hover:bg-[#FFF0F5]"
                title="새 판매처 추가"
              >
                +
              </button>
            </div>
            {showNewClient && (
              <div className="flex gap-2 mt-2">
                <input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="새 판매처명"
                  className={`${inputClass} flex-1`}
                  onKeyDown={(e) => { if (e.key === "Enter") addClient(); }}
                />
                <button
                  onClick={addClient}
                  className="px-3 py-2 text-sm font-medium bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818]"
                >
                  등록
                </button>
              </div>
            )}
          </div>
          <div>
            <label className={labelClass}>주문일</label>
            <input
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* 상품 정보 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">상품 정보</h2>
          <button
            onClick={addItem}
            className="px-3 py-1.5 text-xs font-medium text-[#C41E1E] border border-[#C41E1E] rounded-lg hover:bg-[#FFF0F5]"
          >
            + 상품 추가
          </button>
        </div>
        {items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-5">
              <label className={labelClass}>상품명 *</label>
              <input
                value={item.product_name}
                onChange={(e) => updateItem(idx, "product_name", e.target.value)}
                placeholder="상품명 입력"
                className={inputClass}
              />
            </div>
            <div className="col-span-3">
              <label className={labelClass}>옵션</label>
              <input
                value={item.option_text}
                onChange={(e) => updateItem(idx, "option_text", e.target.value)}
                placeholder="옵션"
                className={inputClass}
              />
            </div>
            <div className="col-span-1">
              <label className={labelClass}>수량</label>
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => updateItem(idx, "quantity", parseInt(e.target.value, 10) || 1)}
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>단가</label>
              <input
                type="number"
                min={0}
                value={item.unit_price}
                onChange={(e) => updateItem(idx, "unit_price", parseInt(e.target.value, 10) || 0)}
                className={inputClass}
              />
            </div>
            <div className="col-span-1">
              {items.length > 1 && (
                <button
                  onClick={() => removeItem(idx)}
                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 입금 정보 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-900">입금 정보</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>입금자명</label>
            <input
              value={depositorName}
              onChange={(e) => setDepositorName(e.target.value)}
              placeholder="입금자명"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>입금 상태</label>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              className={inputClass}
            >
              <option value="unpaid">미입금</option>
              <option value="paid">입금확인</option>
            </select>
          </div>
        </div>
      </div>

      {/* 수령인 정보 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-900">수령인 정보</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>수령인 *</label>
            <input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="수령인 이름"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>전화번호</label>
            <input
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="010-0000-0000"
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-1">
            <label className={labelClass}>우편번호</label>
            <input
              value={recipientZipcode}
              onChange={(e) => setRecipientZipcode(e.target.value)}
              placeholder="우편번호"
              className={inputClass}
            />
          </div>
          <div className="col-span-3">
            <label className={labelClass}>주소</label>
            <input
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              placeholder="상세 주소 입력"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>배송 메시지</label>
          <input
            value={deliveryMessage}
            onChange={(e) => setDeliveryMessage(e.target.value)}
            placeholder="배송 시 요청사항"
            className={inputClass}
          />
        </div>
      </div>

      {/* 배송 / 메모 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-900">기타</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>배송업체</label>
            <input
              value={shippingCompany}
              onChange={(e) => setShippingCompany(e.target.value)}
              placeholder="배송업체명"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>메모</label>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* 하단 버튼 */}
      <div className="flex justify-end gap-3 pb-6">
        <button
          onClick={() => router.back()}
          className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          취소
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-6 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50"
        >
          {saving ? "등록 중..." : `주문 접수 (${items.filter((i) => i.product_name.trim()).length}건)`}
        </button>
      </div>
    </div>
  );
}
