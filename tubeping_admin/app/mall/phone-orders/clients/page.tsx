"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface PhoneOrderClient {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  memo: string | null;
  status: string;
  view_token: string | null;
  created_at: string;
}

interface ClientOrderSummary {
  client_id: string;
  total_orders: number;
  total_amount: number;
  last_order_date: string | null;
}

export default function PhoneOrderClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<PhoneOrderClient[]>([]);
  const [orderSummaries, setOrderSummaries] = useState<Map<string, ClientOrderSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");

  // 편집 모달
  const [editing, setEditing] = useState<PhoneOrderClient | null>(null);
  const [formName, setFormName] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formMemo, setFormMemo] = useState("");

  // 신규 등록
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newMemo, setNewMemo] = useState("");

  // 상세 보기 (고객사별 주문 내역)
  const [viewClient, setViewClient] = useState<PhoneOrderClient | null>(null);
  const [clientOrders, setClientOrders] = useState<Array<{
    id: string;
    order_number: string;
    order_date: string;
    product_name: string;
    option_text: string | null;
    quantity: number;
    total_amount: number;
    recipient_name: string;
    status: string;
    payment_status: string;
    shipping_company: string | null;
    tracking_number: string | null;
  }>>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set("keyword", keyword);
      const res = await fetch(`/admin/api/phone-order-clients?${params.toString()}`);
      const data = await res.json();
      setClients(data.clients || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [keyword]);

  const fetchOrderSummaries = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/phone-orders?limit=9999");
      const data = await res.json();
      const orders = data.orders || [];
      const map = new Map<string, ClientOrderSummary>();
      for (const o of orders) {
        const existing = map.get(o.client_id);
        if (existing) {
          existing.total_orders++;
          existing.total_amount += o.total_amount || 0;
          if (!existing.last_order_date || o.order_date > existing.last_order_date) {
            existing.last_order_date = o.order_date;
          }
        } else {
          map.set(o.client_id, {
            client_id: o.client_id,
            total_orders: 1,
            total_amount: o.total_amount || 0,
            last_order_date: o.order_date,
          });
        }
      }
      setOrderSummaries(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchOrderSummaries(); }, [fetchOrderSummaries]);

  const handleAdd = async () => {
    if (!newName.trim()) { alert("판매처명은 필수입니다."); return; }
    try {
      const res = await fetch("/admin/api/phone-order-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          contact_name: newContact || null,
          phone: newPhone || null,
          memo: newMemo || null,
        }),
      });
      if (res.ok) {
        setNewName(""); setNewContact(""); setNewPhone(""); setNewMemo("");
        setShowAdd(false);
        fetchClients();
      } else {
        const err = await res.json();
        alert(err.error || "등록 실패");
      }
    } catch { /* ignore */ }
  };

  const startEdit = (client: PhoneOrderClient) => {
    setEditing(client);
    setFormName(client.name);
    setFormContact(client.contact_name || "");
    setFormPhone(client.phone || "");
    setFormMemo(client.memo || "");
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      await fetch("/admin/api/phone-order-clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          updates: {
            name: formName,
            contact_name: formContact || null,
            phone: formPhone || null,
            memo: formMemo || null,
          },
        }),
      });
      setEditing(null);
      fetchClients();
    } catch { /* ignore */ }
  };

  const toggleStatus = async (client: PhoneOrderClient) => {
    const newStatus = client.status === "active" ? "inactive" : "active";
    try {
      await fetch("/admin/api/phone-order-clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: client.id, updates: { status: newStatus } }),
      });
      fetchClients();
    } catch { /* ignore */ }
  };

  const handleDelete = async (client: PhoneOrderClient) => {
    if (!confirm(`"${client.name}"을(를) 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch("/admin/api/phone-order-clients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: client.id }),
      });
      if (res.ok) {
        fetchClients();
      } else {
        const err = await res.json();
        alert(err.error || "삭제 실패");
      }
    } catch { /* ignore */ }
  };

  const copyViewLink = async (client: PhoneOrderClient) => {
    if (!client.view_token) {
      alert("이 판매처에는 아직 조회 토큰이 생성되지 않았습니다.\nSupabase에서 마이그레이션을 실행해주세요.");
      return;
    }
    const url = `${window.location.origin}/admin/seller/${client.view_token}`;
    try {
      await navigator.clipboard.writeText(url);
      alert(`${client.name} 조회 링크가 복사되었습니다.\n\n${url}`);
    } catch {
      prompt("아래 링크를 복사하세요:", url);
    }
  };

  const viewClientOrders = async (client: PhoneOrderClient) => {
    setViewClient(client);
    setOrdersLoading(true);
    try {
      const res = await fetch(`/admin/api/phone-orders?client_id=${client.id}`);
      const data = await res.json();
      setClientOrders(data.orders || []);
    } catch { /* ignore */ }
    setOrdersLoading(false);
  };

  const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
    pending: { label: "접수", color: "text-yellow-700", bg: "bg-yellow-50" },
    confirmed: { label: "확정", color: "text-blue-700", bg: "bg-blue-50" },
    shipping: { label: "배송중", color: "text-indigo-700", bg: "bg-indigo-50" },
    delivered: { label: "배송완료", color: "text-green-700", bg: "bg-green-50" },
    cancelled: { label: "취소", color: "text-red-700", bg: "bg-red-50" },
  };

  const inputClass = "w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E] outline-none";

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/mall/phone-orders")} className="p-2 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">판매처(고객사) 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">전화주문 판매처를 등록하고 주문 내역을 조회합니다</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818]"
        >
          + 판매처 등록
        </button>
      </div>

      {/* 검색 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="판매처명, 담당자명 검색"
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg w-64"
        />
      </div>

      {/* 신규 등록 폼 */}
      {showAdd && (
        <div className="bg-white rounded-xl border-2 border-[#C41E1E]/30 p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-900">새 판매처 등록</h2>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">판매처명 *</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} placeholder="판매처명" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">담당자</label>
              <input value={newContact} onChange={(e) => setNewContact(e.target.value)} className={inputClass} placeholder="담당자명" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">연락처</label>
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className={inputClass} placeholder="010-0000-0000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">메모</label>
              <input value={newMemo} onChange={(e) => setNewMemo(e.target.value)} className={inputClass} placeholder="메모" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
            <button onClick={handleAdd} className="px-4 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818]">등록</button>
          </div>
        </div>
      )}

      {/* 판매처 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">판매처명</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">담당자</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">연락처</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">총 주문</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">총 금액</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">최근 주문일</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">상태</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">메모</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-16 text-center text-gray-400">불러오는 중...</td></tr>
            ) : clients.length === 0 ? (
              <tr><td colSpan={9} className="py-16 text-center text-gray-400">등록된 판매처가 없습니다</td></tr>
            ) : (
              clients.map((client) => {
                const summary = orderSummaries.get(client.id);
                return (
                  <tr key={client.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => viewClientOrders(client)}
                        className="text-sm font-medium text-[#C41E1E] hover:underline"
                      >
                        {client.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{client.contact_name || "-"}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{client.phone || "-"}</td>
                    <td className="px-4 py-3 text-center text-xs font-medium text-gray-900">
                      {summary?.total_orders || 0}건
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-gray-900">
                      {(summary?.total_amount || 0).toLocaleString()}원
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{summary?.last_order_date || "-"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        client.status === "active" ? "text-green-700 bg-green-50" : "text-gray-500 bg-gray-100"
                      }`}>
                        {client.status === "active" ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[120px] truncate">{client.memo || "-"}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => viewClientOrders(client)} className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded" title="주문 내역">
                          주문
                        </button>
                        <button
                          onClick={() => copyViewLink(client)}
                          className="px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 rounded"
                          title="판매처 조회 링크 복사"
                        >
                          링크
                        </button>
                        <button onClick={() => startEdit(client)} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded">
                          수정
                        </button>
                        <button onClick={() => toggleStatus(client)} className="px-2 py-1 text-xs text-yellow-600 hover:bg-yellow-50 rounded">
                          {client.status === "active" ? "비활성" : "활성"}
                        </button>
                        <button onClick={() => handleDelete(client)} className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded">
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 수정 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-[480px] p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">판매처 수정</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">판매처명</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">담당자</label>
                <input value={formContact} onChange={(e) => setFormContact(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">연락처</label>
                <input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">메모</label>
                <input value={formMemo} onChange={(e) => setFormMemo(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
              <button onClick={handleSave} className="px-4 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818]">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 고객사별 주문 내역 모달 */}
      {viewClient && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setViewClient(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-[900px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{viewClient.name} - 주문 내역</h2>
                <p className="text-sm text-gray-500">{clientOrders.length}건의 주문</p>
              </div>
              <button onClick={() => setViewClient(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {ordersLoading ? (
                <p className="text-center text-gray-400 py-10">불러오는 중...</p>
              ) : clientOrders.length === 0 ? (
                <p className="text-center text-gray-400 py-10">주문 내역이 없습니다</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">주문번호</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">주문일</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">상품명</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500">수량</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">수령인</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500">상태</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500">입금</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">운송장</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientOrders.map((o) => {
                      const st = STATUS_MAP[o.status] || STATUS_MAP.pending;
                      return (
                        <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                          <td className="px-3 py-2 font-mono text-xs text-gray-600">{o.order_number}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{o.order_date}</td>
                          <td className="px-3 py-2 text-xs text-gray-900 max-w-[200px] truncate">
                            {o.product_name}{o.option_text ? ` (${o.option_text})` : ""}
                          </td>
                          <td className="px-3 py-2 text-center text-xs">{o.quantity}</td>
                          <td className="px-3 py-2 text-xs">{o.recipient_name}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.color} ${st.bg}`}>{st.label}</span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              o.payment_status === "paid" ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50"
                            }`}>
                              {o.payment_status === "paid" ? "확인" : "미입금"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {o.tracking_number ? `${o.shipping_company || ""} ${o.tracking_number}` : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
