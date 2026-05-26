"use client";

import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";

interface Store { id: string; name: string; mall_id: string; status: string; }
interface Supplier { id: string; name: string; email: string; }
interface AddrVerifyResult { id: string; status: "valid" | "invalid" | "unknown"; reason?: string | null; suggestion?: string | null; matched?: string; zipNo?: string | null }

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
  shipping_fee: number;
  supply_price: number;
  supply_shipping_fee: number;
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
  address_verify_status: "valid" | "invalid" | "unknown" | null;
  address_verify_reason: string | null;
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

/** 주소 문자열에서 JUSO API 검색에 적합한 키워드 추출 */
function extractAddrKeyword(addr: string): string {
  if (!addr) return "";
  // 우편번호·괄호 제거
  let s = addr.replace(/\(?\d{5}\)?/g, "").replace(/\([^)]*\)/g, "").trim();
  // 시/도 ~ 도로명+번지까지만 추출 (상세주소 제거)
  const roadMatch = s.match(/.+?(?:로|길|대로)\s*\d+[\-\d]*/);
  if (roadMatch) s = roadMatch[0];
  // 앞 3~4 토큰만
  const tokens = s.split(/\s+/).filter(Boolean);
  return tokens.slice(0, 4).join(" ");
}

/* ── AddressEditModal — JUSO API 연동 주소 수정 모달 ── */
function AddressEditModal({ order, onClose, onSave }: {
  order: Order;
  onClose: () => void;
  onSave: (orderId: string, newAddress: string) => Promise<void>;
}) {
  const [keyword, setKeyword] = useState(() => extractAddrKeyword(order.receiver_address || ""));
  const [results, setResults] = useState<{ zipNo: string; roadAddr: string; jibunAddr: string; bdNm: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailAddr, setDetailAddr] = useState("");
  const [selectedAddr, setSelectedAddr] = useState<{ zipNo: string; roadAddr: string } | null>(null);
  const [manualAddr, setManualAddr] = useState(order.receiver_address || "");
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  // ESC 키로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const doSearch = async (page = 1) => {
    if (!keyword || keyword.length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/admin/api/address-search?keyword=${encodeURIComponent(keyword)}&page=${page}`);
      const data = await res.json();
      setResults(data.results || []);
      setTotalCount(data.totalCount || 0);
      setCurrentPage(page);
    } catch { setResults([]); }
    finally { setSearching(false); }
  };

  const handleSelect = (r: { zipNo: string; roadAddr: string }) => {
    setSelectedAddr(r);
    setDetailAddr("");
    setManualAddr(`(${r.zipNo}) ${r.roadAddr}`);
  };

  const handleSave = async () => {
    if (saving) return; // 더블클릭 방지
    const finalAddr = selectedAddr
      ? `(${selectedAddr.zipNo}) ${selectedAddr.roadAddr}${detailAddr ? " " + detailAddr : ""}`
      : manualAddr.trim();
    if (!finalAddr) { alert("주소를 입력해주세요"); return; }
    if (finalAddr === order.receiver_address) { onClose(); return; } // 동일 주소면 스킵
    setSaving(true);
    await onSave(order.id, finalAddr);
    setSaving(false);
  };

  const totalPages = Math.ceil(totalCount / 10);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-900">주소 수정</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer">&times;</button>
          </div>
          <p className="text-[11px] text-gray-500">
            주문번호: {order.cafe24_order_id} &middot; {order.receiver_name}
          </p>
        </div>

        {/* Current address */}
        <div className="px-4 pt-3">
          <label className="text-[11px] text-gray-500 block mb-1">현재 주소</label>
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2.5 py-1.5 break-all">
            {order.receiver_address || "-"}
          </div>
        </div>

        {/* JUSO search */}
        <div className="px-4 pt-3">
          <label className="text-[11px] text-gray-500 block mb-1">주소 검색 (도로명/지번)</label>
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSearch(1); }}
              placeholder="예: 강남구 테헤란로 123"
              className="flex-1 border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={() => doSearch(1)}
              disabled={searching || keyword.length < 2}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              {searching ? "검색중..." : "검색"}
            </button>
          </div>
        </div>

        {/* Search results */}
        <div className="px-4 pt-2 flex-1 overflow-y-auto min-h-0" style={{ maxHeight: "240px" }}>
          {results.length > 0 ? (
            <>
              <div className="text-[10px] text-gray-400 mb-1">검색결과 {totalCount}건</div>
              <div className="space-y-1">
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelect(r)}
                    className={`w-full text-left px-2.5 py-2 rounded border text-xs cursor-pointer transition-colors ${
                      selectedAddr?.roadAddr === r.roadAddr && selectedAddr?.zipNo === r.zipNo
                        ? "border-blue-400 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/50"
                    }`}
                  >
                    <div className="font-medium text-gray-800">({r.zipNo}) {r.roadAddr}</div>
                    {r.jibunAddr && <div className="text-[10px] text-gray-400 mt-0.5">{r.jibunAddr}</div>}
                    {r.bdNm && <div className="text-[10px] text-gray-500">{r.bdNm}</div>}
                  </button>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <button disabled={currentPage <= 1} onClick={() => doSearch(currentPage - 1)}
                    className="px-2 py-0.5 text-[10px] border rounded disabled:opacity-30 cursor-pointer">&laquo; 이전</button>
                  <span className="text-[10px] text-gray-500">{currentPage} / {totalPages}</span>
                  <button disabled={currentPage >= totalPages} onClick={() => doSearch(currentPage + 1)}
                    className="px-2 py-0.5 text-[10px] border rounded disabled:opacity-30 cursor-pointer">다음 &raquo;</button>
                </div>
              )}
            </>
          ) : searching ? (
            <div className="text-xs text-gray-400 text-center py-4">검색 중...</div>
          ) : null}
        </div>

        {/* Detail address input (when JUSO result selected) */}
        {selectedAddr && (
          <div className="px-4 pt-2">
            <label className="text-[11px] text-gray-500 block mb-1">상세주소 입력</label>
            <div className="text-[10px] text-blue-600 mb-1">({selectedAddr.zipNo}) {selectedAddr.roadAddr}</div>
            <input
              type="text"
              value={detailAddr}
              onChange={(e) => setDetailAddr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder="상세주소 (동/호수 등)"
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              autoFocus
            />
          </div>
        )}

        {/* Manual edit fallback */}
        {!selectedAddr && (
          <div className="px-4 pt-2">
            <label className="text-[11px] text-gray-500 block mb-1">또는 직접 입력</label>
            <input
              type="text"
              value={manualAddr}
              onChange={(e) => setManualAddr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 mt-2 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-1.5 border border-gray-300 text-xs rounded-lg hover:bg-gray-50 cursor-pointer disabled:opacity-40">취소</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50">
            {saving ? "저장 중..." : "주소 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function derivePOStatus(o: Order): { type: string; typeStyle: string; status: string; statusStyle: string } {
  const empty = { type: "", typeStyle: "", status: "", statusStyle: "" };
  if (o.shipping_status === "cancelled") return empty;

  // 발주 종류: PO 있으면 자동, 없으면 수동
  let type: string;
  let typeStyle: string;
  if (o.purchase_order_id) {
    type = "자동발주";
    typeStyle = "text-blue-600";
  } else {
    type = "수동발주";
    typeStyle = "text-amber-600";
  }

  // 발주처리현황
  let status = "";
  let statusStyle = "";
  if (o.tracking_number) {
    status = "공급사 송장번호 등록";
    statusStyle = "text-green-600";
  } else if (o.purchase_order_id && o.purchase_orders) {
    const po = o.purchase_orders;
    if (po.completed_at) {
      status = "공급사 송장번호 등록";
      statusStyle = "text-green-600";
    } else if (po.viewed_at) {
      status = "발주서 이메일 열람";
      statusStyle = "text-indigo-600";
    } else if (po.sent_at || po.status === "sent") {
      status = "발주서 이메일 발송";
      statusStyle = "text-blue-600";
    } else {
      status = "미발주";
      statusStyle = "text-orange-500";
    }
  } else {
    status = "미발주";
    statusStyle = "text-orange-500";
  }

  return { type, typeStyle, status, statusStyle };
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
  trackingEdit, onTrackingEdit, onSaveTracking, saving, onOpenCs, addrStatus, onEditAddress,
}: {
  o: Order; idx: number; displayedCount: number; isSelected: boolean;
  toggleSelect: (id: string) => void;
  editingField: "channel" | "store" | "orderId" | null;
  onStartEdit: (orderId: string, field: "channel" | "store" | "orderId") => void;
  saveCellEdit: (orderId: string, field: "channel" | "store" | "orderId", value: string) => void;
  stores: Store[];
  fetchOrders: () => void;
  trackingEdit: { company: string; number: string } | undefined;
  onTrackingEdit: (orderId: string, edit: { company: string; number: string } | null) => void;
  onSaveTracking: (orderId: string) => void;
  saving: boolean;
  onOpenCs: (order: Order) => void;
  addrStatus?: AddrVerifyResult;
  onEditAddress: (order: Order) => void;
}) {
  const noTrack = !o.tracking_number && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered";
  const noSup = !o.supplier_id;
  const noPO = !o.purchase_order_id && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered" && o.shipping_status !== "ordered";
  const editing = !!trackingEdit;
  return (
    <tr
      className={`hover:bg-gray-50/50 cursor-pointer [&>td]:border-b [&>td]:border-gray-100 ${
        isSelected ? "bg-blue-50/60" : noPO && noSup ? "bg-red-50/20" : noPO ? "bg-amber-50/20" : ""
      }`}
      onClick={() => toggleSelect(o.id)}
    >
      {/* 1. Checkbox */}
      <td className="px-2 py-1.5">
        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(o.id)} onClick={(e) => e.stopPropagation()} className="rounded w-3.5 h-3.5" />
      </td>
      {/* 2. No */}
      <td className="px-1.5 py-1.5 text-[11px] text-gray-400">{displayedCount - idx}</td>
      {/* 3. 주문번호 (inline editable) */}
      <td
        className="px-1.5 py-1.5 whitespace-nowrap cursor-pointer hover:bg-gray-100/60"
        onClick={(e) => { e.stopPropagation(); if (editingField !== "orderId") onStartEdit(o.id, "orderId"); }}
        title="클릭해서 주문번호 수정"
      >
        {editingField === "orderId" ? (
          <input
            autoFocus
            type="text"
            defaultValue={o.cafe24_order_id}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val && val !== o.cafe24_order_id) {
                saveCellEdit(o.id, "orderId", val);
              } else {
                onStartEdit("", "orderId");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val && val !== o.cafe24_order_id) {
                  saveCellEdit(o.id, "orderId", val);
                } else {
                  onStartEdit("", "orderId");
                }
              } else if (e.key === "Escape") {
                onStartEdit("", "orderId");
              }
            }}
            className="w-full text-xs font-medium border border-gray-400 rounded px-1 py-0.5 bg-white"
          />
        ) : (
          <div className="text-xs font-medium text-gray-900">{o.cafe24_order_id}</div>
        )}
        <div className="text-[10px] text-gray-400">{formatDateTime(o.order_date)}</div>
      </td>
      {/* 4. 상품/옵션 */}
      <td className="px-1.5 py-1.5 max-w-[200px]">
        <div className="text-xs text-gray-900 truncate">{o.product_name}</div>
        {o.option_text && <div className="text-[10px] text-gray-400 truncate">{o.option_text}</div>}
      </td>
      {/* 5. 주문자/수취인/연락처 */}
      <td className="px-1.5 py-1.5 whitespace-nowrap">
        <div className="text-xs text-gray-700">{o.buyer_name || o.receiver_name || "-"}</div>
        {o.receiver_name && o.buyer_name && o.receiver_name !== o.buyer_name && (
          <div className="text-[10px] text-gray-400">&rarr; {o.receiver_name}</div>
        )}
        <div className="text-[10px] font-mono text-gray-400">{o.receiver_phone || o.buyer_phone || ""}</div>
      </td>
      {/* 6. 배송주소 */}
      {(() => {
        const dbValid = o.address_verify_status === "valid";
        const status = dbValid ? "valid" : (addrStatus?.status || o.address_verify_status);
        const title = dbValid ? "검증 완료" : addrStatus
          ? (addrStatus.reason || addrStatus.suggestion || (addrStatus.status === "valid" ? "검증 완료" : addrStatus.status === "invalid" ? "검증 오류" : "미검증"))
          : (o.address_verify_reason || (status === "valid" ? "검증 완료" : status === "invalid" ? "검증 오류" : "미검증"));
        const color = status === "valid" ? "bg-green-500" : status === "invalid" ? "bg-red-500" : "bg-yellow-400";
        const isInvalid = status === "invalid";
        return (
          <td
            className={`px-1.5 py-1.5 max-w-[180px] ${isInvalid ? "cursor-pointer hover:bg-red-50/60" : ""}`}
            onClick={isInvalid ? (e) => { e.stopPropagation(); onEditAddress(o); } : undefined}
            title={isInvalid ? `${title} — 클릭하여 주소 수정` : title}
          >
            <div className="flex items-center gap-1">
              <span className={`shrink-0 w-2 h-2 rounded-full ${color}`} />
              <div className={`text-[11px] truncate ${isInvalid ? "text-red-600 underline decoration-dotted" : "text-gray-600"}`} title={o.receiver_address || ""}>
                {o.receiver_address || <span className="text-gray-300">-</span>}
              </div>
              {isInvalid && <span className="shrink-0 text-[9px] text-red-400">&#9998;</span>}
            </div>
          </td>
        );
      })()}
      {/* 7. 판매방식 */}
      <td
        className="px-1.5 py-1.5 text-xs whitespace-nowrap cursor-pointer hover:bg-gray-100/60"
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
            <option value="group">공구주문</option>
            <option value="phone">전화주문</option>
            <option value="sample">샘플</option>
            <option value="etc">기타</option>
          </select>
        ) : (() => {
          if (o.sales_channel === "group") return <span className="px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 font-medium">공구주문</span>;
          if (o.sales_channel === "phone") return <span className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-medium">전화주문</span>;
          if (o.sales_channel === "sample") return <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">샘플</span>;
          if (o.sales_channel === "etc") return <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-medium">기타</span>;
          if (!o.stores?.name) return <span className="text-gray-300">-</span>;
          return <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">자사몰</span>;
        })()}
      </td>
      {/* 8. 판매사 */}
      <td
        className="px-1.5 py-1.5 text-xs whitespace-nowrap cursor-pointer hover:bg-gray-100/60"
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
          const isPseudo = name === "공구주문";
          if (!name || isPseudo) return <span className="text-gray-400 italic">- (클릭해서 지정)</span>;
          const isManual = o.stores?.mall_id?.startsWith("manual_") || o.stores?.mall_id?.startsWith("excel_");
          return isManual
            ? <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">{name}</span>
            : <span className="text-gray-500">{name}</span>;
        })()}
      </td>
      {/* 9. 공급사/출고지 */}
      <td className="px-1.5 py-1.5 whitespace-nowrap">
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
      <td className="px-1.5 py-1.5 text-right text-xs text-gray-700">{o.quantity}</td>
      {/* 11. 공급가 */}
      <td className="px-1.5 py-1.5 text-right text-xs text-gray-700 whitespace-nowrap bg-blue-50/30">{(() => { const v = o.supply_price * o.quantity; return v === 0 ? <span className="text-gray-300">-</span> : v.toLocaleString(); })()}</td>
      {/* 12. 공급배송비 */}
      <td className="px-1.5 py-1.5 text-right text-xs text-gray-700 whitespace-nowrap bg-blue-50/30">{o.supply_shipping_fee === 0 ? <span className="text-gray-300">-</span> : o.supply_shipping_fee.toLocaleString()}</td>
      {/* 13. 판매가 */}
      <td className="px-1.5 py-1.5 text-right text-xs text-gray-700 whitespace-nowrap bg-green-50/30">{o.order_amount === 0 ? <span className="text-gray-300">-</span> : o.order_amount.toLocaleString()}</td>
      {/* 14. 판매배송비 */}
      <td className="px-1.5 py-1.5 text-right text-xs text-gray-700 whitespace-nowrap bg-green-50/30">{(o.shipping_fee || 0) === 0 ? <span className="text-gray-300">-</span> : (o.shipping_fee || 0).toLocaleString()}</td>
      {/* 12. 입금 */}
      <td className="px-1.5 py-1.5 text-center">
        {(() => {
          const isPaid = o.shipping_status !== "pending" && o.shipping_status !== "cancelled";
          const isCancelled = o.shipping_status === "cancelled";
          if (isCancelled) return <span className="text-[10px] text-gray-300">-</span>;
          return (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const newStatus = isPaid ? "pending" : "ordered";
                const label = isPaid ? "입금전으로 되돌림" : "입금확인 처리";
                if (!confirm(`${label}하시겠습니까?`)) return;
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
                  : "bg-red-50 text-red-600 border-red-300 hover:bg-red-100"
              }`}
              title={isPaid ? "클릭하면 입금전으로 되돌림" : "클릭하면 입금확인 처리"}
            >
              {isPaid ? "완료" : "입금전"}
            </button>
          );
        })()}
      </td>
      {/* 13. 송장 (inline editable) */}
      <td className="px-1.5 py-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
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
          (() => {
            const numbers = o.tracking_number.split(",").map(n => n.trim()).filter(Boolean);
            return (
              <div className="flex flex-col gap-0.5">
                {numbers.map((num, i) => {
                  const url = getTrackingUrl(o.shipping_company, num);
                  return (
                    <div key={i} className="flex items-center gap-1">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline font-mono text-xs truncate"
                          title={`배송추적: ${num}`}>
                          {num}
                        </a>
                      ) : (
                        <span className="font-mono text-gray-700 text-xs truncate">{num}</span>
                      )}
                      {i === 0 && (
                        <button onClick={() => onTrackingEdit(o.id, { company: o.shipping_company || "CJ대한통운", number: o.tracking_number })}
                          className="text-gray-400 hover:text-gray-600 cursor-pointer flex-shrink-0" title="수정">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                      )}
                    </div>
                  );
                })}
                <span className="text-[10px] text-gray-400">{o.shipping_company}{numbers.length > 1 ? ` (${numbers.length}건)` : ""}</span>
                {!o.cafe24_shipping_synced && <span className="text-[10px] text-orange-500">미연동</span>}
              </div>
            );
          })()
        ) : noTrack ? (
          <button onClick={() => onTrackingEdit(o.id, { company: "CJ대한통운", number: "" })}
            className="text-[11px] text-blue-600 hover:underline cursor-pointer">+ 송장 입력</button>
        ) : (
          <span className="text-gray-300">-</span>
        )}
      </td>
      {/* 14-15. 발주종류 + 발주상태 */}
      {(() => {
        const ps = derivePOStatus(o);
        return (
          <>
            <td className="px-1.5 py-1.5 text-center">
              {ps.type ? (
                <span className={`text-[11px] font-medium ${ps.typeStyle}`}>{ps.type}</span>
              ) : (
                <span className="text-gray-300">-</span>
              )}
            </td>
            <td className="px-1.5 py-1.5 text-center">
              {ps.status ? (
                <span className={`text-[11px] font-medium ${ps.statusStyle}`}>{ps.status}</span>
              ) : (
                <span className="text-gray-300">-</span>
              )}
            </td>
          </>
        );
      })()}
      {/* 16. 배송상태 */}
      <td className="px-1.5 py-1.5 text-center">
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLE[o.shipping_status] || STATUS_STYLE.pending}`}>
          {STATUS_LABEL[o.shipping_status] || o.shipping_status}
        </span>
      </td>
      {/* 16. CS */}
      <td className="px-1.5 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
        {o.shipping_status !== "cancelled" ? (
          <button onClick={() => onOpenCs(o)} className="text-[11px] px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer">
            CS
          </button>
        ) : (
          <span className="text-gray-300">-</span>
        )}
      </td>
      {/* 17. 주문일 */}
      <td className="px-2 py-1.5 text-[11px] text-gray-400 text-right whitespace-nowrap">{formatDate(o.order_date)}</td>
    </tr>
  );
});

/* ═══════════════════════════════════════════════════
   Unified Orders Page
   ═══════════════════════════════════════════════════ */

const FILTER_STORAGE_KEY = "unified-orders-filters";
const PSEUDO_STORES = ["공구주문", "엑셀등록", "수기주문"];
function loadSavedFilters() {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || "null"); } catch { return null; }
}

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
  const [csSaving, setCsSaving] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ orderId: string; field: "channel" | "store" | "orderId" } | null>(null);
  const onStartEdit = useCallback((orderId: string, field: "channel" | "store" | "orderId") => {
    setEditingCell(orderId ? { orderId, field } : null);
  }, []);

  // Filters — localStorage 복원
  const saved = useRef(loadSavedFilters());

  const [filterStatus, setFilterStatus] = useState(saved.current?.filterStatus || "");
  const [filterStore, setFilterStore] = useState(saved.current?.filterStore || "");
  const [filterSupplier, setFilterSupplier] = useState(saved.current?.filterSupplier || "");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [dateTo, setDateTo] = useState(today());
  const [searchKeyword, setSearchKeyword] = useState(saved.current?.searchKeyword || "");

  const [filterNoTracking, setFilterNoTracking] = useState(saved.current?.filterNoTracking || false);
  const [filterNoSupplier, setFilterNoSupplier] = useState(saved.current?.filterNoSupplier || false);
  const [filterDomestic, setFilterDomestic] = useState(saved.current?.filterDomestic || false);
  const [colFilterOrderNo, setColFilterOrderNo] = useState(saved.current?.colFilterOrderNo || "");
  const [colFilterProduct, setColFilterProduct] = useState(saved.current?.colFilterProduct || "");
  const [colFilterCustomer, setColFilterCustomer] = useState(saved.current?.colFilterCustomer || "");
  const [colFilterAddress, setColFilterAddress] = useState(saved.current?.colFilterAddress || "");
  const [colFilterAddrStatus, setColFilterAddrStatus] = useState(saved.current?.colFilterAddrStatus || "");
  const [colFilterChannel, setColFilterChannel] = useState(saved.current?.colFilterChannel || "");
  const [colFilterPayment, setColFilterPayment] = useState(saved.current?.colFilterPayment || "");
  const [colFilterPOType, setColFilterPOType] = useState(saved.current?.colFilterPOType || "");
  const [colFilterPOStatus, setColFilterPOStatus] = useState(saved.current?.colFilterPOStatus || "");
  const [colFilterQty, setColFilterQty] = useState(saved.current?.colFilterQty || "");
  const [colFilterAmount, setColFilterAmount] = useState(saved.current?.colFilterAmount || "");
  const [colFilterTracking, setColFilterTracking] = useState(saved.current?.colFilterTracking || "");
  const [poTab, setPoTab] = useState<"all" | "no_po" | "has_po">(saved.current?.poTab || "all");

  // 필터 변경 시 localStorage 저장
  useEffect(() => {
    const data = {
      filterStatus, filterStore, filterSupplier, dateFrom, dateTo, searchKeyword,
      filterNoTracking, filterNoSupplier, filterDomestic, colFilterOrderNo, colFilterProduct,
      colFilterCustomer, colFilterAddress, colFilterAddrStatus, colFilterChannel, colFilterPayment,
      colFilterPOType, colFilterPOStatus, colFilterQty, colFilterAmount, colFilterTracking, poTab,
    };
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(data));
  }, [filterStatus, filterStore, filterSupplier, dateFrom, dateTo, searchKeyword,
    filterNoTracking, filterNoSupplier, filterDomestic, colFilterOrderNo, colFilterProduct,
    colFilterCustomer, colFilterAddress, colFilterAddrStatus, colFilterChannel, colFilterPayment,
    colFilterPOType, colFilterPOStatus, colFilterQty, colFilterAmount, colFilterTracking, poTab]);

  // Address verification
  const [addrResults, setAddrResults] = useState<Record<string, AddrVerifyResult>>({});
  const [addrVerifying, setAddrVerifying] = useState(false);

  // Tracking inline edit
  const [trackingEdit, setTrackingEdit] = useState<Record<string, { company: string; number: string }>>({});

  // CS modal
  const [csModalOrder, setCsModalOrder] = useState<Order | null>(null);
  const [csAction, setCsAction] = useState<"refunded" | "returned" | "exchanged">("refunded");
  const [csNote, setCsNote] = useState("");

  // Drag & drop
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const patchOrder = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], updates }),
    });
    return res.ok;
  }, []);

  // Fetch orders (must be defined before callbacks that reference it)
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set("status", filterStatus);
    if (filterStore) params.set("store_id", filterStore);
    if (filterSupplier && filterSupplier !== "__none__") params.set("supplier_id", filterSupplier);
    if (dateFrom) params.set("start_date", dateFrom);
    if (dateTo) params.set("end_date", dateTo);
    params.set("limit", "10000");

    const res = await fetch(`/admin/api/orders?${params}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    const fetchedOrders = data.orders || [];
    setRawOrders(fetchedOrders);
    setTotal(data.total || 0);
    // DB에 저장된 주소검증 결과를 addrResults에 반영 (DB가 우선)
    const dbAddrMap: Record<string, AddrVerifyResult> = {};
    for (const o of fetchedOrders) {
      if (o.address_verify_status) {
        dbAddrMap[o.id] = { id: o.id, status: o.address_verify_status, reason: o.address_verify_reason };
      }
    }
    if (Object.keys(dbAddrMap).length > 0) {
      setAddrResults((prev) => ({ ...prev, ...dbAddrMap }));
    }
    setLoading(false);
  }, [filterStatus, filterStore, filterSupplier, dateFrom, dateTo]);

  // Address edit modal
  const [addrEditOrder, setAddrEditOrder] = useState<Order | null>(null);
  const handleEditAddress = useCallback((order: Order) => { setAddrEditOrder(order); }, []);
  const handleSaveAddress = useCallback(async (orderId: string, newAddress: string) => {
    const ok = await patchOrder(orderId, { receiver_address: newAddress, address_verify_status: null, address_verify_reason: null });
    if (!ok) { alert("주소 수정 실패"); return; }
    setAddrEditOrder(null);
    setRawOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, receiver_address: newAddress, address_verify_status: null, address_verify_reason: null } : o));
    setAddrResults((prev) => { const n = { ...prev }; delete n[orderId]; return n; });
    // 자동 재검증
    try {
      const res = await fetch("/admin/api/address-verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: [{ id: orderId, address: newAddress }] }),
      });
      if (res.ok) { fetchOrders(); }
    } catch { /* 재검증 실패해도 주소는 이미 저장됨 */ }
  }, [patchOrder, fetchOrders]);

  const saveTracking = useCallback(async (id: string) => {
    const edit = trackingEdit[id];
    if (!edit || !edit.number.trim()) return;
    const trimmedNumber = edit.number.trim();
    const company = edit.company || "CJ대한통운";
    // optimistic: 로컬 상태 즉시 반영
    setTrackingEdit((p) => { const n = { ...p }; delete n[id]; return n; });
    setRawOrders((prev) => prev.map((o) =>
      o.id === id ? { ...o, tracking_number: trimmedNumber, shipping_company: company, shipping_status: "shipping" } : o
    ));
    // 서버 저장 (백그라운드)
    const ok = await patchOrder(id, { tracking_number: trimmedNumber, shipping_company: company, shipping_status: "shipping" });
    if (!ok) {
      // 실패 시 롤백
      fetchOrders();
    }
  }, [trackingEdit, fetchOrders, patchOrder]);

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
    setCsSaving(true);
    const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actionLabel = csAction === "refunded" ? "환불" : csAction === "returned" ? "반품" : "교환";
    const entry = `[${ts}] ${actionLabel} 처리: ${csNote || "사유 미기재"}`;
    const newMemo = csModalOrder.memo ? `${csModalOrder.memo}\n${entry}` : entry;
    await patchOrder(csModalOrder.id, { shipping_status: csAction, memo: newMemo });
    setCsSaving(false);
    setCsModalOrder(null);
    fetchOrders();
  };

  // Address verification
  const handleAddressVerify = async (scope: "selected" | "all") => {
    const targets = scope === "selected"
      ? orders.filter((o) => selected.has(o.id) && o.receiver_address && o.address_verify_status !== "valid")
      : orders.filter((o) => o.receiver_address && o.address_verify_status !== "valid" && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered");
    if (targets.length === 0) { alert("검증할 주소 없음"); return; }
    setAddrVerifying(true);
    try {
      const allResults: AddrVerifyResult[] = [];
      for (let i = 0; i < targets.length; i += 50) {
        const batch = targets.slice(i, i + 50);
        const res = await fetch("/admin/api/address-verify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: batch.map((o) => ({ id: o.id, address: o.receiver_address })) }),
        });
        const data = await res.json();
        if (!res.ok) { alert(`주소 검증 오류: ${data.error}`); setAddrVerifying(false); return; }
        allResults.push(...(data.results || []));
      }
      const valid = allResults.filter((r) => r.status === "valid").length;
      const invalid = allResults.filter((r) => r.status === "invalid").length;
      alert(`주소 검증 완료 (${allResults.length}건)\n\n● 정상: ${valid}건\n● 오류: ${invalid}건`);
      fetchOrders(); // DB에 저장된 결과 반영
    } catch (e) { alert(`주소 검증 실패: ${(e as Error).message}`); }
    finally { setAddrVerifying(false); }
  };

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
    const groupEl = document.getElementById("import-is-group") as HTMLInputElement;
    const domesticEl = document.getElementById("import-is-domestic") as HTMLInputElement;
    const etcEl = document.getElementById("import-is-etc") as HTMLInputElement;
    const fd = new FormData();
    fd.append("file", file);
    if (sel.value.startsWith("id:")) fd.append("store_id", sel.value.slice(3));
    else fd.append("store_name", sel.value.slice(5));
    if (sampleEl?.checked) fd.append("sales_channel", "sample");
    else if (groupEl?.checked) fd.append("sales_channel", "group");
    else if (domesticEl?.checked) fd.append("sales_channel", "domestic");
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
      if (groupEl) groupEl.checked = false;
      if (sampleEl) sampleEl.checked = false;
      if (domesticEl) domesticEl.checked = false;
      if (etcEl) etcEl.checked = false;
      sel.value = "";
    } else alert(`오류: ${data.error}`);
  }, [fetchOrders]);

  // Image OCR → 검증 후 바로 등록
  const handleImageOCR = useCallback(async (file: File) => {
    // 1. 판매방식 체크
    const sampleEl = document.getElementById("import-is-sample") as HTMLInputElement;
    const groupEl = document.getElementById("import-is-group") as HTMLInputElement;
    const domesticEl = document.getElementById("import-is-domestic") as HTMLInputElement;
    const etcEl = document.getElementById("import-is-etc") as HTMLInputElement;
    let salesChannel: string | null = null;
    if (sampleEl?.checked) salesChannel = "sample";
    else if (groupEl?.checked) salesChannel = "group";
    else if (domesticEl?.checked) salesChannel = "domestic";
    else if (etcEl?.checked) salesChannel = "etc";
    if (!salesChannel) {
      alert("판매방식(샘플/공구/자사몰/기타)을 먼저 선택해주세요.");
      return;
    }

    // 2. 판매사 체크
    const storeSel = document.getElementById("import-store") as HTMLSelectElement;
    if (!storeSel?.value) {
      alert("판매사를 먼저 선택해주세요.");
      return;
    }
    const storeId = storeSel.value.startsWith("id:") ? storeSel.value.slice(3) : "";
    if (!storeId) {
      alert("판매사를 먼저 선택해주세요.");
      return;
    }

    setOcrProcessing(true);
    try {
      // 3. OCR 인식
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/admin/api/orders/ocr-import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { alert(`OCR 실패: ${data.error}`); return; }
      if (!data.orders?.length) { alert("이미지에서 주문 데이터를 찾지 못했습니다."); return; }

      // 4. 필수 필드 검증 (주문자/수취인, 연락처, 주소, 상품명, 수량)
      const invalid: string[] = [];
      for (const o of data.orders) {
        const missing: string[] = [];
        if (!o.product_name) missing.push("상품명");
        if (!o.receiver_name && !o.buyer_name) missing.push("주문자/수취인");
        if (!o.receiver_phone && !o.buyer_phone) missing.push("연락처");
        if (!o.receiver_address) missing.push("주소");
        if (!o.quantity) missing.push("수량");
        if (missing.length > 0) invalid.push(`${o.product_name || "?"}: ${missing.join(", ")} 누락`);
      }
      if (invalid.length > 0) {
        alert(`OCR 인식 결과에 필수 정보가 부족합니다:\n\n${invalid.join("\n")}\n\n캡쳐본에 주문자/수취인, 연락처, 주소, 상품명, 수량 정보가 모두 포함되어야 합니다.`);
        return;
      }

      // 5. 등록
      const regRes = await fetch("/admin/api/orders/manual-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: data.orders, store_id: storeId, sales_channel: salesChannel }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) { alert(`등록 실패: ${regData.error}`); return; }

      alert(`OCR 인식 ${data.orders.length}건 → ${regData.success}건 등록 완료${regData.errors?.length ? `\n\n실패:\n${regData.errors.slice(0, 5).join("\n")}` : ""}`);
      await fetchOrders();

      // 6. 주소 자동 검증
      if (regData.insertedIds?.length) {
        try {
          const addrPayload = data.orders
            .map((o: { receiver_address?: string }, i: number) => regData.insertedIds[i] ? { id: regData.insertedIds[i], address: o.receiver_address || "" } : null)
            .filter((x: { id: string; address: string } | null) => x && x.address);
          if (addrPayload.length > 0) {
            const verRes = await fetch("/admin/api/address-verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ addresses: addrPayload }),
            });
            const verData = await verRes.json();
            if (verRes.ok && verData.results) {
              const map: Record<string, AddrVerifyResult> = { ...addrResults };
              for (const r of verData.results) map[r.id] = r;
              setAddrResults(map);
              const invalidAddr = verData.results.filter((r: AddrVerifyResult) => r.status === "invalid");
              if (invalidAddr.length > 0) {
                alert(`주소 검증 완료: ${invalidAddr.length}건 확인 필요\n\n${invalidAddr.map((r: AddrVerifyResult) => `- ${r.reason || r.suggestion || r.status}`).slice(0, 5).join("\n")}`);
              }
            }
          }
        } catch { /* 주소 검증 실패해도 등록은 유지 */ }
      }
    } catch (e) {
      alert(`OCR 오류: ${(e as Error).message}`);
    } finally {
      setOcrProcessing(false);
    }
  }, [fetchOrders, addrResults]);

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
    const kCustomerPhone = normPhone(colFilterCustomer);
    return rawOrders.filter((o) => {
      if (filterNoTracking && (o.tracking_number || o.shipping_status === "cancelled" || o.shipping_status === "delivered")) return false;
      if ((filterNoSupplier || filterSupplier === "__none__") && o.supplier_id) return false;
      if (filterDomestic && (o.sales_channel || !o.stores?.name)) return false;
      if (poTab === "no_po" && (!o.supplier_id || o.purchase_order_id || o.tracking_number || o.shipping_status === "cancelled" || o.shipping_status === "delivered" || o.shipping_status === "pending" || o.shipping_status === "ordered")) return false;
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
        const phoneMatch = kCustomerPhone.length >= 4 && (
          normPhone(o.buyer_phone).includes(kCustomerPhone) ||
          normPhone(o.receiver_phone).includes(kCustomerPhone)
        );
        if (!(o.buyer_name?.toLowerCase().includes(kCustomer) || o.receiver_name?.toLowerCase().includes(kCustomer) || phoneMatch)) return false;
      }
      if (kAddress && !o.receiver_address?.toLowerCase().includes(kAddress)) return false;
      if (colFilterAddrStatus) {
        const s = o.address_verify_status || addrResults[o.id]?.status || null;
        if (colFilterAddrStatus === "valid" && s !== "valid") return false;
        if (colFilterAddrStatus === "invalid" && s !== "invalid") return false;
        if (colFilterAddrStatus === "unverified" && (s === "valid" || s === "invalid")) return false;
      }
      if (colFilterChannel === "group" && o.sales_channel !== "group") return false;
      if (colFilterChannel === "phone" && o.sales_channel !== "phone") return false;
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
      if (colFilterPOType || colFilterPOStatus) {
        const ps = derivePOStatus(o);
        if (colFilterPOType === "type_auto" && ps.type !== "자동발주") return false;
        if (colFilterPOType === "type_manual" && ps.type !== "수동발주") return false;
        if (colFilterPOStatus === "no_po" && ps.status !== "미발주") return false;
        if (colFilterPOStatus === "mail_sent" && ps.status !== "발주서 이메일 발송") return false;
        if (colFilterPOStatus === "mail_read" && ps.status !== "발주서 이메일 열람") return false;
        if (colFilterPOStatus === "tracking" && ps.status !== "공급사 송장번호 등록") return false;
      }
      return true;
    });
  }, [rawOrders, filterSupplier, filterNoTracking, filterNoSupplier, filterDomestic, poTab, searchKeyword, colFilterOrderNo, colFilterProduct, colFilterCustomer, colFilterAddress, colFilterAddrStatus, colFilterChannel, colFilterPayment, colFilterPOType, colFilterPOStatus, colFilterQty, colFilterAmount, colFilterTracking]);

  // Reset page on filter change
  useEffect(() => { setPage(0); }, [rawOrders, filterSupplier, filterNoTracking, filterNoSupplier, filterDomestic, poTab, searchKeyword, colFilterOrderNo, colFilterProduct, colFilterCustomer, colFilterAddress, colFilterAddrStatus, colFilterChannel, colFilterPayment, colFilterPOType, colFilterPOStatus, colFilterQty, colFilterAmount, colFilterTracking]);

  const totalPages = 1;
  const pagedOrders = orders;

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
    try {
      const res = await fetch("/admin/api/cafe24/shipments", { method: "POST", body: "{}" });
      const data = await res.json();
      if (data.synced > 0) {
        alert(`송장연동 완료: ${data.synced}건 성공` + (data.failed > 0 ? `, ${data.failed}건 실패` : ""));
      } else if (data.failed > 0) {
        const errors = (data.results || [])
          .filter((r: { success: boolean }) => !r.success)
          .map((r: { cafe24_order_id: string; error?: string }) => `${r.cafe24_order_id}: ${r.error}`)
          .join("\n");
        alert(`송장연동 실패 ${data.failed}건:\n${errors}`);
      } else {
        alert(data.message || "연동할 송장이 없습니다");
      }
    } catch (err) {
      alert(`송장연동 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    }
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

  const saveCellEdit = useCallback(async (orderId: string, field: "channel" | "store" | "orderId", value: string) => {
    const updates: Record<string, string | null> = {};
    if (field === "channel") {
      updates.sales_channel = value === "" ? null : value;
    } else if (field === "orderId") {
      updates.cafe24_order_id = value;
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
    const channelLabel = value === "" ? "자사몰" : value === "group" ? "공구주문" : value === "etc" ? "기타" : "샘플";
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
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        try {
          const r = await fetch("/admin/api/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [id], updates: { store_id: storeId } }),
          });
          return { id, ok: r.ok };
        } catch {
          return { id, ok: false };
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) success++;
      else {
        const id = r.status === "fulfilled" ? r.value.id : "";
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
      if (!o.purchase_order_id && !o.tracking_number && o.supplier_id && !notActive(o.shipping_status) && o.shipping_status !== "pending" && o.shipping_status !== "ordered" && o.sales_channel !== "sample") noPO++;
      if (o.tracking_number && !o.cafe24_shipping_synced) unsynced++;
    }
    return { total, displayed: orders.length, pending, noTracking, noSupplier, noPO, unsynced, totalQty, totalAmount, sample: sampleCount };
  }, [orders, total, sampleCount]);

  const handleReset = () => {
    const d = new Date();
    setFilterStatus(""); setFilterStore(""); setFilterSupplier(""); setFilterNoTracking(false); setFilterNoSupplier(false); setFilterDomestic(false);
    setDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`); setDateTo(today());
    setSearchKeyword(""); setPoTab("all");
    setColFilterOrderNo(""); setColFilterProduct(""); setColFilterCustomer(""); setColFilterAddress("");
    setColFilterChannel(""); setColFilterPayment(""); setColFilterPOStatus("");
    setColFilterQty(""); setColFilterAmount(""); setColFilterTracking("");
    localStorage.removeItem(FILTER_STORAGE_KEY);
  };

  // Excel download
  const handleExcelDownload = async () => {
    if (orders.length === 0) { alert("다운로드할 주문이 없습니다."); return; }
    const XLSX = await import("xlsx");
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
    <div className="p-4 relative"
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

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">주문수집 및 조회</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">주문 수집 / 발주 / 송장 연동 / CS 처리 -- 통합 관리</p>
        </div>
        <div className="text-sm text-gray-500">
          전체 <span className="font-bold text-gray-900">{stats.total}</span>건
          {stats.displayed !== stats.total && <> / 필터 <span className="font-bold text-blue-600">{stats.displayed}</span>건</>}
        </div>
      </div>

      {/* Filter Area */}
      <div className="bg-white rounded-lg border border-gray-200 px-3 py-2.5 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">시작일</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">종료일</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
          </div>
          <div className="flex gap-1">
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
          <div className="flex gap-2">
            <button onClick={() => fetchOrders()} className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 cursor-pointer">검색</button>
            <button onClick={handleReset} className="px-3 py-1.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">초기화</button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
        {[
          { label: "주문수량", value: `${stats.totalQty}개` },
          { label: "판매금액", value: `${stats.totalAmount.toLocaleString()}원` },
          { label: "처리대기", value: `${stats.pending}건`, hl: stats.pending > 0 },
          { label: "미발주", value: `${stats.noPO}건`, hl: stats.noPO > 0 },
          { label: "공급사 미배정", value: `${stats.noSupplier}건`, hl: stats.noSupplier > 0 },
          { label: "송장 미입력", value: `${stats.noTracking}건`, hl: stats.noTracking > 0 },
          { label: "카페24 미연동", value: `${stats.unsynced}건`, hl: stats.unsynced > 0 },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-lg border border-gray-200 px-2.5 py-2">
            <p className="text-[10px] text-gray-400">{s.label}</p>
            <p className={`text-sm font-bold mt-0.5 ${s.hl ? "text-[#C41E1E]" : "text-gray-900"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Action Bar — Row 1: Core actions */}
      <div className="flex items-center gap-2 mb-2">
        {/* PO Tabs */}
        <div className="flex border border-gray-300 rounded-lg overflow-hidden">
          {([["all", "전체"], ["no_po", "미발주"], ["has_po", "발주완료"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setPoTab(key)}
              className={`px-2.5 py-1 text-xs font-medium cursor-pointer ${poTab === key ? "bg-[#C41E1E] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >{label}{key === "no_po" && stats.noPO > 0 ? ` (${stats.noPO})` : ""}</button>
          ))}
        </div>

        <div className="w-px h-5 bg-gray-200" />

        <button onClick={handleSync} disabled={syncing}
          className="px-2.5 py-1 bg-white border border-gray-300 text-xs font-medium rounded-lg hover:bg-gray-50 cursor-pointer disabled:opacity-50">
          {syncing ? "수집중..." : "주문수집"}
        </button>

        {stats.noPO > 0 && (
          <button onClick={handleBulkPO} disabled={syncing}
            className="px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50">
            일괄발주 ({stats.noPO})
          </button>
        )}

        {stats.unsynced > 0 && (
          <button onClick={handleShipmentSync} disabled={syncing}
            className="px-2.5 py-1 bg-[#C41E1E] text-white text-xs font-medium rounded-lg hover:bg-[#A01818] cursor-pointer disabled:opacity-50">
            송장연동 ({stats.unsynced})
          </button>
        )}

        <button
          onClick={handleExcelDownload}
          disabled={orders.length === 0}
          className="px-2.5 py-1 bg-green-700 text-white text-xs font-medium rounded-lg hover:bg-green-800 cursor-pointer disabled:opacity-50"
        >
          엑셀 다운로드
        </button>

        <button
          onClick={() => handleAddressVerify(selected.size > 0 ? "selected" : "all")}
          disabled={addrVerifying || orders.length === 0}
          className="px-2.5 py-1 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 cursor-pointer disabled:opacity-50"
        >
          {addrVerifying ? "검증중..." : selected.size > 0 ? `주소검증 (${orders.filter((o) => selected.has(o.id) && o.address_verify_status !== "valid").length})` : "주소검증"}
        </button>

        {/* Right side: Import area */}
        <div className="ml-auto flex items-center gap-2">
          <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
            ocrProcessing ? "border-gray-200 bg-gray-50 text-gray-400" : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/50"
          }`}>
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
            </svg>
            <div className="text-[11px] leading-tight">
              <span className="font-medium text-gray-700">{ocrProcessing ? "분석중..." : "파일 드래그/클릭"}</span>
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                이미지/PDF/엑셀/한글 | <kbd className="px-0.5 py-px rounded bg-gray-100 text-[9px] font-mono">Ctrl+V</kbd>
              </span>
            </div>
            <input type="file" accept="image/*,.csv,.xlsx,.xls,.pdf,.doc,.docx,.hwp,.hwpx,.txt" className="hidden" disabled={ocrProcessing} onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              await handleFileDrop(file);
              e.target.value = "";
            }} />
          </label>

          <div className="flex items-center gap-1.5">
            {[
              { id: "import-is-sample", label: "샘플", bg: "bg-amber-100 text-amber-700" },
              { id: "import-is-group", label: "공구", bg: "bg-pink-100 text-pink-700" },
              { id: "import-is-domestic", label: "자사몰", bg: "bg-blue-100 text-blue-700" },
              { id: "import-is-etc", label: "기타", bg: "bg-gray-200 text-gray-700" },
            ].map((opt) => (
              <label key={opt.id} className="flex items-center gap-0.5 text-[11px] text-gray-600 cursor-pointer select-none">
                <input id={opt.id} type="checkbox" className="w-3 h-3 cursor-pointer" onChange={(e) => {
                  if (e.target.checked) {
                    ["import-is-sample", "import-is-group", "import-is-domestic", "import-is-etc"]
                      .filter((x) => x !== opt.id)
                      .forEach((x) => { const el = document.getElementById(x) as HTMLInputElement; if (el) el.checked = false; });
                  }
                }} />
                <span className={`px-1 py-px rounded text-[10px] font-medium ${opt.bg}`}>{opt.label}</span>
              </label>
            ))}
          </div>

          <div className="relative">
            <select id="import-store" className="text-[11px] border border-gray-300 rounded-lg px-1.5 py-1 pr-14 appearance-none bg-white" defaultValue="">
              <option value="" disabled>판매사 선택</option>
              {stores
                .filter((s) => !["공구주문", "엑셀등록", "수기주문"].includes(s.name))
                .map((s) => (<option key={s.id} value={`id:${s.id}`}>{s.name}</option>))}
            </select>
            <label className="absolute right-0 top-0 h-full px-1.5 flex items-center bg-gray-100 border border-gray-300 rounded-r-lg text-[11px] font-medium text-gray-700 hover:bg-gray-200 cursor-pointer">
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
            <select id="export-store" className="text-[11px] border border-gray-300 rounded-lg px-1.5 py-1 pr-[72px] appearance-none bg-white" defaultValue="">
              <option value="" disabled>판매사 선택</option>
              <option value="__all__">전체</option>
              {stores
                .filter((s) => !["공구주문", "엑셀등록", "수기주문"].includes(s.name))
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
                className="h-full px-1.5 flex items-center bg-green-100 border border-green-300 rounded-r-lg text-[11px] font-medium text-green-700 hover:bg-green-200 cursor-pointer">
                송장번호조회
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Selection actions bar — only visible when items are selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-xs font-bold text-blue-700">{selected.size}건 선택</span>
          <div className="w-px h-4 bg-blue-200" />
          <select onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v !== "") bulkUpdateChannel(v === "__none__" ? "" : v); }}
            defaultValue=""
            className="text-[11px] border border-blue-200 rounded px-1.5 py-0.5 bg-white w-[120px]">
            <option value="" disabled>판매방식 변경</option>
            <option value="__none__">자사몰</option>
            <option value="group">공구주문</option>
            <option value="phone">전화주문</option>
            <option value="sample">샘플</option>
            <option value="etc">기타</option>
          </select>
          <select onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) bulkUpdateStore(v); }}
            defaultValue=""
            className="text-[11px] border border-blue-200 rounded px-1.5 py-0.5 bg-white w-[120px]">
            <option value="" disabled>판매사 변경</option>
            {stores
              .filter((s) => !["공구주문", "엑셀등록", "수기주문"].includes(s.name))
              .map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <select onChange={(e) => { if (e.target.value) handleAssignSupplier(e.target.value); e.target.value = ""; }}
            className="text-[11px] border border-blue-200 rounded px-1.5 py-0.5 bg-white w-[120px]">
            <option value="">공급사 변경</option>
            {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button
            onClick={async () => {
              if (selected.size === 0) return;
              if (!confirm(`선택한 ${selected.size}건을 수동 발주완료 처리합니다.\n\n진행하시겠습니까?`)) return;
              const res = await fetch("/admin/api/orders", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: Array.from(selected), updates: { shipping_status: "ordered" } }),
              });
              const data = await res.json();
              if (res.ok) {
                alert(`${data.updated}건 발주완료 처리됨`);
                setSelected(new Set());
                fetchOrders();
              } else alert(`오류: ${data.error}`);
            }}
            className="px-2.5 py-1 bg-amber-500 text-white text-[11px] font-medium rounded hover:bg-amber-600 cursor-pointer"
          >
            수동 발주완료 ({selected.size})
          </button>
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
            className="px-2.5 py-1 bg-blue-600 text-white text-[11px] font-medium rounded hover:bg-blue-700 cursor-pointer"
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
            className="px-2.5 py-1 bg-red-600 text-white text-[11px] font-medium rounded hover:bg-red-700 cursor-pointer"
          >
            선택 삭제 ({selected.size})
          </button>
        </div>
      )}

      {/* ═══════════════════ TABLE ═══════════════════ */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : (
          <>
          <table className="w-full text-sm table-fixed border-separate border-spacing-0">
            <colgroup>
              <col className="w-[36px]" />{/* checkbox */}
              <col className="w-[36px]" />{/* No */}
              <col className="w-[120px]" />{/* 주문번호 */}
              <col className="w-[180px]" />{/* 상품/옵션 */}
              <col className="w-[110px]" />{/* 주문자 */}
              <col className="w-[160px]" />{/* 배송주소 */}
              <col className="w-[64px]" />{/* 판매방식 */}
              <col className="w-[80px]" />{/* 판매사 */}
              <col className="w-[90px]" />{/* 공급사 */}
              <col className="w-[36px]" />{/* 수량 */}
              <col className="w-[72px]" />{/* 공급가 */}
              <col className="w-[64px]" />{/* 공급배송비 */}
              <col className="w-[72px]" />{/* 판매가 */}
              <col className="w-[64px]" />{/* 판매배송비 */}
              <col className="w-[56px]" />{/* 입금 */}
              <col className="w-[130px]" />{/* 송장 */}
              <col className="w-[64px]" />{/* 발주종류 */}
              <col className="w-[100px]" />{/* 발주상태 */}
              <col className="w-[72px]" />{/* 배송상태 */}
              <col className="w-[40px]" />{/* CS */}
              <col className="w-[80px]" />{/* 주문일 */}
            </colgroup>
            <thead className="sticky top-0 z-10">
              {/* Parent header row for column groups */}
              <tr className="text-[10px] text-gray-400">
                <th colSpan={10} className="py-0.5 bg-gray-50 border-b border-gray-100"></th>
                <th colSpan={2} className="py-0.5 text-center font-semibold text-blue-500 bg-blue-50 border-b border-gray-100 border-x border-blue-100/50">공급</th>
                <th colSpan={2} className="py-0.5 text-center font-semibold text-green-600 bg-green-50 border-b border-gray-100 border-x border-green-100/50">판매</th>
                <th colSpan={7} className="py-0.5 bg-gray-50 border-b border-gray-100"></th>
              </tr>
              <tr className="text-[11px] text-gray-500">
                <th className="px-2 py-2 w-8 bg-gray-50 border-b border-gray-100">
                  <input type="checkbox" checked={pagedOrders.length > 0 && pagedOrders.every((o) => selected.has(o.id))} onChange={toggleAll} className="rounded w-3.5 h-3.5" />
                </th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">No</th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">주문번호</th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">상품/옵션</th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">주문자/수취인</th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">배송주소</th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">판매방식</th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">판매사</th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">공급사</th>
                <th className="text-right px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">수량</th>
                <th className="text-right px-1.5 py-2 font-medium bg-blue-50 border-l border-blue-100/50 border-b border-gray-100">상품가</th>
                <th className="text-right px-1.5 py-2 font-medium bg-blue-50 border-r border-blue-100/50 border-b border-gray-100">배송비</th>
                <th className="text-right px-1.5 py-2 font-medium bg-green-50 border-l border-green-100/50 border-b border-gray-100">상품가</th>
                <th className="text-right px-1.5 py-2 font-medium bg-green-50 border-r border-green-100/50 border-b border-gray-100">배송비</th>
                <th className="text-center px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">입금</th>
                <th className="text-left px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">송장</th>
                <th className="text-center px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">발주종류</th>
                <th className="text-center px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">발주상태</th>
                <th className="text-center px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">배송</th>
                <th className="text-center px-1.5 py-2 font-medium bg-gray-50 border-b border-gray-100">CS</th>
                <th className="text-right px-2 py-2 font-medium bg-gray-50 border-b border-gray-100">주문일</th>
              </tr>
              {/* Column filters — compact */}
              <tr className="text-[10px] [&>th]:bg-gray-50 [&>th]:border-b [&>th]:border-gray-200" style={{ boxShadow: "0 2px 4px -1px rgba(0,0,0,0.1)" }}>
                {/* 1. Reset button */}
                <th className="px-1 py-0.5">
                  {(colFilterOrderNo || colFilterProduct || colFilterCustomer || colFilterAddress || colFilterAddrStatus || colFilterChannel || colFilterPayment || colFilterPOType || colFilterPOStatus || colFilterQty || colFilterAmount || colFilterTracking || filterStore || filterSupplier || filterStatus) && (
                    <button
                      onClick={() => {
                        setColFilterOrderNo(""); setColFilterProduct(""); setColFilterCustomer(""); setColFilterAddress(""); setColFilterAddrStatus("");
                        setColFilterChannel(""); setColFilterPayment(""); setColFilterPOType(""); setColFilterPOStatus("");
                        setColFilterQty(""); setColFilterAmount(""); setColFilterTracking("");
                        setFilterStore(""); setFilterSupplier(""); setFilterStatus("");
                      }}
                      title="필터 초기화"
                      className="text-[10px] text-red-500 hover:text-red-700 cursor-pointer font-bold"
                    >X</button>
                  )}
                </th>
                {/* 2. empty (No) */}
                <th></th>
                {/* 3. 주문번호 input */}
                <th className="px-0.5 py-0.5">
                  <input type="text" value={colFilterOrderNo} onChange={(e) => setColFilterOrderNo(e.target.value)}
                    placeholder="주문번호" className="w-full text-[10px] border border-gray-200 rounded px-1 py-px bg-white" />
                </th>
                {/* 4. 상품/옵션 input */}
                <th className="px-0.5 py-0.5">
                  <input type="text" value={colFilterProduct} onChange={(e) => setColFilterProduct(e.target.value)}
                    placeholder="상품/옵션" className="w-full text-[10px] border border-gray-200 rounded px-1 py-px bg-white" />
                </th>
                {/* 5. 이름/연락처 input */}
                <th className="px-0.5 py-0.5">
                  <input type="text" value={colFilterCustomer} onChange={(e) => setColFilterCustomer(e.target.value)}
                    placeholder="이름/연락처" className="w-full text-[10px] border border-gray-200 rounded px-1 py-px bg-white" />
                </th>
                {/* 6. 주소 input + 검증상태 필터 */}
                <th className="px-0.5 py-0.5">
                  <div className="flex gap-0.5">
                    <input type="text" value={colFilterAddress} onChange={(e) => setColFilterAddress(e.target.value)}
                      placeholder="주소" className="flex-1 min-w-0 text-[10px] border border-gray-200 rounded px-1 py-px bg-white" />
                    <select value={colFilterAddrStatus} onChange={(e) => setColFilterAddrStatus(e.target.value)}
                      className="text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white shrink-0"
                      style={{ width: "auto", maxWidth: "52px" }}>
                      <option value="">●</option>
                      <option value="valid">🟢</option>
                      <option value="invalid">🔴</option>
                      <option value="unverified">🟡</option>
                    </select>
                  </div>
                </th>
                {/* 7. 판매방식 select */}
                <th className="px-0.5 py-0.5">
                  <select value={colFilterChannel} onChange={(e) => setColFilterChannel(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">전체</option>
                    <option value="group">공구</option>
                    <option value="phone">전화</option>
                    <option value="sample">샘플</option>
                    <option value="etc">기타</option>
                    <option value="domestic">자사몰</option>
                  </select>
                </th>
                {/* 8. 판매사 select */}
                <th className="px-0.5 py-0.5">
                  <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">전체</option>
                    {stores
                      .filter((s) => !["공구주문", "엑셀등록", "수기주문"].includes(s.name))
                      .map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                </th>
                {/* 9. 공급사 select */}
                <th className="px-0.5 py-0.5">
                  <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">전체</option>
                    <option value="__none__">미배정</option>
                    {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                </th>
                {/* 10. 수량 select */}
                <th className="px-0.5 py-0.5">
                  <select value={colFilterQty} onChange={(e) => setColFilterQty(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">-</option>
                    <option value="1">1</option>
                    <option value="2+">2+</option>
                  </select>
                </th>
                {/* 11. 공급가 */}
                <th className="!bg-blue-50"></th>
                {/* 12. 공급배송비 */}
                <th className="!bg-blue-50"></th>
                {/* 13. 판매가 select */}
                <th className="px-0.5 py-0.5 !bg-green-50">
                  <select value={colFilterAmount} onChange={(e) => setColFilterAmount(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">-</option>
                    <option value="under10k">~1만</option>
                    <option value="10k_50k">1~5만</option>
                    <option value="50k_100k">5~10만</option>
                    <option value="over100k">10만~</option>
                  </select>
                </th>
                {/* 14. 판매배송비 */}
                <th className="!bg-green-50"></th>
                {/* 15. 입금 select */}
                <th className="px-0.5 py-0.5 text-center">
                  <select value={colFilterPayment} onChange={(e) => setColFilterPayment(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">-</option>
                    <option value="paid">완료</option>
                    <option value="unpaid">미입금</option>
                  </select>
                </th>
                {/* 16. 송장 tracking filter select */}
                <th className="px-0.5 py-0.5">
                  <select value={colFilterTracking} onChange={(e) => setColFilterTracking(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">-</option>
                    <option value="missing">미입력</option>
                  </select>
                </th>
                {/* 17. 발주종류 select */}
                <th className="px-0.5 py-0.5 text-center">
                  <select value={colFilterPOType} onChange={(e) => setColFilterPOType(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">-</option>
                    <option value="type_auto">자동발주</option>
                    <option value="type_manual">수동발주</option>
                  </select>
                </th>
                {/* 18. 발주상태 select */}
                <th className="px-0.5 py-0.5 text-center">
                  <select value={colFilterPOStatus} onChange={(e) => setColFilterPOStatus(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">-</option>
                    <option value="no_po">미발주</option>
                    <option value="mail_sent">이메일 발송</option>
                    <option value="mail_read">이메일 열람</option>
                    <option value="tracking">송장번호 등록</option>
                  </select>
                </th>
                {/* 18. 배송상태 select */}
                <th className="px-0.5 py-0.5 text-center">
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-px bg-white">
                    <option value="">-</option>
                    <option value="pending">입금전</option>
                    <option value="ordered">준비중</option>
                    <option value="shipping">배송중</option>
                    <option value="delivered">완료</option>
                    <option value="cancelled">취소</option>
                  </select>
                </th>
                {/* 19. empty (CS) */}
                <th></th>
                {/* 20. empty (주문일) */}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={20} className="p-12 text-center text-gray-400">조건에 맞는 주문이 없습니다.</td></tr>
              ) : pagedOrders.map((o, idx) => (
                <OrderRow
                  key={o.id}
                  o={o}
                  idx={idx}
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
                  saving={false}
                  onOpenCs={openCs}
                  addrStatus={addrResults[o.id]}
                  onEditAddress={handleEditAddress}
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
          <span>판매금액: <b className="text-gray-900">{stats.totalAmount.toLocaleString()}원</b></span>
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
              <button onClick={submitCs} disabled={csSaving} className="px-5 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer disabled:opacity-50">
                {csSaving ? "처리 중..." : "처리 완료"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Address Edit Modal */}
      {addrEditOrder && (
        <AddressEditModal
          order={addrEditOrder}
          onClose={() => setAddrEditOrder(null)}
          onSave={handleSaveAddress}
        />
      )}
    </div>
  );
}
