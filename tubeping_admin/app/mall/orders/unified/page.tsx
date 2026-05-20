"use client";

import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import * as XLSX from "xlsx";

interface Store { id: string; name: string; mall_id: string; status: string; }
interface Supplier { id: string; name: string; email: string; }

interface Order {
  id: string;
  cafe24_order_id: string;
  cafe24_order_item_code: string;
  cafe24_product_no: number;
  order_date: string;
  product_name: string;
  option_text: string;
  quantity: number;
  product_price: number;
  order_amount: number;
  buyer_name: string;
  buyer_phone: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  shipping_status: string;
  shipping_company: string;
  tracking_number: string;
  cafe24_shipping_synced: boolean;
  supplier_id: string | null;
  purchase_order_id: string | null;
  auto_assign_status: string | null;
  supplier_candidates: { supplier: string; supplierId: string; tpCode: string; productName: string; score: number }[] | null;
  is_sample: boolean;
  sales_channel: string | null;
  memo: string | null;
  stores: { name: string; mall_id: string } | null;
  suppliers: { name: string; email: string } | null;
  warehouse_name: string | null;
  purchase_orders: { id: string; po_number: string; status: string; sent_at: string | null; viewed_at: string | null; completed_at: string | null } | null;
}

/* ── Status helpers ── */
const STATUS_LABEL: Record<string, string> = {
  pending: "입금전",
  ordered: "상품준비중",
  shipping: "배송중",
  delivered: "배송완료",
  cancelled: "취소",
  refunded: "환불완료",
  returned: "반품완료",
  exchanged: "교환완료",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  ordered: "bg-blue-100 text-blue-700",
  shipping: "bg-yellow-100 text-yellow-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
  refunded: "bg-red-50 text-red-600",
  returned: "bg-orange-50 text-orange-600",
  exchanged: "bg-purple-50 text-purple-600",
};

function derivePOStatus(o: Order): { label: string; style: string } {
  if (o.shipping_status === "cancelled") return { label: "", style: "" };
  if (o.tracking_number) return { label: "송장등록", style: "text-green-600" };
  if (o.purchase_order_id && o.purchase_orders) {
    const po = o.purchase_orders;
    if (po.completed_at) return { label: "송장완료", style: "text-green-600" };
    if (po.viewed_at) return { label: "메일열람", style: "text-indigo-600" };
    if (po.sent_at || po.status === "sent") return { label: "메일발송", style: "text-blue-600" };
    return { label: "메일미발송", style: "text-red-500" };
  }
  if (o.supplier_id) return { label: "미발주", style: "text-orange-500" };
  return { label: "", style: "" };
}

const SHIPPING_COMPANIES = ["CJ대한통운", "한진택배", "롯데택배", "우체국택배", "로젠택배", "경동택배", "대신택배"];

const TRACKING_URLS: Record<string, string> = {
  "CJ대한통운": "https://trace.cjlogistics.com/next/tracking.html?wblNo=",
  "한진택배": "https://trace.hanjin.co.kr/tracking?gnbInvcNo=",
  "롯데택배": "https://www.lotteglogis.com/home/reservation/tracking/link498?InvNo=",
  "우체국택배": "https://service.epost.go.kr/trace.RetrieveDomRi498Track.postal?sid1=",
  "로젠택배": "https://www.ilogen.com/web/personal/trace/",
  "경동택배": "https://kdexp.com/newDeliverySearch.kd?barcode=",
  "대신택배": "https://www.ds3211.co.kr/freight/internalFreightSearch.ht?billno=",
};

function getTrackingUrl(company: string, trackingNo: string): string | null {
  if (!company || !trackingNo) return null;
  for (const [name, url] of Object.entries(TRACKING_URLS)) {
    if (company.includes(name) || name.includes(company)) return url + trackingNo;
  }
  return null;
}

function toKST(d: string): Date {
  const dt = new Date(d);
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000);
}
function formatDate(d: string) {
  if (!d) return "";
  const kst = toKST(d);
  return kst.toISOString().slice(0, 10);
}
function formatDateTime(d: string) {
  if (!d) return "";
  const kst = toKST(d);
  return kst.toISOString().slice(0, 16).replace("T", " ");
}
function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function normPhone(s: string) { return (s || "").replace(/[^0-9]/g, ""); }

/* ── OrderRow (memo-ized) ── */
const OrderRow = memo(function OrderRow({
  o, idx, displayedCount, isSelected, toggleSelect, editingField, onStartEdit, saveCellEdit, stores, fetchOrders,
  trackingEdit, onTrackingEdit, onSaveTracking, saving, onOpenCs,
}: {
  o: Order; idx: number; displayedCount: number; isSelected: boolean;
  toggleSelect: (id: string) => void;
  editingField: "channel" | "store" | null;
  onStartEdit: (orderId: string, field: "channel" | "store") => void;
  saveCellEdit: (orderId: string, field: "channel" | "store", value: string) => void;
  stores: Store[];
  fetchOrders: () => void;
  trackingEdit: { company: string; number: string } | undefined;
  onTrackingEdit: (orderId: string, edit: { company: string; number: string } | null) => void;
  onSaveTracking: (orderId: string) => void;
  saving: boolean;
  onOpenCs: (order: Order) => void;
}) {
  const noTrack = !o.tracking_number && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered";
  const noSup = !o.supplier_id;
  const noPO = !o.purchase_order_id && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered";
  const editing = !!trackingEdit;
  return (
    <tr
      className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 cursor-pointer ${
        isSelected ? "bg-blue-50/60" : noPO && noSup ? "bg-red-50/20" : noPO ? "bg-amber-50/20" : ""
      }`}
      onClick={() => toggleSelect(o.id)}
    >
      {/* 1. Checkbox */}
      <td className="px-3 py-2.5">
        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(o.id)} onClick={(e) => e.stopPropagation()} className="rounded" />
      </td>
      {/* 2. No */}
      <td className="px-2 py-2.5 text-xs text-gray-400">{displayedCount - idx}</td>
      {/* 3. 주문번호 */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="text-xs font-medium text-gray-900">{o.cafe24_order_id}</div>
        <div className="text-[11px] text-gray-400">{formatDateTime(o.order_date)}</div>
      </td>
      {/* 4. 상품/옵션 */}
      <td className="px-2 py-2.5 max-w-[220px]">
        <div className="text-sm text-gray-900 truncate">{o.product_name}</div>
        {o.option_text && <div className="text-[11px] text-gray-400 truncate">{o.option_text}</div>}
      </td>
      {/* 5. 주문자/수취인/연락처 */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="text-xs text-gray-700">{o.buyer_name || o.receiver_name || "-"}</div>
        {o.receiver_name && o.buyer_name && o.receiver_name !== o.buyer_name && (
          <div className="text-[11px] text-gray-400">&rarr; {o.receiver_name}</div>
        )}
        <div className="text-[10px] font-mono text-gray-400">{o.receiver_phone || o.buyer_phone || ""}</div>
      </td>
      {/* 6. 배송주소 */}
      <td className="px-2 py-2.5 max-w-[200px]">
        <div className="text-[11px] text-gray-600 truncate" title={o.receiver_address || ""}>{o.receiver_address || <span className="text-gray-300">-</span>}</div>
      </td>
      {/* 7. 판매방식 */}
      <td
        className="px-2 py-2.5 text-xs whitespace-nowrap cursor-pointer hover:bg-gray-100/60"
        onClick={(e) => { e.stopPropagation(); if (editingField !== "channel") onStartEdit(o.id, "channel"); }}
        title="클릭해서 판매방식 수정"
      >
        {editingField === "channel" ? (
          <select
            autoFocus
            defaultValue={o.sales_channel || ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => saveCellEdit(o.id, "channel", e.target.value)}
            onBlur={() => onStartEdit("", "channel")}
            className="text-xs border border-gray-400 rounded px-1 py-0.5 bg-white"
          >
            <option value="">자사몰</option>
            <option value="phone">전화주문</option>
            <option value="group">공구주문</option>
            <option value="sample">샘플</option>
            <option value="etc">기타</option>
          </select>
        ) : (() => {
          if (o.sales_channel === "phone") return <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">전화주문</span>;
          if (o.sales_channel === "group") return <span className="px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 font-medium">공구주문</span>;
          if (o.sales_channel === "sample") return <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">샘플</span>;
          if (o.sales_channel === "etc") return <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-medium">기타</span>;
          if (!o.stores?.name) return <span className="text-gray-300">-</span>;
          return <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">자사몰</span>;
        })()}
      </td>
      {/* 8. 판매사 */}
      <td
        className="px-2 py-2.5 text-xs whitespace-nowrap cursor-pointer hover:bg-gray-100/60"
        onClick={(e) => { e.stopPropagation(); if (editingField !== "store") onStartEdit(o.id, "store"); }}
        title="클릭해서 판매사 수정"
      >
        {editingField === "store" ? (
          <select
            autoFocus
            defaultValue={stores.find((s) => s.name === o.stores?.name)?.id || ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => saveCellEdit(o.id, "store", e.target.value)}
            onBlur={() => onStartEdit("", "store")}
            className="text-xs border border-gray-400 rounded px-1 py-0.5 bg-white max-w-[180px]"
          >
            <option value="" disabled>판매사 선택</option>
            {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        ) : (() => {
          const name = o.stores?.name || "";
          const isPseudo = name === "전화주문" || name === "공구주문";
          if (!name || isPseudo) return <span className="text-gray-400 italic">- (클릭해서 지정)</span>;
          const isManual = o.stores?.mall_id?.startsWith("manual_") || o.stores?.mall_id?.startsWith("excel_");
          return isManual
            ? <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">{name}</span>
            : <span className="text-gray-500">{name}</span>;
        })()}
      </td>
      {/* 9. 공급사/출고지 */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        {o.suppliers?.name ? (
          <div>
            <span className="text-xs text-gray-700">{o.suppliers.name}</span>
            {o.warehouse_name && (
              <div><span className="text-[10px] px-1 py-px rounded bg-blue-50 text-blue-700 font-medium">{o.warehouse_name}</span></div>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-red-400 font-medium">미배정</span>
        )}
      </td>
      {/* 10. 수량 */}
      <td className="px-2 py-2.5 text-right text-gray-700">{o.quantity}</td>
      {/* 11. 금액 */}
      <td className="px-2 py-2.5 text-right text-gray-700 whitespace-nowrap">{o.order_amount.toLocaleString()}</td>
      {/* 12. 입금 */}
      <td className="px-2 py-2.5 text-center">
        {(() => {
          const isPaid = o.shipping_status !== "pending" && o.shipping_status !== "cancelled";
          const isCancelled = o.shipping_status === "cancelled";
          const isPhone = o.sales_channel === "phone" || o.stores?.name === "전화주문";
          if (isCancelled) return <span className="text-[10px] text-gray-300">-</span>;
          return (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const newStatus = isPaid ? "pending" : "ordered";
                const label = isPaid ? "입금전으로 되돌림" : "입금확인 처리";
                const extra = isPhone && !isPaid ? "\n\n(전화주문 -- 계좌이체 입금 확인 후 진행)" : "";
                if (!confirm(`${label}하시겠습니까?${extra}`)) return;
                await fetch("/admin/api/orders", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ids: [o.id], updates: { shipping_status: newStatus } }),
                });
                fetchOrders();
              }}
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${
                isPaid
                  ? "bg-green-100 text-green-700 border-green-300 hover:bg-green-200"
                  : isPhone
                    ? "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100"
                    : "bg-red-50 text-red-600 border-red-300 hover:bg-red-100"
              }`}
              title={isPhone
                ? (isPaid ? "전화주문(계좌이체) -- 클릭 시 입금전으로 되돌림" : "전화주문(계좌이체) -- 입금 확인 후 클릭")
                : (isPaid ? "클릭하면 입금전으로 되돌림" : "클릭하면 입금확인 처리")}
            >
              {isPaid ? "완료" : isPhone ? "계좌이체" : "입금전"}
            </button>
          );
        })()}
      </td>
      {/* 13. 송장 (inline editable) */}
      <td className="px-2 py-2.5 text-xs" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <div className="flex flex-col gap-1 min-w-[150px]">
            <select value={trackingEdit!.company} onChange={(e) => onTrackingEdit(o.id, { ...trackingEdit!, company: e.target.value })}
              className="border border-gray-300 rounded px-1 py-0.5 text-xs">
              {SHIPPING_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="text" value={trackingEdit!.number} onChange={(e) => onTrackingEdit(o.id, { ...trackingEdit!, number: e.target.value })}
              placeholder="송장번호" className="border border-gray-300 rounded px-1 py-0.5 text-xs font-mono" autoFocus />
            <div className="flex gap-1">
              <button disabled={saving} onClick={() => onSaveTracking(o.id)} className="flex-1 bg-gray-900 text-white text-[10px] py-0.5 rounded hover:bg-black cursor-pointer disabled:opacity-50">저장</button>
              <button onClick={() => onTrackingEdit(o.id, null)} className="flex-1 bg-white border border-gray-300 text-[10px] py-0.5 rounded hover:bg-gray-50 cursor-pointer">취소</button>
            </div>
          </div>
        ) : o.tracking_number ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              {(() => {
                const url = getTrackingUrl(o.shipping_company, o.tracking_number);
                return url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline font-mono text-xs"
                    title="배송추적 열기">
                    {o.tracking_number}
                  </a>
                ) : (
                  <span className="font-mono text-gray-700 text-xs">{o.tracking_number}</span>
                );
              })()}
              <button onClick={() => onTrackingEdit(o.id, { company: o.shipping_company || "CJ대한통운", number: o.tracking_number })}
                className="text-gray-400 hover:text-gray-600 cursor-pointer" title="수정">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
            </div>
            <span className="text-[10px] text-gray-400">{o.shipping_company}</span>
            {!o.cafe24_shipping_synced && <span className="text-[10px] text-orange-500">미연동</span>}
          </div>
        ) : noTrack ? (
          <button onClick={() => onTrackingEdit(o.id, { company: "CJ대한통운", number: "" })}
            className="text-[11px] text-blue-600 hover:underline cursor-pointer">+ 송장 입력</button>
        ) : (
          <span className="text-gray-300">-</span>
        )}
      </td>
      {/* 14. 발주상태 */}
      <td className="px-2 py-2.5 text-center">
        {(() => {
          const ps = derivePOStatus(o);
          return ps.label ? (
            <span className={`text-[11px] font-medium ${ps.style}`}>{ps.label}</span>
          ) : (
            <span className="text-gray-300">-</span>
          );
        })()}
      </td>
      {/* 15. 배송상태 */}
      <td className="px-2 py-2.5 text-center">
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLE[o.shipping_status] || STATUS_STYLE.pending}`}>
          {STATUS_LABEL[o.shipping_status] || o.shipping_status}
        </span>
      </td>
      {/* 16. CS */}
      <td className="px-2 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
        {o.shipping_status !== "cancelled" ? (
          <button onClick={() => onOpenCs(o)} className="text-[11px] px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer">
            CS
          </button>
        ) : (
          <span className="text-gray-300">-</span>
        )}
      </td>
      {/* 17. 주문일 */}
      <td className="px-3 py-2.5 text-xs text-gray-400 text-right whitespace-nowrap">{formatDate(o.order_date)}</td>
    </tr>
  );
});

/* ═══════════════════════════════════════════════════
   Unified Orders Page
   ═══════════════════════════════════════════════════ */

export default function UnifiedOrdersPage() {
  const pageSize = 50;

  const [rawOrders, setRawOrders] = useState<Order[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const sampleCount = useMemo(() => rawOrders.filter((o) => o.sales_channel === "sample").length, [rawOrders]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrResults, setOcrResults] = useState<{ product_name: string; option_text?: string; quantity: number; unit_price?: number; order_amount?: number; buyer_name?: string; buyer_phone?: string; receiver_name?: string; receiver_phone?: string; receiver_address?: string; receiver_zipcode?: string; memo?: string }[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ orderId: string; field: "channel" | "store" } | null>(null);
  const onStartEdit = useCallback((orderId: string, field: "channel" | "store") => {
    setEditingCell(orderId ? { orderId, field } : null);
  }, []);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [dateTo, setDateTo] = useState(today());
  const [searchKeyword, setSearchKeyword] = useState("");

  const [filterNoTracking, setFilterNoTracking] = useState(false);
  const [filterNoSupplier, setFilterNoSupplier] = useState(false);
  const [colFilterOrderNo, setColFilterOrderNo] = useState("");
  const [colFilterProduct, setColFilterProduct] = useState("");
  const [colFilterCustomer, setColFilterCustomer] = useState("");
  const [colFilterAddress, setColFilterAddress] = useState("");
  const [colFilterChannel, setColFilterChannel] = useState("");
  const [colFilterPayment, setColFilterPayment] = useState("");
  const [colFilterPOStatus, setColFilterPOStatus] = useState("");
  const [colFilterQty, setColFilterQty] = useState("");
  const [colFilterAmount, setColFilterAmount] = useState("");
  const [colFilterTracking, setColFilterTracking] = useState("");
  const [poTab, setPoTab] = useState<"all" | "no_po" | "has_po">("all");

  // Tracking inline edit
  const [trackingEdit, setTrackingEdit] = useState<Record<string, { company: string; number: string }>>({});

  // CS modal
  const [csModalOrder, setCsModalOrder] = useState<Order | null>(null);
  const [csAction, setCsAction] = useState<"refunded" | "returned" | "exchanged">("refunded");
  const [csNote, setCsNote] = useState("");

  // Drag & drop
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const patchOrder = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], updates }),
    });
    return res.ok;
  };

  const saveTracking = useCallback(async (id: string) => {
    const edit = trackingEdit[id];
    if (!edit || !edit.number.trim()) return;
    setSaving(true);
    await patchOrder(id, { tracking_number: edit.number.trim(), shipping_company: edit.company || "CJ대한통운", shipping_status: "shipping" });
    setTrackingEdit((p) => { const n = { ...p }; delete n[id]; return n; });
    setSaving(false);
    fetchOrders();
  }, [trackingEdit, fetchOrders]);

  const handleTrackingEdit = useCallback((orderId: string, edit: { company: string; number: string } | null) => {
    if (edit === null) {
      setTrackingEdit((p) => { const n = { ...p }; delete n[orderId]; return n; });
    } else {
      setTrackingEdit((p) => ({ ...p, [orderId]: edit }));
    }
  }, []);

  const openCs = useCallback((o: Order) => {
    setCsModalOrder(o);
    setCsAction("refunded");
    setCsNote("");
  }, []);

  const submitCs = async () => {
    if (!csModalOrder) return;
    setSaving(true);
    const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actionLabel = csAction === "refunded" ? "환불" : csAction === "returned" ? "반품" : "교환";
    const entry = `[${ts}] ${actionLabel} 처리: ${csNote || "사유 미기재"}`;
    const newMemo = csModalOrder.memo ? `${csModalOrder.memo}\n${entry}` : entry;
    await patchOrder(csModalOrder.id, { shipping_status: csAction, memo: newMemo });
    setSaving(false);
    setCsModalOrder(null);
    fetchOrders();
  };

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set("status", filterStatus);
    if (filterStore) params.set("store_id", filterStore);
    if (filterSupplier && filterSupplier !== "__none__") params.set("supplier_id", filterSupplier);
    if (dateFrom) params.set("start_date", dateFrom);
    if (dateTo) params.set("end_date", dateTo);
    params.set("limit", "500");

    const res = await fetch(`/admin/api/orders?${params}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setRawOrders(data.orders || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [filterStatus, filterStore, filterSupplier, dateFrom, dateTo]);

  // File import
  const handleImportFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext || "")) {
      alert("csv, xlsx, xls 파일만 업로드 가능합니다.");
      return;
    }
    const sel = document.getElementById("import-store") as HTMLSelectElement;
    if (!sel.value) {
      alert("판매사를 먼저 선택해주세요");
      return;
    }
    const sampleEl = document.getElementById("import-is-sample") as HTMLInputElement;
    const phoneEl = document.getElementById("import-is-phone") as HTMLInputElement;
    const groupEl = document.getElementById("import-is-group") as HTMLInputElement;
    const etcEl = document.getElementById("import-is-etc") as HTMLInputElement;
    const fd = new FormData();
    fd.append("file", file);
    if (sel.value.startsWith("id:")) fd.append("store_id", sel.value.slice(3));
    else fd.append("store_name", sel.value.slice(5));
    if (sampleEl?.checked) fd.append("sales_channel", "sample");
    else if (phoneEl?.checked) fd.append("sales_channel", "phone");
    else if (groupEl?.checked) fd.append("sales_channel", "group");
    else if (etcEl?.checked) fd.append("sales_channel", "etc");
    const res = await fetch("/admin/api/orders/import", { method: "POST", body: fd });
    const data = await res.json();
    if (res.ok) {
      const parts = [`${data.imported}건 신규등록`];
      if (data.overwritten) parts.push(`${data.overwritten}건 덮어쓰기 갱신`);
      let msg = parts.join(" · ");
      const mc = data.matched_columns || {};
      const critical = ["receiver_name", "receiver_phone", "receiver_address"];
      const missing = critical.filter((k) => !mc[k]);
      if (missing.length > 0) {
        msg += `\n\n주의: 수령인 정보 일부가 매칭 안됨: ${missing.join(", ")}\n헤더명을 확인해주세요.\n(인식 못한 헤더: ${(data.unmatched_headers || []).join(", ") || "없음"})`;
      }
      msg += "\n\n공급사 매칭은 '매핑 검증' 페이지에서 진행하세요.";
      alert(msg);
      fetchOrders();
      if (phoneEl) phoneEl.checked = false;
      if (groupEl) groupEl.checked = false;
      if (sampleEl) sampleEl.checked = false;
      if (etcEl) etcEl.checked = false;
      sel.value = "";
    } else alert(`오류: ${data.error}`);
  }, [fetchOrders]);

  // Image OCR
  const handleImageOCR = useCallback(async (file: File) => {
    setOcrProcessing(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/admin/api/orders/ocr-import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { alert(`OCR 실패: ${data.error}`); return; }
      if (!data.orders?.length) { alert("이미지에서 주문 데이터를 찾지 못했습니다."); return; }
      setOcrResults(data.orders);
    } catch (e) {
      alert(`OCR 오류: ${(e as Error).message}`);
    } finally {
      setOcrProcessing(false);
    }
  }, []);

  const handleOcrConfirm = useCallback(async () => {
    if (!ocrResults?.length) return;
    let success = 0;
    const errors: string[] = [];
    for (const o of ocrResults) {
      const res = await fetch("/admin/api/orders/phone-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: o.product_name,
          option_text: o.option_text || "",
          quantity: o.quantity || 1,
          unit_price: o.unit_price || o.order_amount || 0,
          buyer_name: o.buyer_name || o.receiver_name || "",
          buyer_phone: o.buyer_phone || o.receiver_phone || "",
          receiver_name: o.receiver_name || o.buyer_name || "미입력",
          receiver_phone: o.receiver_phone || o.buyer_phone || "미입력",
          receiver_address: o.receiver_address || "미입력",
          receiver_zipcode: o.receiver_zipcode || "",
          memo: o.memo || "스크린샷 OCR 등록",
        }),
      });
      if (res.ok) success++;
      else {
        const d = await res.json();
        errors.push(`${o.product_name}: ${d.error}`);
      }
    }
    alert(`${success}건 등록 완료${errors.length ? `\n\n실패 ${errors.length}건:\n${errors.slice(0, 5).join("\n")}` : ""}`);
    setOcrResults(null);
    fetchOrders();
  }, [ocrResults, fetchOrders]);

  const handleFileDrop = useCallback(async (file: File) => {
    const ext = file.name?.split(".").pop()?.toLowerCase() || "";
    const isSpreadsheet = ["csv", "xlsx", "xls"].includes(ext) || file.type === "text/csv" || file.type.includes("spreadsheet") || file.type.includes("excel");
    if (isSpreadsheet) {
      await handleImportFile(file);
    } else {
      await handleImageOCR(file);
    }
  }, [handleImageOCR, handleImportFile]);

  // Client-side filter
  const orders = useMemo(() => {
    const kw = searchKeyword?.toLowerCase();
    const kwDigits = normPhone(searchKeyword);
    const kOrderNo = colFilterOrderNo?.toLowerCase();
    const kProduct = colFilterProduct?.toLowerCase();
    const kCustomer = colFilterCustomer?.toLowerCase();
    const kAddress = colFilterAddress?.toLowerCase();
    return rawOrders.filter((o) => {
      if (filterNoTracking && (o.tracking_number || o.shipping_status === "cancelled" || o.shipping_status === "delivered")) return false;
      if ((filterNoSupplier || filterSupplier === "__none__") && o.supplier_id) return false;
      if (poTab === "no_po" && (!o.supplier_id || o.purchase_order_id || o.tracking_number || o.shipping_status === "cancelled" || o.shipping_status === "delivered" || o.shipping_status === "pending")) return false;
      if (poTab === "has_po" && !o.purchase_order_id) return false;
      if (kw) {
        const phoneMatch = kwDigits.length >= 4 && (
          normPhone(o.buyer_phone).includes(kwDigits) ||
          normPhone(o.receiver_phone).includes(kwDigits)
        );
        if (!(phoneMatch || o.product_name?.toLowerCase().includes(kw) || o.cafe24_order_id?.toLowerCase().includes(kw) || o.buyer_name?.toLowerCase().includes(kw) || o.receiver_name?.toLowerCase().includes(kw) || o.tracking_number?.toLowerCase().includes(kw))) return false;
      }
      if (kOrderNo && !o.cafe24_order_id?.toLowerCase().includes(kOrderNo)) return false;
      if (kProduct && !(o.product_name?.toLowerCase().includes(kProduct) || o.option_text?.toLowerCase().includes(kProduct))) return false;
      if (kCustomer) {
        const phoneDigits = normPhone(colFilterCustomer);
        const phoneMatch = phoneDigits.length >= 4 && (
          normPhone(o.buyer_phone).includes(phoneDigits) ||
          normPhone(o.receiver_phone).includes(phoneDigits)
        );
        if (!(o.buyer_name?.toLowerCase().includes(kCustomer) || o.receiver_name?.toLowerCase().includes(kCustomer) || phoneMatch)) return false;
      }
      if (kAddress && !o.receiver_address?.toLowerCase().includes(kAddress)) return false;
      if (colFilterChannel === "phone" && o.sales_channel !== "phone") return false;
      if (colFilterChannel === "group" && o.sales_channel !== "group") return false;
      if (colFilterChannel === "sample" && o.sales_channel !== "sample") return false;
      if (colFilterChannel === "etc" && o.sales_channel !== "etc") return false;
      if (colFilterChannel === "domestic" && (o.sales_channel || !o.stores?.name)) return false;
      if (colFilterPayment === "paid" && (o.shipping_status === "pending" || o.shipping_status === "cancelled")) return false;
      if (colFilterPayment === "unpaid" && o.shipping_status !== "pending") return false;
      if (colFilterQty === "1" && o.quantity !== 1) return false;
      if (colFilterQty === "2+" && o.quantity < 2) return false;
      if (colFilterAmount === "under10k" && o.order_amount >= 10000) return false;
      if (colFilterAmount === "10k_50k" && (o.order_amount < 10000 || o.order_amount >= 50000)) return false;
      if (colFilterAmount === "50k_100k" && (o.order_amount < 50000 || o.order_amount >= 100000)) return false;
      if (colFilterAmount === "over100k" && o.order_amount < 100000) return false;
      if (colFilterTracking === "missing" && (o.tracking_number || o.shipping_status === "cancelled" || o.shipping_status === "delivered")) return false;
      if (colFilterPOStatus) {
        const ps = derivePOStatus(o);
        if (colFilterPOStatus === "no_po" && ps.label !== "미발주") return false;
        if (colFilterPOStatus === "mail_not_sent" && ps.label !== "메일미발송") return false;
        if (colFilterPOStatus === "mail_sent" && ps.label !== "메일발송") return false;
        if (colFilterPOStatus === "mail_read" && ps.label !== "메일열람") return false;
        if (colFilterPOStatus === "tracking" && ps.label !== "송장등록" && ps.label !== "송장완료") return false;
      }
      return true;
    });
  }, [rawOrders, filterSupplier, filterNoTracking, filterNoSupplier, poTab, searchKeyword, colFilterOrderNo, colFilterProduct, colFilterCustomer, colFilterAddress, colFilterChannel, colFilterPayment, colFilterPOStatus, colFilterQty, colFilterAmount, colFilterTracking]);

  // Reset page on filter change
  useEffect(() => { setPage(0); }, [rawOrders, filterSupplier, filterNoTracking, filterNoSupplier, poTab, searchKeyword, colFilterOrderNo, colFilterProduct, colFilterCustomer, colFilterAddress, colFilterChannel, colFilterPayment, colFilterPOStatus, colFilterQty, colFilterAmount, colFilterTracking]);

  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const pagedOrders = useMemo(() => orders.slice(page * pageSize, (page + 1) * pageSize), [orders, page, pageSize]);

  const PSEUDO_STORES = ["전화주문", "공구주문", "엑셀등록", "수기주문"];
  const filteredStores = useMemo(() => stores.filter((s) => !PSEUDO_STORES.includes(s.name)), [stores]);

  const fetchStores = async () => { const r = await fetch("/admin/api/stores"); const d = await r.json(); setStores(d.stores || []); };
  const fetchSuppliers = async () => { const r = await fetch("/admin/api/suppliers?status=active"); const d = await r.json(); setSuppliers(d.suppliers || []); };

  useEffect(() => { fetchOrders(); fetchStores(); fetchSuppliers(); }, [fetchOrders]);

  // Clipboard paste
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) handleImageOCR(file);
          return;
        }
      }

      const text = e.clipboardData?.getData("text/plain");
      if (text && text.includes("\t")) {
        e.preventDefault();
        const csvContent = text.split("\n").map((line) =>
          line.split("\t").map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
        ).join("\n");
        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
        const file = new File([blob], "clipboard-paste.csv", { type: "text/csv" });
        handleImportFile(file);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleImageOCR, handleImportFile]);

  // Cafe24 sync
  const handleSync = async () => {
    setSyncing(true);
    await fetch(`/admin/api/cafe24/orders?start_date=${dateFrom}&end_date=${dateTo}`);
    await fetchOrders();
    setSyncing(false);
  };

  const handleShipmentSync = async () => {
    setSyncing(true);
    await fetch("/admin/api/cafe24/shipments", { method: "POST", body: "{}" });
    await fetchOrders();
    setSyncing(false);
  };

  // Bulk ops
  const handleAssignSupplier = async (supplierId: string) => {
    if (selected.size === 0) return;
    await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), updates: { supplier_id: supplierId } }),
    });
    setSelected(new Set());
    fetchOrders();
  };

  const handleBulkPO = async () => {
    const untrackedOrders = orders.filter(
      (o) => !o.tracking_number && o.supplier_id && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered" && !o.purchase_order_id
    );
    if (untrackedOrders.length === 0) { alert("발주 대상 없음 (공급사 배정 + 미발주 건이 없습니다)"); return; }
    if (!confirm(`${untrackedOrders.length}건 일괄 발주를 생성합니다.\n(창고발주 상품은 자동으로 창고로 라우팅됩니다)\n\n진행하시겠습니까?`)) return;

    const res = await fetch("/admin/api/purchase-orders/bulk-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: untrackedOrders.map(o => o.id) }),
    });
    const data = await res.json();
    if (!res.ok) { alert(`발주 실패: ${data.error || res.status}`); return; }
    const lines = (data.results || []).map((r: { supplier_name: string; po_number?: string; order_count: number; is_warehouse: boolean; email_sent: boolean; error?: string }) => {
      const tag = r.is_warehouse ? "[창고] " : "";
      const status = r.email_sent ? "v" : "x";
      const err = r.error ? ` (${r.error})` : "";
      return `${status} ${tag}${r.supplier_name}: ${r.po_number || "?"} (${r.order_count}건)${err}`;
    });
    let msg = `일괄 발주 결과: PO ${data.created_count}건 생성, 메일 ${data.email_success}건 발송\n\n` + lines.join("\n");
    if (data.skipped?.length) msg += `\n\n건너뜀 ${data.skipped.length}건`;
    alert(msg);
    fetchOrders();
  };

  const toggleSelect = useCallback((id: string) => { setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }, []);
  const toggleAll = () => {
    const pageIds = pagedOrders.map((o) => o.id);
    const allPageSelected = pageIds.every((id) => selected.has(id));
    if (allPageSelected) {
      setSelected((prev) => { const next = new Set(prev); pageIds.forEach((id) => next.delete(id)); return next; });
    } else {
      setSelected((prev) => { const next = new Set(prev); pageIds.forEach((id) => next.add(id)); return next; });
    }
  };

  const saveCellEdit = useCallback(async (orderId: string, field: "channel" | "store", value: string) => {
    const updates: Record<string, string | null> = {};
    if (field === "channel") {
      updates.sales_channel = value === "" ? null : value;
    } else {
      updates.store_id = value;
    }
    const res = await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [orderId], updates }),
    });
    setEditingCell(null);
    if (res.ok) { fetchOrders(); return; }
    const data = await res.json();
    const errMsg = data.error || `${res.status}`;
    const isDup = errMsg.toLowerCase().includes("duplicate") || errMsg.toLowerCase().includes("unique");
    if (isDup && field === "store") {
      alert("수정 실패: 대상 판매사에 이미 같은 주문번호가 존재합니다.\n(중복 임포트가 있어 같은 store_id로 합칠 수 없습니다)");
    } else {
      alert(`수정 실패: ${errMsg}`);
    }
  }, [fetchOrders]);

  const bulkUpdateChannel = async (value: string) => {
    if (selected.size === 0) return;
    const channelLabel = value === "" ? "자사몰" : value === "phone" ? "전화주문" : value === "group" ? "공구주문" : value === "etc" ? "기타" : "샘플";
    if (!confirm(`선택한 ${selected.size}건의 판매방식을 '${channelLabel}'(으)로 일괄 변경합니다. 계속할까요?`)) return;
    const res = await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), updates: { sales_channel: value === "" ? null : value } }),
    });
    const data = await res.json();
    if (res.ok) {
      alert(`${data.updated || selected.size}건 변경 완료`);
      setSelected(new Set());
      fetchOrders();
    } else {
      alert(`변경 실패: ${data.error || res.status}`);
    }
  };

  const bulkUpdateStore = async (storeId: string) => {
    if (selected.size === 0) return;
    const storeName = stores.find((s) => s.id === storeId)?.name || "?";
    if (!confirm(`선택한 ${selected.size}건의 판매사를 '${storeName}'(으)로 일괄 변경합니다. 계속할까요?`)) return;
    const ids = Array.from(selected);
    const res = await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, updates: { store_id: storeId } }),
    });
    const data = await res.json();
    if (res.ok) {
      alert(`${data.updated || ids.length}건 변경 완료`);
      setSelected(new Set());
      fetchOrders();
      return;
    }
    const isDup = (data.error || "").toLowerCase().includes("duplicate") || (data.error || "").toLowerCase().includes("unique");
    if (!isDup) {
      alert(`변경 실패: ${data.error || res.status}`);
      return;
    }
    if (!confirm(`일괄 변경 실패: 일부 주문이 대상 판매사에 이미 같은 주문번호로 존재합니다.\n\n충돌 없는 건만 개별 변경할까요?`)) return;
    let success = 0;
    const failedList: string[] = [];
    for (const id of ids) {
      const r = await fetch("/admin/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], updates: { store_id: storeId } }),
      });
      if (r.ok) success++;
      else {
        const o = orders.find((x) => x.id === id);
        failedList.push(o?.cafe24_order_id || id.slice(0, 8));
      }
    }
    alert(
      `결과: ${success}건 성공 / ${failedList.length}건 실패 (충돌)\n\n` +
      (failedList.length > 0 ? `실패 주문번호:\n${failedList.slice(0, 15).join(", ")}${failedList.length > 15 ? " ..." : ""}` : "")
    );
    setSelected(new Set());
    fetchOrders();
  };

  const stats = useMemo(() => {
    let pending = 0, noTracking = 0, noSupplier = 0, noPO = 0, unsynced = 0, totalQty = 0, totalAmount = 0;
    const notActive = (s: string) => s === "cancelled" || s === "delivered";
    for (const o of orders) {
      totalQty += o.quantity;
      totalAmount += o.order_amount;
      if (o.shipping_status === "pending") pending++;
      if (!o.tracking_number && !notActive(o.shipping_status)) noTracking++;
      if (!o.supplier_id && !notActive(o.shipping_status)) noSupplier++;
      if (!o.purchase_order_id && !o.tracking_number && o.supplier_id && !notActive(o.shipping_status) && o.shipping_status !== "pending" && o.sales_channel !== "sample") noPO++;
      if (o.tracking_number && !o.cafe24_shipping_synced) unsynced++;
    }
    return { total, displayed: orders.length, pending, noTracking, noSupplier, noPO, unsynced, totalQty, totalAmount, sample: sampleCount };
  }, [orders, total, sampleCount]);

  const handleReset = () => {
    const d = new Date();
    setFilterStatus(""); setFilterStore(""); setFilterSupplier(""); setFilterNoTracking(false); setFilterNoSupplier(false);
    setDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`); setDateTo(today());
    setSearchKeyword(""); setPoTab("all");
    setColFilterOrderNo(""); setColFilterProduct(""); setColFilterCustomer(""); setColFilterAddress("");
    setColFilterChannel(""); setColFilterPayment(""); setColFilterPOStatus("");
    setColFilterQty(""); setColFilterAmount(""); setColFilterTracking("");
  };

  // Excel download
  const handleExcelDownload = () => {
    if (orders.length === 0) { alert("다운로드할 주문이 없습니다."); return; }
    const rows = orders.map((o) => ({
      "주문일": formatDate(o.order_date),
      "판매처": o.stores?.name || "",
      "주문번호": o.cafe24_order_id,
      "상품주문고유번호": o.cafe24_order_item_code,
      "상품명": o.product_name,
      "옵션": o.option_text || "",
      "수량": o.quantity,
      "구매자": o.buyer_name,
      "구매자연락처": o.buyer_phone || "",
      "수령인": o.receiver_name,
      "수령인연락처": o.receiver_phone || "",
      "배송지": o.receiver_address || "",
      "배송메시지": o.memo || "",
      "공급사": o.suppliers?.name || "",
      "상태": STATUS_LABEL[o.shipping_status] || o.shipping_status,
      "택배사": o.shipping_company || "",
      "송장번호": o.tracking_number || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "주문조회");
    const storeName = stores.find((s) => s.id === filterStore)?.name || "전체";
    XLSX.writeFile(wb, `주문조회_${storeName}_${dateFrom}~${dateTo}.xlsx`);
  };

  /* ═══════════════════════════ RENDER ═══════════════════════════ */

  return (
    <div className="p-6 relative"
      onDragEnter={(e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounterRef.current++;
        if (dragCounterRef.current === 1) setIsDragging(true);
      }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragLeave={(e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setIsDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) await handleFileDrop(file);
      }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-50/80 border-2 border-dashed border-blue-400 rounded-xl pointer-events-none">
          <div className="text-center">
            <svg className="mx-auto mb-2 w-12 h-12 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-lg font-semibold text-blue-700">파일을 여기에 놓으세요</p>
            <p className="text-sm text-blue-500 mt-1">{"엑셀/CSV → 주문등록 | 이미지/PDF/한글/워드 → AI 자동 인식"}</p>
          </div>
        </div>
      )}

      {/* OCR processing overlay */}
      {ocrProcessing && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 rounded-xl">
          <div className="text-center">
            <div className="animate-spin mx-auto mb-3 w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-lg font-semibold text-gray-700">이미지 분석 중...</p>
            <p className="text-sm text-gray-500 mt-1">Gemini AI가 주문 데이터를 인식하고 있습니다</p>
          </div>
        </div>
      )}

      {/* OCR result modal */}
      {ocrResults && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[900px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-900">스크린샷 OCR 결과</h2>
                <p className="text-sm text-gray-500">{ocrResults.length}건 인식됨 -- 확인 후 전화주문으로 등록됩니다</p>
              </div>
              <button onClick={() => setOcrResults(null)} className="text-gray-400 hover:text-gray-600 text-2xl cursor-pointer">x</button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left py-2 px-2">상품명</th>
                    <th className="text-left py-2 px-2">옵션</th>
                    <th className="text-right py-2 px-2">수량</th>
                    <th className="text-right py-2 px-2">단가</th>
                    <th className="text-left py-2 px-2">주문자</th>
                    <th className="text-left py-2 px-2">수령인</th>
                    <th className="text-left py-2 px-2">연락처</th>
                    <th className="text-left py-2 px-2">주소</th>
                    <th className="text-center py-2 px-2">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {ocrResults.map((o, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2 px-2">
                        <input className="w-full text-sm border border-gray-200 rounded px-2 py-1" value={o.product_name}
                          onChange={(e) => setOcrResults((prev) => prev!.map((r, j) => j === i ? { ...r, product_name: e.target.value } : r))} />
                      </td>
                      <td className="py-2 px-2">
                        <input className="w-full text-sm border border-gray-200 rounded px-2 py-1" value={o.option_text || ""}
                          onChange={(e) => setOcrResults((prev) => prev!.map((r, j) => j === i ? { ...r, option_text: e.target.value } : r))} />
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" className="w-16 text-sm border border-gray-200 rounded px-2 py-1 text-right" value={o.quantity}
                          onChange={(e) => setOcrResults((prev) => prev!.map((r, j) => j === i ? { ...r, quantity: Number(e.target.value) } : r))} />
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" className="w-20 text-sm border border-gray-200 rounded px-2 py-1 text-right" value={o.unit_price || 0}
                          onChange={(e) => setOcrResults((prev) => prev!.map((r, j) => j === i ? { ...r, unit_price: Number(e.target.value) } : r))} />
                      </td>
                      <td className="py-2 px-2">
                        <input className="w-20 text-sm border border-gray-200 rounded px-2 py-1" value={o.buyer_name || ""}
                          onChange={(e) => setOcrResults((prev) => prev!.map((r, j) => j === i ? { ...r, buyer_name: e.target.value } : r))} />
                      </td>
                      <td className="py-2 px-2">
                        <input className="w-20 text-sm border border-gray-200 rounded px-2 py-1" value={o.receiver_name || ""}
                          onChange={(e) => setOcrResults((prev) => prev!.map((r, j) => j === i ? { ...r, receiver_name: e.target.value } : r))} />
                      </td>
                      <td className="py-2 px-2">
                        <input className="w-28 text-sm border border-gray-200 rounded px-2 py-1" value={o.receiver_phone || ""}
                          onChange={(e) => setOcrResults((prev) => prev!.map((r, j) => j === i ? { ...r, receiver_phone: e.target.value } : r))} />
                      </td>
                      <td className="py-2 px-2">
                        <input className="w-40 text-sm border border-gray-200 rounded px-2 py-1" value={o.receiver_address || ""}
                          onChange={(e) => setOcrResults((prev) => prev!.map((r, j) => j === i ? { ...r, receiver_address: e.target.value } : r))} />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button onClick={() => setOcrResults((prev) => prev!.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-600 cursor-pointer text-lg">x</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
              <p className="text-xs text-gray-400">인식 결과를 수정한 후 등록해 주세요. Ctrl+V로 스크린샷 붙여넣기도 가능합니다.</p>
              <div className="flex gap-2">
                <button onClick={() => setOcrResults(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
                <button onClick={handleOcrConfirm} className="px-4 py-2 text-sm bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818] cursor-pointer">
                  전화주문으로 {ocrResults.length}건 등록
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">주문수집 및 조회</h1>
          <p className="text-xs text-gray-500 mt-1">주문 수집 / 발주 / 송장 연동 / CS 처리 -- 통합 관리</p>
        </div>
        <div className="text-sm text-gray-500">
          전체 <span className="font-bold text-gray-900">{stats.total}</span>건
          {stats.displayed !== stats.total && <> / 필터 <span className="font-bold text-blue-600">{stats.displayed}</span>건</>}
        </div>
      </div>

      {/* Filter Area */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="grid grid-cols-6 gap-3 mb-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">판매사</label>
            <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option value="">전체</option>
              {stores.filter((s) => s.status === "active").map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">공급사</label>
            <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option value="">전체</option>
              <option value="__none__">미배정</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">배송상태</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option value="">전체</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">시작일</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">종료일</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">빠른선택</label>
            <div className="flex gap-1 flex-wrap">
              {[
                { label: "이번달", from: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })(), to: today() },
                { label: "오늘", from: today(), to: today() },
                { label: "7일", from: daysAgo(7), to: today() },
                { label: "15일", from: daysAgo(15), to: today() },
                { label: "30일", from: daysAgo(30), to: today() },
                { label: "60일", from: daysAgo(60), to: today() },
              ].map((p) => (
                <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
                  className={`text-xs px-2 py-1 rounded border cursor-pointer ${dateFrom === p.from ? "bg-[#C41E1E] text-white border-[#C41E1E]" : "border-gray-300 hover:bg-gray-50"}`}
                >{p.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <input
            value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-64"
            placeholder="상품명, 주문번호, 주문자, 연락처, 송장번호"
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={filterNoTracking} onChange={(e) => setFilterNoTracking(e.target.checked)} className="rounded" />
            송장 미입력
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={filterNoSupplier} onChange={(e) => setFilterNoSupplier(e.target.checked)} className="rounded" />
            공급사 미배정
          </label>
          <div className="ml-auto flex gap-2">
            <button onClick={() => fetchOrders()} className="px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 cursor-pointer">검색</button>
            <button onClick={handleReset} className="px-3 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">초기화</button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
        {[
          { label: "주문수량", value: `${stats.totalQty}개` },
          { label: "주문금액", value: `${stats.totalAmount.toLocaleString()}원` },
          { label: "처리대기", value: `${stats.pending}건`, hl: stats.pending > 0 },
          { label: "미발주", value: `${stats.noPO}건`, hl: stats.noPO > 0 },
          { label: "공급사 미배정", value: `${stats.noSupplier}건`, hl: stats.noSupplier > 0 },
          { label: "송장 미입력", value: `${stats.noTracking}건`, hl: stats.noTracking > 0 },
          { label: "카페24 미연동", value: `${stats.unsynced}건`, hl: stats.unsynced > 0 },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-lg border border-gray-200 px-3 py-2.5">
            <p className="text-[11px] text-gray-400">{s.label}</p>
            <p className={`text-sm font-bold mt-0.5 ${s.hl ? "text-[#C41E1E]" : "text-gray-900"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* PO Tabs */}
        <div className="flex border border-gray-300 rounded-lg overflow-hidden mr-2">
          {([["all", "전체"], ["no_po", "미발주"], ["has_po", "발주완료"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setPoTab(key)}
              className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${poTab === key ? "bg-[#C41E1E] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >{label}{key === "no_po" && stats.noPO > 0 ? ` (${stats.noPO})` : ""}</button>
          ))}
        </div>

        <button onClick={handleSync} disabled={syncing}
          className="px-3 py-1.5 bg-white border border-gray-300 text-xs font-medium rounded-lg hover:bg-gray-50 cursor-pointer disabled:opacity-50">
          {syncing ? "수집중..." : "주문수집"}
        </button>

        {stats.noPO > 0 && (
          <button onClick={handleBulkPO} disabled={syncing}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50">
            일괄발주 ({stats.noPO})
          </button>
        )}

        {stats.unsynced > 0 && (
          <button onClick={handleShipmentSync} disabled={syncing}
            className="px-3 py-1.5 bg-[#C41E1E] text-white text-xs font-medium rounded-lg hover:bg-[#A01818] cursor-pointer disabled:opacity-50">
            송장연동 ({stats.unsynced})
          </button>
        )}

        {/* Excel download */}
        <button
          onClick={handleExcelDownload}
          disabled={orders.length === 0}
          className="px-3 py-1.5 bg-green-700 text-white text-xs font-medium rounded-lg hover:bg-green-800 cursor-pointer disabled:opacity-50"
        >
          엑셀 다운로드 ({orders.length})
        </button>

        {/* File upload */}
        <label className={`ml-auto flex items-center gap-3 px-4 py-2 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
          ocrProcessing ? "border-gray-200 bg-gray-50 text-gray-400" : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/50"
        }`}>
          <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
          </svg>
          <div className="text-xs leading-relaxed">
            <span className="font-medium text-gray-700">{ocrProcessing ? "분석중..." : "파일 드래그 또는 클릭"}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-0.5">
              이미지 / PDF / 엑셀 / 한글 / <kbd className="px-1 py-px rounded bg-gray-100 text-[10px] font-mono">Ctrl</kbd>+<kbd className="px-1 py-px rounded bg-gray-100 text-[10px] font-mono">V</kbd> 붙여넣기
            </span>
          </div>
          <input type="file" accept="image/*,.csv,.xlsx,.xls,.pdf,.doc,.docx,.hwp,.hwpx,.txt" className="hidden" disabled={ocrProcessing} onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await handleFileDrop(file);
            e.target.value = "";
          }} />
        </label>

        {/* Import options */}
        <div className="flex items-center gap-2">
          {[
            { id: "import-is-sample", label: "샘플", bg: "bg-amber-100 text-amber-700" },
            { id: "import-is-phone", label: "전화", bg: "bg-purple-100 text-purple-700" },
            { id: "import-is-group", label: "공구", bg: "bg-pink-100 text-pink-700" },
            { id: "import-is-etc", label: "기타", bg: "bg-gray-200 text-gray-700" },
          ].map((opt) => (
            <label key={opt.id} className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
              <input id={opt.id} type="checkbox" className="w-3.5 h-3.5 cursor-pointer" onChange={(e) => {
                if (e.target.checked) {
                  ["import-is-sample", "import-is-phone", "import-is-group", "import-is-etc"]
                    .filter((x) => x !== opt.id)
                    .forEach((x) => { const el = document.getElementById(x) as HTMLInputElement; if (el) el.checked = false; });
                }
              }} />
              <span className={`px-1.5 py-0.5 rounded font-medium ${opt.bg}`}>{opt.label}</span>
            </label>
          ))}
        </div>
        <div className="relative">
          <select id="import-store" className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 pr-16 appearance-none bg-white" defaultValue="">
            <option value="" disabled>판매사 선택</option>
            {stores
              .filter((s) => !["전화주문", "공구주문", "엑셀등록", "수기주문"].includes(s.name))
              .map((s) => (<option key={s.id} value={`id:${s.id}`}>{s.name}</option>))}
          </select>
          <label className="absolute right-0 top-0 h-full px-2 flex items-center bg-gray-100 border border-gray-300 rounded-r-lg text-xs font-medium text-gray-700 hover:bg-gray-200 cursor-pointer">
            파일선택
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              await handleImportFile(file);
              e.target.value = "";
            }} />
          </label>
        </div>

        {/* Export tracking */}
        <div className="relative">
          <select id="export-store" className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 pr-24 appearance-none bg-white" defaultValue="">
            <option value="" disabled>판매사 선택</option>
            <option value="__all__">전체</option>
            {stores
              .filter((s) => !["전화주문", "공구주문", "엑셀등록", "수기주문"].includes(s.name))
              .map((s) => (<option key={s.id} value={s.id} data-name={s.name}>{s.name}</option>))}
          </select>
          <div className="absolute right-0 top-0 h-full flex">
            <button onClick={() => {
              const sel = document.getElementById("export-store") as HTMLSelectElement;
              const storeId = sel.value;
              if (!storeId) { alert("판매사를 선택해주세요"); return; }
              const params = new URLSearchParams({ tracking_only: "true", format: "acts" });
              if (storeId !== "__all__") params.set("store_id", storeId);
              window.open(`/admin/api/orders/export?${params}`, "_blank");
            }}
              className="h-full px-2 flex items-center bg-green-100 border border-green-300 rounded-r-lg text-xs font-medium text-green-700 hover:bg-green-200 cursor-pointer">
              송장번호조회
            </button>
          </div>
        </div>

        {/* Selection actions */}
        {selected.size > 0 && (
          <>
            <div className="w-px h-5 bg-gray-300" />
            <span className="text-xs font-bold text-blue-600">{selected.size}건</span>
            <select onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v !== "") bulkUpdateChannel(v === "__none__" ? "" : v); }}
              defaultValue=""
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5">
              <option value="" disabled>판매방식 일괄변경</option>
              <option value="__none__">자사몰</option>
              <option value="phone">전화주문</option>
              <option value="group">공구주문</option>
              <option value="sample">샘플</option>
              <option value="etc">기타</option>
            </select>
            <select onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) bulkUpdateStore(v); }}
              defaultValue=""
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5">
              <option value="" disabled>판매사 일괄변경</option>
              {stores
                .filter((s) => !["전화주문", "공구주문", "엑셀등록", "수기주문"].includes(s.name))
                .map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
            <select onChange={(e) => { if (e.target.value) handleAssignSupplier(e.target.value); e.target.value = ""; }}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5">
              <option value="">공급사 배정</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
            <button
              onClick={async () => {
                const selectedOrders = orders.filter(o => selected.has(o.id));
                const withSupplier = selectedOrders.filter(o => o.supplier_id);
                if (withSupplier.length === 0) {
                  alert("선택한 주문에 배정된 공급사가 없습니다.\n먼저 공급사를 배정해주세요.");
                  return;
                }
                if (!confirm(`선택한 ${withSupplier.length}건의 발주서를 생성하고 메일을 발송합니다.\n(창고발주 상품은 자동으로 창고로 라우팅됩니다)\n\n진행하시겠습니까?`)) return;

                const res = await fetch("/admin/api/purchase-orders/bulk-create", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ order_ids: withSupplier.map(o => o.id) }),
                });
                const data = await res.json();
                if (!res.ok) {
                  alert(`발주 실패: ${data.error || res.status}`);
                  return;
                }
                const lines = (data.results || []).map((r: { supplier_name: string; po_number?: string; order_count: number; is_warehouse: boolean; email_sent: boolean; error?: string }) => {
                  const tag = r.is_warehouse ? "[창고] " : "";
                  const status = r.email_sent ? "v" : "x";
                  const err = r.error ? ` (${r.error})` : "";
                  return `${status} ${tag}${r.supplier_name}: ${r.po_number || "?"} (${r.order_count}건)${err}`;
                });
                let msg = `발주 결과: PO ${data.created_count}건 생성, 메일 ${data.email_success}건 발송\n\n` + lines.join("\n");
                if (data.skipped?.length) msg += `\n\n건너뜀 ${data.skipped.length}건`;
                alert(msg);
                setSelected(new Set());
                fetchOrders();
              }}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 cursor-pointer"
            >
              선택 발주 ({selected.size})
            </button>
            <button
              onClick={async () => {
                if (!confirm(`선택한 ${selected.size}건을 삭제합니다.\n관련 정산 항목도 함께 삭제됩니다. 계속할까요?`)) return;
                const res = await fetch("/admin/api/orders", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ids: Array.from(selected) }),
                });
                const data = await res.json();
                if (res.ok) {
                  alert(`${data.deleted}건 삭제 완료`);
                  setSelected(new Set());
                  fetchOrders();
                } else {
                  alert(`삭제 실패: ${data.error}`);
                }
              }}
              className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 cursor-pointer"
            >
              선택 삭제 ({selected.size})
            </button>
          </>
        )}
      </div>

      {/* ═══════════════════ TABLE ═══════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-gray-400">조건에 맞는 주문이 없습니다.</div>
        ) : (
          <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={pagedOrders.length > 0 && pagedOrders.every((o) => selected.has(o.id))} onChange={toggleAll} className="rounded" />
                </th>
                <th className="text-left px-2 py-2.5 font-medium">No</th>
                <th className="text-left px-2 py-2.5 font-medium">주문번호</th>
                <th className="text-left px-2 py-2.5 font-medium">상품/옵션</th>
                <th className="text-left px-2 py-2.5 font-medium">주문자/수취인/연락처</th>
                <th className="text-left px-2 py-2.5 font-medium">배송주소</th>
                <th className="text-left px-2 py-2.5 font-medium">판매방식</th>
                <th className="text-left px-2 py-2.5 font-medium">판매사</th>
                <th className="text-left px-2 py-2.5 font-medium">공급사/출고지</th>
                <th className="text-right px-2 py-2.5 font-medium">수량</th>
                <th className="text-right px-2 py-2.5 font-medium">금액</th>
                <th className="text-center px-2 py-2.5 font-medium">입금</th>
                <th className="text-left px-2 py-2.5 font-medium">송장</th>
                <th className="text-center px-2 py-2.5 font-medium">발주상태</th>
                <th className="text-center px-2 py-2.5 font-medium">배송상태</th>
                <th className="text-center px-2 py-2.5 font-medium">CS</th>
                <th className="text-right px-3 py-2.5 font-medium">주문일</th>
              </tr>
              {/* Column filters — 17 <th> elements */}
              <tr className="text-xs border-b border-gray-200 bg-white">
                {/* 1. Reset button */}
                <th className="px-2 py-1.5">
                  {(colFilterOrderNo || colFilterProduct || colFilterCustomer || colFilterAddress || colFilterChannel || colFilterPayment || colFilterPOStatus || colFilterQty || colFilterAmount || colFilterTracking || filterStore || filterSupplier || filterStatus) && (
                    <button
                      onClick={() => {
                        setColFilterOrderNo(""); setColFilterProduct(""); setColFilterCustomer(""); setColFilterAddress("");
                        setColFilterChannel(""); setColFilterPayment(""); setColFilterPOStatus("");
                        setColFilterQty(""); setColFilterAmount(""); setColFilterTracking("");
                        setFilterStore(""); setFilterSupplier(""); setFilterStatus("");
                      }}
                      title="필터 초기화"
                      className="text-[10px] text-red-500 hover:text-red-700 cursor-pointer"
                    >X</button>
                  )}
                </th>
                {/* 2. empty (No) */}
                <th></th>
                {/* 3. 주문번호 input */}
                <th className="px-1 py-1">
                  <input type="text" value={colFilterOrderNo} onChange={(e) => setColFilterOrderNo(e.target.value)}
                    placeholder="주문번호" className="w-full text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white" />
                </th>
                {/* 4. 상품/옵션 input */}
                <th className="px-1 py-1">
                  <input type="text" value={colFilterProduct} onChange={(e) => setColFilterProduct(e.target.value)}
                    placeholder="상품/옵션" className="w-full text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white" />
                </th>
                {/* 5. 이름/연락처 input */}
                <th className="px-1 py-1">
                  <input type="text" value={colFilterCustomer} onChange={(e) => setColFilterCustomer(e.target.value)}
                    placeholder="이름/연락처" className="w-full text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white" />
                </th>
                {/* 6. 주소 input */}
                <th className="px-1 py-1">
                  <input type="text" value={colFilterAddress} onChange={(e) => setColFilterAddress(e.target.value)}
                    placeholder="주소" className="w-full text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white" />
                </th>
                {/* 7. 판매방식 select */}
                <th className="px-1 py-1">
                  <select value={colFilterChannel} onChange={(e) => setColFilterChannel(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    <option value="phone">전화주문</option>
                    <option value="group">공구주문</option>
                    <option value="sample">샘플</option>
                    <option value="etc">기타</option>
                    <option value="domestic">자사몰</option>
                  </select>
                </th>
                {/* 8. 판매사 select */}
                <th className="px-1 py-1">
                  <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    {stores
                      .filter((s) => !["전화주문", "공구주문", "엑셀등록", "수기주문"].includes(s.name))
                      .map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                </th>
                {/* 9. 공급사 select */}
                <th className="px-1 py-1">
                  <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    <option value="__none__">미배정</option>
                    {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                </th>
                {/* 10. 수량 select */}
                <th className="px-1 py-1">
                  <select value={colFilterQty} onChange={(e) => setColFilterQty(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    <option value="1">1개</option>
                    <option value="2+">2개이상</option>
                  </select>
                </th>
                {/* 11. 금액 select */}
                <th className="px-1 py-1">
                  <select value={colFilterAmount} onChange={(e) => setColFilterAmount(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    <option value="under10k">~1만</option>
                    <option value="10k_50k">1~5만</option>
                    <option value="50k_100k">5~10만</option>
                    <option value="over100k">10만~</option>
                  </select>
                </th>
                {/* 12. 입금 select */}
                <th className="px-1 py-1 text-center">
                  <select value={colFilterPayment} onChange={(e) => setColFilterPayment(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    <option value="paid">완료</option>
                    <option value="unpaid">미입금</option>
                  </select>
                </th>
                {/* 13. 송장 tracking filter select */}
                <th className="px-1 py-1">
                  <select value={colFilterTracking} onChange={(e) => setColFilterTracking(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    <option value="missing">송장미입력</option>
                  </select>
                </th>
                {/* 14. 발주상태 select */}
                <th className="px-1 py-1 text-center">
                  <select value={colFilterPOStatus} onChange={(e) => setColFilterPOStatus(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    <option value="no_po">미발주</option>
                    <option value="mail_not_sent">메일미발송</option>
                    <option value="mail_sent">메일발송</option>
                    <option value="mail_read">메일열람</option>
                    <option value="tracking">송장등록</option>
                  </select>
                </th>
                {/* 15. 배송상태 select */}
                <th className="px-1 py-1 text-center">
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="">전체</option>
                    <option value="pending">입금전</option>
                    <option value="ordered">상품준비중</option>
                    <option value="shipping">배송중</option>
                    <option value="delivered">배송완료</option>
                    <option value="cancelled">취소</option>
                  </select>
                </th>
                {/* 16. empty (CS) */}
                <th></th>
                {/* 17. empty (주문일) */}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedOrders.map((o, idx) => (
                <OrderRow
                  key={o.id}
                  o={o}
                  idx={page * pageSize + idx}
                  displayedCount={stats.displayed}
                  isSelected={selected.has(o.id)}
                  toggleSelect={toggleSelect}
                  editingField={editingCell?.orderId === o.id ? editingCell.field : null}
                  onStartEdit={onStartEdit}
                  saveCellEdit={saveCellEdit}
                  stores={filteredStores}
                  fetchOrders={fetchOrders}
                  trackingEdit={trackingEdit[o.id]}
                  onTrackingEdit={handleTrackingEdit}
                  onSaveTracking={saveTracking}
                  saving={saving}
                  onOpenCs={openCs}
                />
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                {page * pageSize + 1}~{Math.min((page + 1) * pageSize, orders.length)} / {orders.length}건
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(0)} disabled={page === 0}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default cursor-pointer">&#171;</button>
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default cursor-pointer">&#8249;</button>
                {Array.from({ length: totalPages }, (_, i) => i)
                  .filter((i) => i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 2)
                  .reduce<(number | "...")[]>((acc, i, idx, arr) => {
                    if (idx > 0 && i - (arr[idx - 1] as number) > 1) acc.push("...");
                    acc.push(i);
                    return acc;
                  }, [])
                  .map((item, i) =>
                    item === "..." ? (
                      <span key={`dot-${i}`} className="px-1 text-xs text-gray-400">...</span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => setPage(item as number)}
                        className={`px-2.5 py-1 text-xs rounded cursor-pointer ${
                          page === item ? "bg-[#C41E1E] text-white" : "border border-gray-300 hover:bg-gray-50"
                        }`}
                      >{(item as number) + 1}</button>
                    )
                  )}
                <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default cursor-pointer">&#8250;</button>
                <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default cursor-pointer">&#187;</button>
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {/* Bottom Summary */}
      {orders.length > 0 && (
        <div className="mt-3 flex items-center gap-6 text-sm text-gray-500">
          <span>조회: <b className="text-gray-900">{stats.displayed}건</b></span>
          <span>수량 합계: <b className="text-gray-900">{stats.totalQty}개</b></span>
          <span>금액 합계: <b className="text-gray-900">{stats.totalAmount.toLocaleString()}원</b></span>
        </div>
      )}

      {/* CS Modal */}
      {csModalOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setCsModalOrder(null)}>
          <div className="bg-white rounded-2xl w-[520px] max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">CS 처리</h2>
              <p className="text-xs text-gray-500 mt-1">주문번호 {csModalOrder.cafe24_order_id} / {csModalOrder.product_name}</p>
              <p className="text-xs text-gray-500">구매자: {csModalOrder.buyer_name || "-"} / {csModalOrder.buyer_phone || "-"}</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1.5">처리 유형</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: "refunded", label: "환불", cls: "bg-red-50 text-red-600 border-red-200" },
                    { key: "returned", label: "반품", cls: "bg-orange-50 text-orange-600 border-orange-200" },
                    { key: "exchanged", label: "교환", cls: "bg-purple-50 text-purple-600 border-purple-200" },
                  ] as const).map((t) => (
                    <button key={t.key} onClick={() => setCsAction(t.key)}
                      className={`text-sm py-2 rounded border cursor-pointer ${csAction === t.key ? `${t.cls} font-semibold` : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                    >{t.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1.5">사유 / 메모</label>
                <textarea value={csNote} onChange={(e) => setCsNote(e.target.value)} rows={3}
                  placeholder="고객이 요청한 사유, 처리 방법 등"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
                <p className="text-[11px] text-gray-400 mt-1">저장 시 주문 메모에 타임스탬프와 함께 누적됩니다.</p>
              </div>
              {csModalOrder.memo && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500 mb-1">이전 메모</p>
                  <p className="text-xs text-gray-600 whitespace-pre-wrap">{csModalOrder.memo}</p>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setCsModalOrder(null)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
              <button onClick={submitCs} disabled={saving} className="px-5 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer disabled:opacity-50">
                {saving ? "처리 중..." : "처리 완료"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
