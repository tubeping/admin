"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface SmsRawMessage {
  id: string;
  raw_text: string;
  sender_phone: string;
  received_at: string;
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

interface SmsOrder {
  id: string;
  order_number: string;
  raw_message_id: string | null;
  order_date: string;
  product_name: string;
  option_text: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  orderer_name: string | null;
  orderer_phone: string | null;
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
  parse_confidence: string | null;
  needs_review: boolean;
  memo: string | null;
  created_at: string;
  sms_raw_messages: SmsRawMessage | null;
}

interface NewRow {
  id: string;
  product_name: string;
  option_text: string;
  quantity: string;
  orderer_name: string;
  orderer_phone: string;
  recipient_name: string;
  depositor_name: string;
  recipient_phone: string;
  recipient_zipcode: string;
  recipient_address: string;
  address_detail: string;
  addr_verified: boolean;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  pending: { label: "접수", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", dot: "bg-amber-400" },
  confirmed: { label: "확인", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", dot: "bg-blue-400" },
  transferred: { label: "이관완료", color: "text-teal-700", bg: "bg-teal-50 border-teal-200", dot: "bg-teal-400" },
  cancelled: { label: "취소", color: "text-red-700", bg: "bg-red-50 border-red-200", dot: "bg-red-400" },
};

const PAYMENT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  unpaid: { label: "미입금", color: "text-red-600", bg: "bg-red-50 border-red-200" },
  paid: { label: "입금확인", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
};

const CONFIDENCE_MAP: Record<string, { label: string; color: string }> = {
  high: { label: "높음", color: "text-green-600" },
  medium: { label: "보통", color: "text-amber-600" },
  low: { label: "낮음", color: "text-red-600" },
};

let rowIdCounter = 0;
function makeEmptyRow(): NewRow {
  return {
    id: `new-${++rowIdCounter}`,
    product_name: "",
    option_text: "",
    quantity: "1",
    orderer_name: "",
    orderer_phone: "",
    recipient_name: "",
    depositor_name: "",
    recipient_phone: "",
    recipient_zipcode: "",
    recipient_address: "",
    address_detail: "",
    addr_verified: false,
  };
}

// ============================================================
// 자동완성 드롭다운
// ============================================================
function AutocompleteInput({
  value, onChange, onSelect, items, allItems, placeholder, className, renderItem,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (item: { id: string; label: string }) => void;
  items: { id: string; label: string; sub?: string }[];
  allItems?: { id: string; label: string }[];
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

  useEffect(() => {
    if (focused && items.length > 0) setOpen(true);
  }, [items, focused]);

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
// 주소 검색
// ============================================================
function AddressSearchInput({
  value, onChange, onSelect, className, addrStatus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (addr: { zipNo: string; roadAddr: string }) => void;
  className: string;
  addrStatus?: "valid" | "invalid" | "unverified";
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

  const dotColor = addrStatus === "valid" ? "bg-green-500" : addrStatus === "invalid" ? "bg-red-500" : "bg-yellow-400";
  const dotTitle = addrStatus === "valid" ? "검증 완료" : addrStatus === "invalid" ? "검증 오류" : "미검증";

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-1">
        <span className={`shrink-0 w-2 h-2 rounded-full ${dotColor}`} title={dotTitle} />
        <input
          value={value || query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder="도로명 주소 검색"
          className={className}
        />
      </div>
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
// 원본 문자 보기 모달
// ============================================================
function RawMessageModal({ raw, onClose }: { raw: SmsRawMessage; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900">원본 문자 내용</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">발신: {raw.sender_phone} / {new Date(raw.received_at).toLocaleString("ko-KR")}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto max-h-[60vh]">
          <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono bg-gray-50 rounded-lg p-4 border border-gray-200">
            {raw.raw_text}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 메인 페이지
// ============================================================
export default function SmsOrdersPage() {
  const [orders, setOrders] = useState<SmsOrder[]>([]);
  const [products, setProducts] = useState<ProductSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [showInput, setShowInput] = useState(true);
  const [rawModal, setRawModal] = useState<SmsRawMessage | null>(null);

  // 필터
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");

  // 인라인 편집
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // 신규 입력
  const [newRows, setNewRows] = useState<NewRow[]>([makeEmptyRow(), makeEmptyRow(), makeEmptyRow(), makeEmptyRow(), makeEmptyRow()]);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/products/search?all=1");
      const data = await res.json();
      setProducts(data.products || []);
    } catch { /* ignore */ }
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (paymentFilter) params.set("payment_status", paymentFilter);
      if (keyword) params.set("keyword", keyword);
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (reviewFilter) params.set("needs_review", reviewFilter);
      const res = await fetch(`/admin/api/sms-orders?${params.toString()}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter, paymentFilter, keyword, startDate, endDate, reviewFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // === 신규 행 관리 ===
  const updateNewRow = (id: string, field: keyof NewRow, value: string | boolean) => {
    setNewRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const addNewRow = () => setNewRows((prev) => [...prev, makeEmptyRow()]);

  const removeNewRow = (id: string) => {
    setNewRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length === 0 ? [makeEmptyRow()] : next;
    });
  };

  const submitNewRows = async () => {
    const validRows = newRows.filter((r) => r.product_name.trim() && r.recipient_name.trim());
    if (validRows.length === 0) { alert("상품명과 수령인을 입력해주세요."); return; }

    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    let successCount = 0;

    for (const row of validRows) {
      const fullAddress = row.recipient_address + (row.address_detail ? " " + row.address_detail : "");
      try {
        const res = await fetch("/admin/api/sms-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_date: today,
            product_name: row.product_name,
            option_text: row.option_text || null,
            quantity: parseInt(row.quantity, 10) || 1,
            orderer_name: row.orderer_name || null,
            orderer_phone: row.orderer_phone || null,
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
    await fetch("/admin/api/sms-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected), updates }) });
    setSelected(new Set()); fetchOrders();
  };
  const bulkDelete = async () => {
    if (selected.size === 0 || !confirm(`${selected.size}건의 주문을 삭제하시겠습니까?`)) return;
    await fetch("/admin/api/sms-orders", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected) }) });
    setSelected(new Set()); fetchOrders();
  };
  const singleUpdate = async (id: string, updates: Record<string, unknown>) => {
    await fetch("/admin/api/sms-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id], updates }) });
    fetchOrders();
  };
  const saveInlineEdit = async (id: string, field: string, value: string) => {
    setEditingCell(null);
    const updates: Record<string, unknown> = {};
    if (["shipping_company", "tracking_number", "memo", "product_name", "recipient_name", "recipient_phone", "recipient_address", "depositor_name", "orderer_name", "orderer_phone", "option_text", "delivery_message"].includes(field)) updates[field] = value;
    else if (["quantity", "unit_price"].includes(field)) updates[field] = parseInt(value, 10) || 0;
    if (Object.keys(updates).length > 0) await singleUpdate(id, updates);
  };
  const startEdit = (id: string, field: string, currentValue: string) => { setEditingCell({ id, field }); setEditValue(currentValue || ""); };

  // === 이관 ===
  const transferToOrders = async () => {
    if (selected.size === 0) return;
    const selectedOrders = orders.filter((o) => selected.has(o.id));
    const alreadyTransferred = selectedOrders.filter((o) => o.status === "transferred");
    if (alreadyTransferred.length === selectedOrders.length) {
      alert("선택한 주문이 모두 이미 이관된 건입니다.");
      return;
    }
    const transferable = selectedOrders.filter((o) => o.status !== "transferred");
    if (alreadyTransferred.length > 0) {
      if (!confirm(`${alreadyTransferred.length}건은 이미 이관됨 -> 나머지 ${transferable.length}건만 이관합니다. 계속?`)) return;
    }

    setTransferring(true);
    try {
      const transferIds = transferable.map((o) => o.id);
      const res = await fetch("/admin/api/sms-orders/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: transferIds }),
      });
      const data = await res.json();
      const errorDetails = (data.errors || []).map((e: { order_number: string; reason?: string }) => `${e.order_number}: ${e.reason}`).join("\n");
      if (data.transferred > 0) {
        alert(`${data.transferred}건 이관 완료${data.skipped > 0 ? ` (${data.skipped}건 중복)` : ""}${errorDetails ? `\n\n에러:\n${errorDetails}` : ""}`);
      } else if (data.skipped > 0) {
        alert(`${data.skipped}건 이미 이관됨 (신규 이관 없음)`);
      } else {
        alert(`이관 실패${errorDetails ? `:\n${errorDetails}` : `: ${data.error || "알 수 없는 오류"}`}`);
      }
      setSelected(new Set());
      fetchOrders();
    } catch {
      alert("이관 중 오류가 발생했습니다.");
    }
    setTransferring(false);
  };

  // 통계
  const totalCount = orders.length;
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const transferredCount = orders.filter((o) => o.status === "transferred").length;
  const unpaidCount = orders.filter((o) => o.payment_status === "unpaid").length;
  const reviewCount = orders.filter((o) => o.needs_review).length;

  // 인라인 편집 셀
  const EditableCell = ({ orderId, field, value, placeholder, align }: { orderId: string; field: string; value: string | null; placeholder?: string; align?: string }) => {
    const isEditing = editingCell?.id === orderId && editingCell.field === field;
    return (
      <td className={`px-3 py-2.5 text-xs text-gray-600 cursor-pointer hover:bg-blue-50/50 ${align || ""}`} onClick={() => startEdit(orderId, field, value || "")}>
        {isEditing ? (
          <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => saveInlineEdit(orderId, field, editValue)}
            onKeyDown={(e) => { if (e.key === "Enter") saveInlineEdit(orderId, field, editValue); if (e.key === "Escape") setEditingCell(null); }}
            className="w-full px-1.5 py-0.5 text-xs border border-blue-400 rounded outline-none" />
        ) : ( value || <span className="text-gray-300">{placeholder || "-"}</span> )}
      </td>
    );
  };

  const cellInput = "w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md outline-none focus:border-[#C41E1E] focus:ring-1 focus:ring-[#C41E1E]/20 bg-white transition-colors";

  const getFilteredProducts = useCallback((text: string) => {
    if (!text) return products.slice(0, 20);
    const lower = text.toLowerCase();
    return products.filter((p) => p.product_name.toLowerCase().includes(lower) || p.tp_code.toLowerCase().includes(lower)).slice(0, 20);
  }, [products]);

  return (
    <div className="space-y-6">
      {rawModal && <RawMessageModal raw={rawModal} onClose={() => setRawModal(null)} />}

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">문자주문 관리</h1>
          <p className="text-sm text-gray-500 mt-2">SMS로 접수된 주문을 자동 파싱하고 발주 이관합니다</p>
        </div>
        <button
          onClick={() => setShowInput(!showInput)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className={`w-4 h-4 transition-transform ${showInput ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {showInput ? "입력폼 접기" : "입력폼 열기"}
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "전체 주문", value: totalCount, color: "text-gray-900", iconBg: "bg-gray-100", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
          { label: "접수 대기", value: pendingCount, color: "text-amber-600", iconBg: "bg-amber-50", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
          { label: "이관완료", value: transferredCount, color: "text-teal-600", iconBg: "bg-teal-50", icon: "M13 7l5 5m0 0l-5 5m5-5H6" },
          { label: "미입금", value: unpaidCount, color: "text-red-600", iconBg: "bg-red-50", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
          { label: "확인필요", value: reviewCount, color: "text-purple-600", iconBg: "bg-purple-50", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg ${s.iconBg} flex items-center justify-center flex-shrink-0`}>
              <svg className={`w-5 h-5 ${s.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={s.icon} />
              </svg>
            </div>
            <div>
              <p className="text-[11px] text-gray-500 font-medium">{s.label}</p>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ====== 스프레드시트 신규 입력 ====== */}
      {showInput && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 flex items-center gap-2.5">
            <svg className="w-4 h-4 text-[#C41E1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-semibold text-gray-700">수동 주문 입력</span>
            <span className="text-[10px] text-gray-400">(SMS 자동수신 외 수동 입력 시 사용)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50/80">
                  <th className="w-8 px-3 py-3"></th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 min-w-[200px]">상품명 *</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 min-w-[100px]">옵션</th>
                  <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 w-14">수량</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 min-w-[80px]">주문자</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 min-w-[80px]">수령인 *</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 min-w-[70px]">입금자</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 min-w-[110px]">전화번호</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 min-w-[200px]">주소 검색</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 min-w-[140px]">상세주소</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 w-20">우편번호</th>
                  <th className="w-8 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {newRows.map((row, idx) => (
                  <tr key={row.id} className="border-b border-gray-100 hover:bg-[#FFFBFC] transition-colors">
                    <td className="px-3 py-2 text-center text-[11px] text-gray-400 font-mono">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <AutocompleteInput
                        value={row.product_name}
                        onChange={(v) => updateNewRow(row.id, "product_name", v)}
                        onSelect={(item) => updateNewRow(row.id, "product_name", item.label)}
                        items={getFilteredProducts(row.product_name).map((p) => ({ id: p.id, label: p.product_name, sub: p.tp_code }))}
                        allItems={products.map((p) => ({ id: p.id, label: p.product_name }))}
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
                    <td className="px-2 py-1.5">
                      <input value={row.option_text} onChange={(e) => updateNewRow(row.id, "option_text", e.target.value)} placeholder="옵션" className={cellInput} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min={1} value={row.quantity} onChange={(e) => updateNewRow(row.id, "quantity", e.target.value)} className={`${cellInput} text-center`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={row.orderer_name} onChange={(e) => updateNewRow(row.id, "orderer_name", e.target.value)} placeholder="주문자" className={cellInput} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={row.recipient_name} onChange={(e) => updateNewRow(row.id, "recipient_name", e.target.value)} placeholder="수령인" className={cellInput} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={row.depositor_name} onChange={(e) => updateNewRow(row.id, "depositor_name", e.target.value)} placeholder="입금자" className={cellInput} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={row.recipient_phone} onChange={(e) => updateNewRow(row.id, "recipient_phone", e.target.value)} placeholder="010-0000-0000" className={cellInput} />
                    </td>
                    <td className="px-2 py-1.5">
                      <AddressSearchInput
                        value={row.recipient_address}
                        onChange={(v) => { updateNewRow(row.id, "recipient_address", v); updateNewRow(row.id, "addr_verified", false); }}
                        onSelect={({ zipNo, roadAddr }) => {
                          updateNewRow(row.id, "recipient_address", roadAddr);
                          updateNewRow(row.id, "recipient_zipcode", zipNo);
                          updateNewRow(row.id, "addr_verified", true);
                        }}
                        className={cellInput}
                        addrStatus={row.addr_verified ? "valid" : row.recipient_address ? "invalid" : "unverified"}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={row.address_detail} onChange={(e) => updateNewRow(row.id, "address_detail", e.target.value)} placeholder="상세주소" className={cellInput} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={row.recipient_zipcode} readOnly placeholder="자동" className={`${cellInput} bg-gray-50 text-gray-500`} />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button onClick={() => removeNewRow(row.id)} className="p-1 text-gray-300 hover:text-red-500 rounded hover:bg-red-50 transition-colors" title="행 삭제">
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
          <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <button onClick={addNewRow} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-white transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              행 추가
            </button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">{newRows.filter((r) => r.product_name.trim() && r.recipient_name.trim()).length}건 입력됨</span>
              <button onClick={submitNewRows} disabled={saving} className="px-5 py-2 bg-[#C41E1E] text-white text-xs font-semibold rounded-lg hover:bg-[#A01818] disabled:opacity-50 transition-colors shadow-sm">
                {saving ? "등록 중..." : "주문 등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white">
            <option value="">전체 상태</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white">
            <option value="">입금 전체</option>
            {Object.entries(PAYMENT_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white">
            <option value="">확인 전체</option>
            <option value="true">확인필요</option>
          </select>
          <div className="flex items-center gap-1.5">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg" />
            <span className="text-gray-400 text-xs">~</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg" />
          </div>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="상품명, 수령인, 입금자 검색" className="pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg w-52" />
          </div>
        </div>
      </div>

      {/* 일괄 작업 */}
      {selected.size > 0 && (
        <div className="bg-gradient-to-r from-[#FFF0F5] to-[#FFF5F8] rounded-xl border border-[#C41E1E]/20 p-3 flex items-center gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#C41E1E] text-white text-[11px] font-bold flex items-center justify-center">{selected.size}</div>
            <span className="text-xs font-medium text-[#C41E1E]">건 선택</span>
          </div>
          <div className="flex gap-1.5 ml-auto">
            <button onClick={() => bulkUpdate({ needs_review: false })} className="px-3 py-1.5 text-[11px] font-semibold bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors shadow-sm">확인완료</button>
            <button onClick={() => bulkUpdate({ payment_status: "paid", paid_at: new Date().toISOString() })} className="px-3 py-1.5 text-[11px] font-semibold bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors shadow-sm">입금확인</button>
            <div className="w-px h-6 bg-[#C41E1E]/20 mx-1" />
            <button onClick={transferToOrders} disabled={transferring} className="px-3.5 py-1.5 text-[11px] font-semibold bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818] disabled:opacity-50 transition-colors shadow-sm flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              {transferring ? "이관 중..." : "발주 이관"}
            </button>
            <div className="w-px h-6 bg-[#C41E1E]/20 mx-1" />
            <button onClick={bulkDelete} className="px-3 py-1.5 text-[11px] font-semibold bg-white text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">삭제</button>
          </div>
        </div>
      )}

      {/* ====== 주문 목록 ====== */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th className="w-9 px-3 py-3"><input type="checkbox" checked={orders.length > 0 && selected.size === orders.length} onChange={toggleAll} className="rounded border-gray-300 text-[#C41E1E] focus:ring-[#C41E1E]" /></th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500">주문번호</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500">주문일</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500">상품명</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500">옵션</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500">수량</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500">주문자</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500">수령인</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500">입금자</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500">입금</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500">신뢰도</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500">상태</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500">메모</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-gray-500 w-10">원문</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={14} className="py-20 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-gray-200 border-t-[#C41E1E] rounded-full animate-spin" />
                    <span className="text-sm text-gray-400">불러오는 중...</span>
                  </div>
                </td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={14} className="py-20 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <span className="text-sm text-gray-400">문자주문이 없습니다</span>
                    <span className="text-[11px] text-gray-300">SMS가 수신되면 자동으로 여기에 표시됩니다</span>
                  </div>
                </td></tr>
              ) : (
                orders.map((order) => {
                  const isTransferred = order.status === "transferred";
                  const st = STATUS_MAP[order.status] || STATUS_MAP.pending;
                  const pt = PAYMENT_MAP[order.payment_status] || PAYMENT_MAP.unpaid;
                  const conf = CONFIDENCE_MAP[order.parse_confidence || "low"] || CONFIDENCE_MAP.low;
                  return (
                    <tr key={order.id} className={`border-b border-gray-100 hover:bg-gray-50/50 transition-colors ${isTransferred ? "bg-teal-50/30" : ""} ${order.needs_review ? "bg-purple-50/20" : ""} ${selected.has(order.id) ? "bg-[#FFF8FA]" : ""}`}>
                      <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleOne(order.id)} className="rounded border-gray-300 text-[#C41E1E] focus:ring-[#C41E1E]" /></td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {order.order_number}
                          {isTransferred && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-teal-600 bg-teal-100 px-1.5 py-0.5 rounded-full">
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                              이관
                            </span>
                          )}
                          {order.needs_review && !isTransferred && (
                            <span className="inline-flex items-center text-[9px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full">
                              확인
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 whitespace-nowrap">{order.order_date}</td>
                      <EditableCell orderId={order.id} field="product_name" value={order.product_name} placeholder="상품명 입력" />
                      <EditableCell orderId={order.id} field="option_text" value={order.option_text} placeholder="-" />
                      <td className="px-3 py-2.5 text-center text-xs font-medium">{order.quantity}</td>
                      <EditableCell orderId={order.id} field="orderer_name" value={order.orderer_name} placeholder="-" />
                      <EditableCell orderId={order.id} field="recipient_name" value={order.recipient_name} placeholder="수령인 입력" />
                      <EditableCell orderId={order.id} field="depositor_name" value={order.depositor_name} placeholder="-" />
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => singleUpdate(order.id, order.payment_status === "unpaid" ? { payment_status: "paid", paid_at: new Date().toISOString() } : { payment_status: "unpaid", paid_at: null })}
                          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${pt.color} ${pt.bg}`}>{pt.label}</button>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[10px] font-medium ${conf.color}`}>{conf.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {isTransferred ? (
                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${st.color} ${st.bg}`}>
                            {st.label}
                          </span>
                        ) : (
                          <select value={order.status} onChange={(e) => {
                            singleUpdate(order.id, { status: e.target.value });
                          }} className={`text-[11px] font-medium px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${st.color} ${st.bg}`}>
                            {Object.entries(STATUS_MAP).filter(([k]) => k !== "transferred").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        )}
                      </td>
                      <EditableCell orderId={order.id} field="memo" value={order.memo} placeholder="메모 입력" />
                      <td className="px-3 py-2.5 text-center">
                        {order.sms_raw_messages && (
                          <button
                            onClick={() => setRawModal(order.sms_raw_messages!)}
                            className="p-1 text-gray-400 hover:text-[#C41E1E] rounded hover:bg-[#FFF0F5] transition-colors"
                            title="원본 문자 보기"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                          </button>
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
