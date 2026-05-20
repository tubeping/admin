"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

interface PhoneOrderClient {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
}

interface ProductSearchResult {
  id: string;
  tp_code: string;
  product_name: string;
  selling: string;
}

interface JusoResult {
  zipNo: string;
  roadAddr: string;
  jibunAddr: string;
  bdNm: string;
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

interface NewRow {
  id: string;
  client_id: string;
  client_text: string; // 판매처 검색어
  product_name: string;
  option_text: string;
  quantity: string;
  recipient_name: string;
  depositor_name: string;
  recipient_phone: string;
  recipient_zipcode: string;
  recipient_address: string;
  address_detail: string; // 상세주소
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

let rowIdCounter = 0;
function makeEmptyRow(): NewRow {
  return {
    id: `new-${++rowIdCounter}`,
    client_id: "",
    client_text: "",
    product_name: "",
    option_text: "",
    quantity: "1",
    recipient_name: "",
    depositor_name: "",
    recipient_phone: "",
    recipient_zipcode: "",
    recipient_address: "",
    address_detail: "",
  };
}

// ============================================================
// 자동완성 드롭다운 컴포넌트
// ============================================================
function AutocompleteInput({
  value,
  onChange,
  onSelect,
  items,
  allItems,
  placeholder,
  className,
  renderItem,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (item: { id: string; label: string }) => void;
  items: { id: string; label: string; sub?: string }[];
  allItems?: { id: string; label: string }[]; // blur 시 이름 매칭용
  placeholder: string;
  className: string;
  renderItem?: (item: { id: string; label: string; sub?: string }, idx: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // blur 시 입력한 텍스트가 목록에 정확히 매칭되면 자동 선택
  const handleBlur = () => {
    setTimeout(() => {
      setFocused(false);
      setOpen(false);
      if (!value.trim()) return;
      const source = allItems || items;
      const match = source.find((item) => item.label === value.trim());
      if (match) onSelect(match);
    }, 200);
  };

  const showDropdown = open && focused && items.length > 0;

  return (
    <div className="relative" ref={ref}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={className}
      />
      {showDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {items.map((item, idx) => (
            <button
              key={item.id}
              onMouseDown={(e) => { e.preventDefault(); onSelect(item); setOpen(false); }}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-[#FFF0F5] border-b border-gray-50 last:border-0"
            >
              {renderItem ? renderItem(item, idx) : (
                <>
                  <span className="text-gray-900">{item.label}</span>
                  {item.sub && <span className="ml-1.5 text-[10px] text-gray-400">{item.sub}</span>}
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 주소 검색 인풋
// ============================================================
function AddressSearchInput({
  value,
  onChange,
  onSelect,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (addr: { zipNo: string; roadAddr: string }) => void;
  className: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JusoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const searchAddress = useCallback(async (kw: string) => {
    if (kw.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/admin/api/address-search?keyword=${encodeURIComponent(kw)}`);
      const data = await res.json();
      setResults(data.results || []);
      setOpen(true);
    } catch { /* ignore */ }
    setSearching(false);
  }, []);

  const handleChange = (v: string) => {
    setQuery(v);
    onChange(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => searchAddress(v), 400);
  };

  return (
    <div className="relative" ref={ref}>
      <input
        value={value || query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        placeholder="도로명 주소 검색"
        className={className}
      />
      {searching && (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
          <div className="w-3 h-3 border border-gray-300 border-t-[#C41E1E] rounded-full animate-spin" />
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto min-w-[280px]">
          {results.map((r, i) => (
            <button
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect({ zipNo: r.zipNo, roadAddr: r.roadAddr });
                setQuery(r.roadAddr);
                setOpen(false);
              }}
              className="w-full text-left px-2.5 py-2 text-xs hover:bg-[#FFF0F5] border-b border-gray-50 last:border-0"
            >
              <div className="text-gray-900">{r.roadAddr}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">[{r.zipNo}] {r.jibunAddr}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 메인 페이지
// ============================================================
export default function PhoneOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PhoneOrder[]>([]);
  const [clients, setClients] = useState<PhoneOrderClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

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

  // 신규 입력 (기본 5행)
  const [newRows, setNewRows] = useState<NewRow[]>([makeEmptyRow(), makeEmptyRow(), makeEmptyRow(), makeEmptyRow(), makeEmptyRow()]);
  const [showNewRows, setShowNewRows] = useState(false);

  // 상품 검색 결과 (행별)
  const [productResults, setProductResults] = useState<Record<string, ProductSearchResult[]>>({});
  const productTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // 판매처 추가
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");

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

  // === 상품 검색 ===
  const searchProducts = useCallback(async (rowId: string, q: string) => {
    if (q.length < 2) { setProductResults((prev) => ({ ...prev, [rowId]: [] })); return; }
    try {
      const res = await fetch(`/admin/api/products/search?q=${encodeURIComponent(q)}&limit=10`);
      const data = await res.json();
      setProductResults((prev) => ({ ...prev, [rowId]: data.products || [] }));
    } catch { /* ignore */ }
  }, []);

  // === 신규 행 관리 ===
  const updateNewRow = (id: string, field: keyof NewRow, value: string) => {
    setNewRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

    // 상품명 검색 디바운스
    if (field === "product_name") {
      if (productTimers.current[id]) clearTimeout(productTimers.current[id]);
      productTimers.current[id] = setTimeout(() => searchProducts(id, value), 300);
    }
  };

  const addNewRow = () => setNewRows((prev) => [...prev, makeEmptyRow()]);

  const removeNewRow = (id: string) => {
    setNewRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length === 0 ? [makeEmptyRow()] : next;
    });
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
        await fetchClients();
        setNewClientName("");
        setShowNewClient(false);
      } else {
        const err = await res.json();
        alert(err.error || "판매처 등록 실패");
      }
    } catch { /* ignore */ }
  };

  const submitNewRows = async () => {
    const validRows = newRows.filter((r) => r.product_name.trim() && r.recipient_name.trim());
    if (validRows.length === 0) { alert("상품명과 수령인을 입력해주세요."); return; }

    // 텍스트로 입력된 판매처를 자동 매칭
    for (const row of validRows) {
      if (!row.client_id && row.client_text.trim()) {
        const match = clients.find((c) => c.name === row.client_text.trim());
        if (match) {
          row.client_id = match.id;
        }
      }
    }

    const noClient = validRows.find((r) => !r.client_id);
    if (noClient) { alert(`판매처 "${noClient.client_text || ""}"을(를) 찾을 수 없습니다. 드롭다운에서 선택하거나 새 판매처를 등록해주세요.`); return; }

    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    let successCount = 0;

    for (const row of validRows) {
      const fullAddress = row.recipient_address + (row.address_detail ? " " + row.address_detail : "");
      try {
        const res = await fetch("/admin/api/phone-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: row.client_id,
            order_date: today,
            product_name: row.product_name,
            option_text: row.option_text || null,
            quantity: parseInt(row.quantity, 10) || 1,
            recipient_name: row.recipient_name,
            depositor_name: row.depositor_name || null,
            recipient_phone: row.recipient_phone || null,
            recipient_zipcode: row.recipient_zipcode || null,
            recipient_address: fullAddress || null,
          }),
        });
        if (res.ok) successCount++;
        else { const err = await res.json(); alert(`등록 실패: ${err.error}`); break; }
      } catch { break; }
    }

    if (successCount > 0) {
      setNewRows([makeEmptyRow(), makeEmptyRow(), makeEmptyRow(), makeEmptyRow(), makeEmptyRow()]);
      setShowNewRows(false);
      fetchOrders();
    }
    setSaving(false);
  };

  // === 기존 주문 관리 ===
  const toggleAll = () => {
    if (selected.size === orders.length) setSelected(new Set());
    else setSelected(new Set(orders.map((o) => o.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const bulkUpdate = async (updates: Record<string, unknown>) => {
    if (selected.size === 0) return;
    await fetch("/admin/api/phone-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected), updates }) });
    setSelected(new Set()); fetchOrders();
  };
  const bulkDelete = async () => {
    if (selected.size === 0 || !confirm(`${selected.size}건의 주문을 삭제하시겠습니까?`)) return;
    await fetch("/admin/api/phone-orders", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected) }) });
    setSelected(new Set()); fetchOrders();
  };
  const singleUpdate = async (id: string, updates: Record<string, unknown>) => {
    await fetch("/admin/api/phone-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id], updates }) });
    fetchOrders();
  };
  const saveInlineEdit = async (id: string, field: string, value: string) => {
    setEditingCell(null);
    const updates: Record<string, unknown> = {};
    if (["shipping_company", "tracking_number", "memo"].includes(field)) updates[field] = value;
    else if (["quantity", "unit_price"].includes(field)) updates[field] = parseInt(value, 10) || 0;
    if (Object.keys(updates).length > 0) await singleUpdate(id, updates);
  };
  const startEdit = (id: string, field: string, currentValue: string) => { setEditingCell({ id, field }); setEditValue(currentValue || ""); };

  // 통계
  const totalCount = orders.length;
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const shippingCount = orders.filter((o) => o.status === "shipping").length;
  const unpaidCount = orders.filter((o) => o.payment_status === "unpaid").length;

  // 인라인 편집 셀
  const EditableCell = ({ orderId, field, value, placeholder }: { orderId: string; field: string; value: string | null; placeholder?: string }) => {
    const isEditing = editingCell?.id === orderId && editingCell.field === field;
    return (
      <td className="px-2 py-2 text-xs text-gray-600 cursor-pointer hover:bg-blue-50/50" onClick={() => startEdit(orderId, field, value || "")}>
        {isEditing ? (
          <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => saveInlineEdit(orderId, field, editValue)}
            onKeyDown={(e) => { if (e.key === "Enter") saveInlineEdit(orderId, field, editValue); if (e.key === "Escape") setEditingCell(null); }}
            className="w-full px-1 py-0.5 text-xs border border-blue-400 rounded outline-none" />
        ) : ( value || <span className="text-gray-300">{placeholder || "-"}</span> )}
      </td>
    );
  };

  const cellInput = "w-full px-1.5 py-1 text-xs border border-gray-200 rounded outline-none focus:border-[#C41E1E] focus:ring-1 focus:ring-[#C41E1E]/20 bg-white";

  // 판매처 필터용 목록
  const getFilteredClients = (text: string) => {
    if (!text) return clients;
    const lower = text.toLowerCase();
    return clients.filter((c) => c.name.toLowerCase().includes(lower));
  };

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">전화주문 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">전화/문자로 접수된 주문을 관리합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push("/mall/phone-orders/clients")} className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">판매처 관리</button>
          <button onClick={() => setShowNewRows(!showNewRows)} className={`px-4 py-2.5 text-sm font-medium rounded-lg ${showNewRows ? "bg-gray-200 text-gray-700 hover:bg-gray-300" : "bg-[#C41E1E] text-white hover:bg-[#A01818]"}`}>
            {showNewRows ? "접수 닫기" : "+ 주문 접수"}
          </button>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "전체 주문", value: totalCount, color: "text-gray-900" },
          { label: "접수 대기", value: pendingCount, color: "text-yellow-600" },
          { label: "배송중", value: shippingCount, color: "text-indigo-600" },
          { label: "미입금", value: unpaidCount, color: "text-red-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-[11px] text-gray-500">{s.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ====== 스프레드시트 신규 입력 ====== */}
      {showNewRows && (
        <div className="bg-white rounded-xl border-2 border-[#C41E1E]/30 overflow-hidden">
          <div className="px-4 py-3 bg-[#FFF0F5] border-b border-[#C41E1E]/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold text-[#C41E1E]">주문 접수</h2>
              <span className="text-xs text-gray-500">행 추가로 여러 건 한 번에 접수</span>
            </div>
            <div className="flex items-center gap-2">
              {!showNewClient ? (
                <button onClick={() => setShowNewClient(true)} className="px-2.5 py-1 text-xs font-medium text-[#C41E1E] border border-[#C41E1E]/30 rounded hover:bg-[#FFF0F5]">+ 새 판매처</button>
              ) : (
                <div className="flex items-center gap-1">
                  <input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="판매처명" className="px-2 py-1 text-xs border border-gray-300 rounded w-28" onKeyDown={(e) => { if (e.key === "Enter") addClient(); }} />
                  <button onClick={addClient} className="px-2 py-1 text-xs font-medium bg-[#C41E1E] text-white rounded hover:bg-[#A01818]">등록</button>
                  <button onClick={() => { setShowNewClient(false); setNewClientName(""); }} className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded">취소</button>
                </div>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 min-w-[110px]">판매처 *</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 min-w-[200px]">상품명 *</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 min-w-[100px]">옵션</th>
                  <th className="px-2 py-2 text-center text-[11px] font-semibold text-gray-500 w-14">수량</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 min-w-[80px]">수령인 *</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 min-w-[70px]">입금자</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 min-w-[110px]">전화번호</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 min-w-[200px]">주소 검색</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 min-w-[140px]">상세주소</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 w-20">우편번호</th>
                  <th className="w-8 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {newRows.map((row, idx) => (
                  <tr key={row.id} className="border-b border-gray-100 hover:bg-[#FFFBFC]">
                    <td className="px-2 py-1.5 text-center text-[11px] text-gray-400">{idx + 1}</td>

                    {/* 판매처 자동완성 */}
                    <td className="px-1 py-1">
                      <AutocompleteInput
                        value={row.client_text}
                        onChange={(v) => {
                          updateNewRow(row.id, "client_text", v);
                          if (!v) updateNewRow(row.id, "client_id", "");
                        }}
                        onSelect={(item) => {
                          updateNewRow(row.id, "client_id", item.id);
                          updateNewRow(row.id, "client_text", item.label);
                        }}
                        items={getFilteredClients(row.client_text).map((c) => ({ id: c.id, label: c.name }))}
                        allItems={clients.map((c) => ({ id: c.id, label: c.name }))}
                        placeholder="판매처 검색"
                        className={`${cellInput} ${!row.client_id ? "" : "font-medium"}`}
                      />
                    </td>

                    {/* 상품명 자동완성 */}
                    <td className="px-1 py-1">
                      <AutocompleteInput
                        value={row.product_name}
                        onChange={(v) => updateNewRow(row.id, "product_name", v)}
                        onSelect={(item) => updateNewRow(row.id, "product_name", item.label)}
                        items={(productResults[row.id] || []).map((p) => ({ id: p.id, label: p.product_name, sub: p.tp_code }))}
                        placeholder="상품명 검색"
                        className={cellInput}
                        renderItem={(item) => (
                          <>
                            <span className="text-gray-900">{item.label}</span>
                            {item.sub && <span className="ml-1 text-[10px] text-gray-400">{item.sub}</span>}
                          </>
                        )}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input value={row.option_text} onChange={(e) => updateNewRow(row.id, "option_text", e.target.value)} placeholder="옵션" className={cellInput} />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" min={1} value={row.quantity} onChange={(e) => updateNewRow(row.id, "quantity", e.target.value)} className={`${cellInput} text-center`} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={row.recipient_name} onChange={(e) => updateNewRow(row.id, "recipient_name", e.target.value)} placeholder="수령인" className={cellInput} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={row.depositor_name} onChange={(e) => updateNewRow(row.id, "depositor_name", e.target.value)} placeholder="입금자" className={cellInput} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={row.recipient_phone} onChange={(e) => updateNewRow(row.id, "recipient_phone", e.target.value)} placeholder="010-0000-0000" className={cellInput} />
                    </td>

                    {/* 주소 검색 (JUSO API) */}
                    <td className="px-1 py-1">
                      <AddressSearchInput
                        value={row.recipient_address}
                        onChange={(v) => updateNewRow(row.id, "recipient_address", v)}
                        onSelect={({ zipNo, roadAddr }) => {
                          updateNewRow(row.id, "recipient_address", roadAddr);
                          updateNewRow(row.id, "recipient_zipcode", zipNo);
                        }}
                        className={cellInput}
                      />
                    </td>

                    {/* 상세주소 */}
                    <td className="px-1 py-1">
                      <input value={row.address_detail} onChange={(e) => updateNewRow(row.id, "address_detail", e.target.value)} placeholder="상세주소" className={cellInput} />
                    </td>

                    {/* 우편번호 (자동) */}
                    <td className="px-1 py-1">
                      <input value={row.recipient_zipcode} readOnly placeholder="자동" className={`${cellInput} bg-gray-50 text-gray-500`} />
                    </td>

                    <td className="px-1 py-1 text-center">
                      <button onClick={() => removeNewRow(row.id)} className="p-0.5 text-gray-300 hover:text-red-500" title="행 삭제">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <button onClick={addNewRow} className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-white">+ 행 추가</button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{newRows.filter((r) => r.product_name.trim() && r.recipient_name.trim()).length}건 입력됨</span>
              <button onClick={submitNewRows} disabled={saving} className="px-4 py-1.5 bg-[#C41E1E] text-white text-xs font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50">
                {saving ? "등록 중..." : "주문 등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="bg-white rounded-xl border border-gray-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg">
            <option value="">전체 판매처</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg">
            <option value="">전체 상태</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg">
            <option value="">입금 전체</option>
            {Object.entries(PAYMENT_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg" />
          <span className="text-gray-400 text-xs">~</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg" />
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="상품명, 수령인, 입금자 검색" className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg w-48" />
        </div>
      </div>

      {/* 일괄 작업 */}
      {selected.size > 0 && (
        <div className="bg-[#FFF0F5] rounded-xl border border-[#C41E1E]/20 p-2.5 flex items-center gap-3">
          <span className="text-xs font-medium text-[#C41E1E]">{selected.size}건 선택</span>
          <div className="flex gap-1.5 ml-auto">
            <button onClick={() => bulkUpdate({ status: "confirmed" })} className="px-2.5 py-1 text-[11px] font-medium bg-blue-500 text-white rounded hover:bg-blue-600">확정</button>
            <button onClick={() => bulkUpdate({ status: "shipping" })} className="px-2.5 py-1 text-[11px] font-medium bg-indigo-500 text-white rounded hover:bg-indigo-600">배송중</button>
            <button onClick={() => bulkUpdate({ status: "delivered" })} className="px-2.5 py-1 text-[11px] font-medium bg-green-500 text-white rounded hover:bg-green-600">배송완료</button>
            <button onClick={() => bulkUpdate({ payment_status: "paid", paid_at: new Date().toISOString() })} className="px-2.5 py-1 text-[11px] font-medium bg-emerald-500 text-white rounded hover:bg-emerald-600">입금확인</button>
            <button onClick={bulkDelete} className="px-2.5 py-1 text-[11px] font-medium bg-red-500 text-white rounded hover:bg-red-600">삭제</button>
          </div>
        </div>
      )}

      {/* ====== 주문 목록 ====== */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-8 px-2 py-2.5"><input type="checkbox" checked={orders.length > 0 && selected.size === orders.length} onChange={toggleAll} className="rounded border-gray-300" /></th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">주문번호</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">주문일</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">판매처</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">상품명</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">옵션</th>
                <th className="px-2 py-2.5 text-center text-[11px] font-semibold text-gray-500">수량</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">수령인</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">입금자</th>
                <th className="px-2 py-2.5 text-center text-[11px] font-semibold text-gray-500">입금</th>
                <th className="px-2 py-2.5 text-center text-[11px] font-semibold text-gray-500">상태</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500">메모</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="py-16 text-center text-gray-400 text-sm">불러오는 중...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={12} className="py-16 text-center text-gray-400 text-sm">전화주문이 없습니다</td></tr>
              ) : (
                orders.map((order) => {
                  const st = STATUS_MAP[order.status] || STATUS_MAP.pending;
                  const pt = PAYMENT_MAP[order.payment_status] || PAYMENT_MAP.unpaid;
                  return (
                    <tr key={order.id} className={`border-b border-gray-100 hover:bg-gray-50/50 ${selected.has(order.id) ? "bg-[#FFF8FA]" : ""}`}>
                      <td className="px-2 py-2"><input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleOne(order.id)} className="rounded border-gray-300" /></td>
                      <td className="px-2 py-2 font-mono text-[11px] text-gray-500">{order.order_number}</td>
                      <td className="px-2 py-2 text-[11px] text-gray-500">{order.order_date}</td>
                      <td className="px-2 py-2 text-xs font-medium text-gray-900">{order.phone_order_clients?.name || "-"}</td>
                      <td className="px-2 py-2 text-xs text-gray-900 max-w-[180px] truncate">{order.product_name}</td>
                      <td className="px-2 py-2 text-[11px] text-gray-500 max-w-[100px] truncate">{order.option_text || "-"}</td>
                      <td className="px-2 py-2 text-center text-xs">{order.quantity}</td>
                      <td className="px-2 py-2 text-xs text-gray-900">{order.recipient_name}</td>
                      <td className="px-2 py-2 text-[11px] text-gray-500">{order.depositor_name || "-"}</td>
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => singleUpdate(order.id, order.payment_status === "unpaid" ? { payment_status: "paid", paid_at: new Date().toISOString() } : { payment_status: "unpaid", paid_at: null })}
                          className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full cursor-pointer ${pt.color} ${pt.bg}`}>{pt.label}</button>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <select value={order.status} onChange={(e) => {
                          const updates: Record<string, unknown> = { status: e.target.value };
                          if (e.target.value === "shipping" && !order.shipped_at) updates.shipped_at = new Date().toISOString();
                          singleUpdate(order.id, updates);
                        }} className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full border-0 cursor-pointer ${st.color} ${st.bg}`}>
                          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </td>
                      <EditableCell orderId={order.id} field="memo" value={order.memo} />
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
