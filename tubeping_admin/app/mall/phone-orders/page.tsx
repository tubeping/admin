"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface PhoneOrderClient {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
}

interface PhoneOrder {
  id: string;
  order_number: string;
  client_id: string;
  order_date: string;
  product_name: string;
  option_text: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  depositor_name: string | null;
  payment_status: string;
  paid_at: string | null;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_zipcode: string | null;
  recipient_address: string | null;
  delivery_message: string | null;
  shipping_company: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  status: string;
  memo: string | null;
  created_at: string;
  phone_order_clients: PhoneOrderClient | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "접수", color: "text-yellow-700", bg: "bg-yellow-50" },
  confirmed: { label: "확정", color: "text-blue-700", bg: "bg-blue-50" },
  shipping: { label: "배송중", color: "text-indigo-700", bg: "bg-indigo-50" },
  delivered: { label: "배송완료", color: "text-green-700", bg: "bg-green-50" },
  cancelled: { label: "취소", color: "text-red-700", bg: "bg-red-50" },
};

const PAYMENT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  unpaid: { label: "미입금", color: "text-red-700", bg: "bg-red-50" },
  paid: { label: "입금확인", color: "text-green-700", bg: "bg-green-50" },
};

export default function PhoneOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PhoneOrder[]>([]);
  const [clients, setClients] = useState<PhoneOrderClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 필터
  const [clientFilter, setClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // 인라인 편집
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/phone-order-clients?status=active");
      const data = await res.json();
      setClients(data.clients || []);
    } catch { /* ignore */ }
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (clientFilter) params.set("client_id", clientFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (paymentFilter) params.set("payment_status", paymentFilter);
      if (keyword) params.set("keyword", keyword);
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);

      const res = await fetch(`/admin/api/phone-orders?${params.toString()}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [clientFilter, statusFilter, paymentFilter, keyword, startDate, endDate]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const toggleAll = () => {
    if (selected.size === orders.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map((o) => o.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkUpdate = async (updates: Record<string, unknown>) => {
    if (selected.size === 0) return;
    try {
      await fetch("/admin/api/phone-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), updates }),
      });
      setSelected(new Set());
      fetchOrders();
    } catch { /* ignore */ }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}건의 주문을 삭제하시겠습니까?`)) return;
    try {
      await fetch("/admin/api/phone-orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      setSelected(new Set());
      fetchOrders();
    } catch { /* ignore */ }
  };

  const saveInlineEdit = async (id: string, field: string, value: string) => {
    setEditingCell(null);
    const updates: Record<string, unknown> = {};

    if (field === "shipping_company" || field === "tracking_number" || field === "memo") {
      updates[field] = value;
    } else if (field === "quantity" || field === "unit_price") {
      updates[field] = parseInt(value, 10) || 0;
    }

    if (Object.keys(updates).length === 0) return;

    try {
      await fetch("/admin/api/phone-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], updates }),
      });
      fetchOrders();
    } catch { /* ignore */ }
  };

  const startEdit = (id: string, field: string, currentValue: string) => {
    setEditingCell({ id, field });
    setEditValue(currentValue || "");
  };

  // 통계
  const totalCount = orders.length;
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const shippingCount = orders.filter((o) => o.status === "shipping").length;
  const unpaidCount = orders.filter((o) => o.payment_status === "unpaid").length;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">전화주문 관리</h1>
          <p className="text-sm text-gray-500 mt-1">전화/문자로 접수된 주문을 관리합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/mall/phone-orders/clients")}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            판매처 관리
          </button>
          <button
            onClick={() => router.push("/mall/phone-orders/new")}
            className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818]"
          >
            + 주문 접수
          </button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "전체 주문", value: totalCount, color: "text-gray-900" },
          { label: "접수 대기", value: pendingCount, color: "text-yellow-600" },
          { label: "배송중", value: shippingCount, color: "text-indigo-600" },
          { label: "미입금", value: unpaidCount, color: "text-red-600" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
          >
            <option value="">전체 판매처</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
          >
            <option value="">전체 상태</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
          >
            <option value="">입금 전체</option>
            {Object.entries(PAYMENT_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
          <span className="text-gray-400">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />

          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="상품명, 수령인, 입금자 검색"
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg w-52"
          />
        </div>
      </div>

      {/* 일괄 작업 */}
      {selected.size > 0 && (
        <div className="bg-[#FFF0F5] rounded-xl border border-[#C41E1E]/20 p-3 flex items-center gap-3">
          <span className="text-sm font-medium text-[#C41E1E]">{selected.size}건 선택</span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => bulkUpdate({ status: "confirmed" })}
              className="px-3 py-1.5 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              확정 처리
            </button>
            <button
              onClick={() => bulkUpdate({ status: "shipping" })}
              className="px-3 py-1.5 text-xs font-medium bg-indigo-500 text-white rounded-lg hover:bg-indigo-600"
            >
              배송중 처리
            </button>
            <button
              onClick={() => bulkUpdate({ status: "delivered" })}
              className="px-3 py-1.5 text-xs font-medium bg-green-500 text-white rounded-lg hover:bg-green-600"
            >
              배송완료
            </button>
            <button
              onClick={() => bulkUpdate({ payment_status: "paid", paid_at: new Date().toISOString() })}
              className="px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
            >
              입금확인
            </button>
            <button
              onClick={bulkDelete}
              className="px-3 py-1.5 text-xs font-medium bg-red-500 text-white rounded-lg hover:bg-red-600"
            >
              삭제
            </button>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && selected.size === orders.length}
                    onChange={toggleAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">주문번호</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">주문일</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">판매처</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">상품명</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">옵션</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500">수량</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">수령인</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">입금자</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500">입금</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500">상태</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">배송업체</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">운송장번호</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">메모</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={14} className="py-20 text-center text-gray-400">
                    불러오는 중...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-20 text-center text-gray-400">
                    전화주문이 없습니다
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const st = STATUS_MAP[order.status] || STATUS_MAP.pending;
                  const pt = PAYMENT_MAP[order.payment_status] || PAYMENT_MAP.unpaid;
                  return (
                    <tr
                      key={order.id}
                      className={`border-b border-gray-100 hover:bg-gray-50/50 ${
                        selected.has(order.id) ? "bg-[#FFF8FA]" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(order.id)}
                          onChange={() => toggleOne(order.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{order.order_number}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{order.order_date}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-medium text-gray-900">
                          {order.phone_order_clients?.name || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-900 max-w-[200px] truncate">
                        {order.product_name}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[120px] truncate">
                        {order.option_text || "-"}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-900">{order.quantity}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-900">{order.recipient_name}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">{order.depositor_name || "-"}</td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => {
                            if (order.payment_status === "unpaid") {
                              bulkUpdate.call(null, { payment_status: "paid", paid_at: new Date().toISOString() });
                            }
                          }}
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${pt.color} ${pt.bg}`}
                        >
                          {pt.label}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <select
                          value={order.status}
                          onChange={async (e) => {
                            const newStatus = e.target.value;
                            const updates: Record<string, unknown> = { status: newStatus };
                            if (newStatus === "shipping" && !order.shipped_at) {
                              updates.shipped_at = new Date().toISOString();
                            }
                            await fetch("/admin/api/phone-orders", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ ids: [order.id], updates }),
                            });
                            fetchOrders();
                          }}
                          className={`text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer ${st.color} ${st.bg}`}
                        >
                          {Object.entries(STATUS_MAP).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </td>

                      {/* 인라인 편집 가능 셀: 배송업체 */}
                      <td
                        className="px-3 py-2.5 text-xs text-gray-600 cursor-pointer hover:bg-gray-100"
                        onClick={() => startEdit(order.id, "shipping_company", order.shipping_company || "")}
                      >
                        {editingCell?.id === order.id && editingCell.field === "shipping_company" ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineEdit(order.id, "shipping_company", editValue)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveInlineEdit(order.id, "shipping_company", editValue);
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded"
                          />
                        ) : (
                          order.shipping_company || <span className="text-gray-300">클릭하여 입력</span>
                        )}
                      </td>

                      {/* 인라인 편집 가능 셀: 운송장번호 */}
                      <td
                        className="px-3 py-2.5 text-xs text-gray-600 cursor-pointer hover:bg-gray-100"
                        onClick={() => startEdit(order.id, "tracking_number", order.tracking_number || "")}
                      >
                        {editingCell?.id === order.id && editingCell.field === "tracking_number" ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineEdit(order.id, "tracking_number", editValue)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveInlineEdit(order.id, "tracking_number", editValue);
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded"
                          />
                        ) : (
                          order.tracking_number || <span className="text-gray-300">클릭하여 입력</span>
                        )}
                      </td>

                      {/* 인라인 편집 가능 셀: 메모 */}
                      <td
                        className="px-3 py-2.5 text-xs text-gray-500 cursor-pointer hover:bg-gray-100 max-w-[100px] truncate"
                        onClick={() => startEdit(order.id, "memo", order.memo || "")}
                      >
                        {editingCell?.id === order.id && editingCell.field === "memo" ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineEdit(order.id, "memo", editValue)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveInlineEdit(order.id, "memo", editValue);
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded"
                          />
                        ) : (
                          order.memo || <span className="text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
