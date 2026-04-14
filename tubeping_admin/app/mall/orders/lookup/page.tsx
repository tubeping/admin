"use client";

import { useState, useEffect, useCallback } from "react";

interface Store { id: string; name: string; mall_id: string; status: string; }
interface Supplier { id: string; name: string; email: string; }

interface Order {
  id: string;
  cafe24_order_id: string;
  cafe24_order_item_code: string;
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
  supplier_id: string | null;
  memo: string | null;
  stores: { name: string; mall_id: string } | null;
  suppliers: { name: string; email: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "대기", ordered: "발주완료", shipping: "배송중", delivered: "배송완료",
  cancelled: "취소", refunded: "환불완료", returned: "반품완료", exchanged: "교환완료",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600", ordered: "bg-blue-100 text-blue-700",
  shipping: "bg-yellow-100 text-yellow-700", delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
  refunded: "bg-red-50 text-red-600 border border-red-200",
  returned: "bg-orange-50 text-orange-600 border border-orange-200",
  exchanged: "bg-purple-50 text-purple-600 border border-purple-200",
};

const SHIPPING_COMPANIES = ["CJ대한통운", "한진택배", "롯데택배", "우체국택배", "로젠택배", "경동택배", "대신택배"];

function formatDate(d: string) { return d?.slice(0, 10) || ""; }
function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function normPhone(s: string) { return (s || "").replace(/[^0-9]/g, ""); }

export default function OrdersLookupPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStore, setFilterStore] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [dateFrom, setDateFrom] = useState(daysAgo(90));
  const [dateTo, setDateTo] = useState(today());
  const [searchKeyword, setSearchKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");

  // 송장 인라인 편집 상태
  const [trackingEdit, setTrackingEdit] = useState<Record<string, { company: string; number: string }>>({});
  // CS 처리 모달 상태
  const [csModalOrder, setCsModalOrder] = useState<Order | null>(null);
  const [csAction, setCsAction] = useState<"refunded" | "returned" | "exchanged">("refunded");
  const [csNote, setCsNote] = useState("");
  const [saving, setSaving] = useState(false);

  const patchOrder = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], updates }),
    });
    return res.ok;
  };

  const saveTracking = async (id: string) => {
    const edit = trackingEdit[id];
    if (!edit || !edit.number.trim()) return;
    setSaving(true);
    await patchOrder(id, { tracking_number: edit.number.trim(), shipping_company: edit.company || "CJ대한통운", shipping_status: "shipping" });
    setTrackingEdit((p) => { const n = { ...p }; delete n[id]; return n; });
    setSaving(false);
    fetchOrders();
  };

  const openCs = (o: Order) => {
    setCsModalOrder(o);
    setCsAction("refunded");
    setCsNote("");
  };

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

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set("status", filterStatus);
    if (filterStore) params.set("store_id", filterStore);
    if (filterSupplier) params.set("supplier_id", filterSupplier);
    if (dateFrom) params.set("start_date", dateFrom);
    if (dateTo) params.set("end_date", dateTo);
    params.set("limit", "1000");

    const res = await fetch(`/admin/api/orders?${params}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    let list: Order[] = data.orders || [];

    if (appliedKeyword) {
      const kw = appliedKeyword.toLowerCase().trim();
      const kwDigits = normPhone(appliedKeyword);
      list = list.filter((o) => {
        const phoneMatch = kwDigits.length >= 4 && (
          normPhone(o.buyer_phone).includes(kwDigits) ||
          normPhone(o.receiver_phone).includes(kwDigits)
        );
        return phoneMatch ||
          o.product_name?.toLowerCase().includes(kw) ||
          o.cafe24_order_id?.toLowerCase().includes(kw) ||
          o.buyer_name?.toLowerCase().includes(kw) ||
          o.receiver_name?.toLowerCase().includes(kw) ||
          o.tracking_number?.toLowerCase().includes(kw);
      });
    }

    setOrders(list);
    setLoading(false);
  }, [filterStatus, filterStore, filterSupplier, dateFrom, dateTo, appliedKeyword]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => {
    fetch("/admin/api/stores").then((r) => r.json()).then((d) => setStores(d.stores || []));
    fetch("/admin/api/suppliers?status=active").then((r) => r.json()).then((d) => setSuppliers(d.suppliers || []));
  }, []);

  const handleSearch = () => setAppliedKeyword(searchKeyword);
  const handleReset = () => {
    setFilterStatus(""); setFilterStore(""); setFilterSupplier("");
    setDateFrom(daysAgo(90)); setDateTo(today());
    setSearchKeyword(""); setAppliedKeyword("");
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">주문 조회</h1>
          <p className="text-xs text-gray-500 mt-1">고객 CS 응대용 — 구매자명·연락처·주문번호로 상품 단위로 검색합니다.</p>
        </div>
        <span className="text-sm text-gray-500">결과 {orders.length}건</span>
      </div>

      {/* 필터 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">판매처</label>
            <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm">
              <option value="">전체</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">공급사</label>
            <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm">
              <option value="">전체</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">주문상태</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm">
              <option value="">전체</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">시작일</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">종료일</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            placeholder="구매자명, 연락처, 주문번호, 상품명, 송장번호"
            className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm"
          />
          <button onClick={handleSearch} className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-black cursor-pointer">검색</button>
          <button onClick={handleReset} className="px-4 py-2 bg-white border border-gray-200 text-sm rounded hover:bg-gray-50 cursor-pointer">초기화</button>
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">불러오는 중...</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">조회된 주문이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">주문일</th>
                  <th className="px-3 py-2 text-left font-medium">판매처</th>
                  <th className="px-3 py-2 text-left font-medium">주문번호</th>
                  <th className="px-3 py-2 text-left font-medium">상품 / 옵션</th>
                  <th className="px-3 py-2 text-right font-medium">수량</th>
                  <th className="px-3 py-2 text-left font-medium">구매자</th>
                  <th className="px-3 py-2 text-left font-medium">수령인 / 배송지</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">공급사</th>
                  <th className="px-3 py-2 text-left font-medium">송장</th>
                  <th className="px-3 py-2 text-center font-medium">CS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => {
                  const edit = trackingEdit[o.id];
                  const editing = !!edit;
                  return (
                  <tr key={o.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{formatDate(o.order_date)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{o.stores?.name || "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-gray-600">{o.cafe24_order_id}</td>
                    <td className="px-3 py-2 max-w-[280px]">
                      <div className="text-gray-900 line-clamp-2">{o.product_name}</div>
                      {o.option_text && <div className="text-xs text-gray-500 mt-0.5">{o.option_text}</div>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">{o.quantity}</td>
                    <td className="px-3 py-2 max-w-[150px]">
                      <div className="text-gray-900">{o.buyer_name || <span className="text-gray-300">-</span>}</div>
                      <div className="text-xs font-mono text-gray-500">{o.buyer_phone || "-"}</div>
                    </td>
                    <td className="px-3 py-2 max-w-[260px]">
                      <div className="text-gray-700">
                        {o.receiver_name || <span className="text-gray-300">-</span>}
                        {o.receiver_phone && <span className="text-xs text-gray-400 font-mono ml-1">{o.receiver_phone}</span>}
                      </div>
                      <div className="text-xs text-gray-500 line-clamp-2">{o.receiver_address || "-"}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLE[o.shipping_status] || "bg-gray-100 text-gray-600"}`}>
                        {STATUS_LABEL[o.shipping_status] || o.shipping_status}
                      </span>
                      {o.memo && (
                        <div className="text-[10px] text-gray-400 mt-1 max-w-[140px] line-clamp-2" title={o.memo}>{o.memo}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{o.suppliers?.name || "-"}</td>
                    <td className="px-3 py-2 text-xs">
                      {editing ? (
                        <div className="flex flex-col gap-1 min-w-[160px]">
                          <select value={edit.company} onChange={(e) => setTrackingEdit((p) => ({ ...p, [o.id]: { ...edit, company: e.target.value } }))}
                            className="border border-gray-300 rounded px-1 py-0.5 text-xs">
                            {SHIPPING_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input type="text" value={edit.number} onChange={(e) => setTrackingEdit((p) => ({ ...p, [o.id]: { ...edit, number: e.target.value } }))}
                            placeholder="송장번호" className="border border-gray-300 rounded px-1 py-0.5 text-xs font-mono" autoFocus />
                          <div className="flex gap-1">
                            <button disabled={saving} onClick={() => saveTracking(o.id)} className="flex-1 bg-gray-900 text-white text-[10px] py-0.5 rounded hover:bg-black cursor-pointer disabled:opacity-50">저장</button>
                            <button onClick={() => setTrackingEdit((p) => { const n = { ...p }; delete n[o.id]; return n; })} className="flex-1 bg-white border border-gray-300 text-[10px] py-0.5 rounded hover:bg-gray-50 cursor-pointer">취소</button>
                          </div>
                        </div>
                      ) : o.tracking_number ? (
                        <button onClick={() => setTrackingEdit((p) => ({ ...p, [o.id]: { company: o.shipping_company || "CJ대한통운", number: o.tracking_number } }))}
                          className="text-left hover:bg-gray-100 rounded px-1 py-0.5 cursor-pointer">
                          <div className="text-gray-500">{o.shipping_company}</div>
                          <div className="font-mono text-gray-700">{o.tracking_number}</div>
                        </button>
                      ) : (
                        <button onClick={() => setTrackingEdit((p) => ({ ...p, [o.id]: { company: "CJ대한통운", number: "" } }))}
                          className="text-[11px] text-blue-600 hover:underline cursor-pointer">+ 송장 입력</button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <button onClick={() => openCs(o)} className="text-[11px] px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer">
                        CS 처리
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CS 처리 모달 */}
      {csModalOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setCsModalOrder(null)}>
          <div className="bg-white rounded-2xl w-[520px] max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">CS 처리</h2>
              <p className="text-xs text-gray-500 mt-1">주문번호 {csModalOrder.cafe24_order_id} · {csModalOrder.product_name}</p>
              <p className="text-xs text-gray-500">구매자: {csModalOrder.buyer_name || "-"} · {csModalOrder.buyer_phone || "-"}</p>
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
