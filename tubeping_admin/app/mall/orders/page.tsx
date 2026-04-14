"use client";

import { useState, useEffect, useCallback } from "react";

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
  stores: { name: string; mall_id: string } | null;
  suppliers: { name: string; email: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "대기", ordered: "발주완료", shipping: "배송중", delivered: "배송완료", cancelled: "취소",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600", ordered: "bg-blue-100 text-blue-700",
  shipping: "bg-yellow-100 text-yellow-700", delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

function formatDate(d: string) { return d?.slice(0, 10) || ""; }
function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 필터
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterNoTracking, setFilterNoTracking] = useState(false);
  const [filterNoSupplier, setFilterNoSupplier] = useState(false);
  const [dateFrom, setDateFrom] = useState(daysAgo(60));
  const [dateTo, setDateTo] = useState(today());
  const [searchKeyword, setSearchKeyword] = useState("");

  // 발주 상태 탭
  const [poTab, setPoTab] = useState<"all" | "no_po" | "has_po">("all");

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
    let list: Order[] = data.orders || [];

    // 클라이언트 필터
    if (filterNoTracking) list = list.filter((o) => !o.tracking_number && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered");
    if (filterNoSupplier || filterSupplier === "__none__") list = list.filter((o) => !o.supplier_id);
    if (poTab === "no_po") list = list.filter((o) => !o.purchase_order_id && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered");
    if (poTab === "has_po") list = list.filter((o) => o.purchase_order_id);
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      list = list.filter((o) =>
        o.product_name?.toLowerCase().includes(kw) ||
        o.cafe24_order_id?.toLowerCase().includes(kw) ||
        o.buyer_name?.toLowerCase().includes(kw) ||
        o.receiver_name?.toLowerCase().includes(kw)
      );
    }

    setOrders(list);
    setTotal(data.total || 0);
    setLoading(false);
  }, [filterStatus, filterStore, filterSupplier, filterNoTracking, filterNoSupplier, dateFrom, dateTo, poTab, searchKeyword]);

  const fetchStores = async () => { const r = await fetch("/admin/api/stores"); const d = await r.json(); setStores(d.stores || []); };
  const sb_patch = async (orderId: string, status: string) => {
    await fetch("/admin/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [orderId], updates: { auto_assign_status: status } }) });
  };
  const fetchSuppliers = async () => { const r = await fetch("/admin/api/suppliers?status=active"); const d = await r.json(); setSuppliers(d.suppliers || []); };

  useEffect(() => { fetchOrders(); fetchStores(); fetchSuppliers(); }, [fetchOrders]);

  // 카페24 주문 수집
  const handleSync = async () => {
    setSyncing(true);
    await fetch(`/admin/api/cafe24/orders?start_date=${dateFrom}&end_date=${dateTo}`);
    await fetchOrders();
    setSyncing(false);
  };

  // 카페24 송장 연동
  const handleShipmentSync = async () => {
    setSyncing(true);
    await fetch("/admin/api/cafe24/shipments", { method: "POST", body: "{}" });
    await fetchOrders();
    setSyncing(false);
  };

  // 공급사 자동배정
  const handleAutoAssign = async () => {
    setSyncing(true);
    const res = await fetch("/admin/api/orders/auto-assign", { method: "POST" });
    const data = await res.json();
    alert(`자동 배정: ${data.assigned}건 완료, ${data.failed}건 실패`);
    await fetchOrders();
    setSyncing(false);
  };

  // 공급사 수동 배정
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

  // 발주서 생성 + 이메일 발송
  const handleCreatePOAndSend = async (supplierId: string) => {
    const orderIds = Array.from(selected);
    if (orderIds.length === 0) return;

    // 이미 발주서가 있는 주문 체크
    const alreadyPO = orders.filter(o => orderIds.includes(o.id) && o.purchase_order_id);
    if (alreadyPO.length > 0) {
      if (!confirm(`${alreadyPO.length}건은 이미 발주서가 생성되어 있습니다.\n중복 생성하시겠습니까?`)) return;
    }
    const res = await fetch("/admin/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier_id: supplierId, order_ids: orderIds }),
    });
    const data = await res.json();
    if (data.purchase_order) {
      const emailRes = await fetch("/admin/api/purchase-orders/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchase_order_id: data.purchase_order.id }),
      });
      const emailData = await emailRes.json();
      const supplier = suppliers.find((s) => s.id === supplierId);
      alert(
        `발주서 생성: ${data.purchase_order.po_number}\n비밀번호: ${data.purchase_order.access_password}\n공급사: ${supplier?.name || ""}\n메일: ${emailData.success ? emailData.email + " 발송완료" : "실패"}`
      );
    }
    setSelected(new Set());
    fetchOrders();
  };

  // 일괄 발주
  const handleBulkPO = async () => {
    const untrackedOrders = orders.filter(
      (o) => !o.tracking_number && o.supplier_id && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered" && !o.purchase_order_id
    );
    if (untrackedOrders.length === 0) { alert("발주 대상 없음 (공급사 배정 + 미발주 건이 없습니다)"); return; }
    const grouped: Record<string, string[]> = {};
    for (const o of untrackedOrders) { if (!o.supplier_id) continue; if (!grouped[o.supplier_id]) grouped[o.supplier_id] = []; grouped[o.supplier_id].push(o.id); }
    const results: string[] = [];
    for (const [supplierId, orderIds] of Object.entries(grouped)) {
      const supplier = suppliers.find((s) => s.id === supplierId);
      const res = await fetch("/admin/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplier_id: supplierId, order_ids: orderIds }) });
      const data = await res.json();
      if (data.purchase_order) {
        await fetch("/admin/api/purchase-orders/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchase_order_id: data.purchase_order.id }) });
        results.push(`${supplier?.name}: ${orderIds.length}건 → ${data.purchase_order.po_number}`);
      }
    }
    alert(`일괄 발주 완료:\n\n${results.join("\n")}`);
    fetchOrders();
  };

  const toggleSelect = (id: string) => { setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const toggleAll = () => { if (selected.size === orders.length) setSelected(new Set()); else setSelected(new Set(orders.map((o) => o.id))); };

  // 통계
  const stats = {
    total, displayed: orders.length,
    pending: orders.filter((o) => o.shipping_status === "pending").length,
    noTracking: orders.filter((o) => !o.tracking_number && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered").length,
    noSupplier: orders.filter((o) => !o.supplier_id && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered").length,
    noPO: orders.filter((o) => !o.purchase_order_id && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered").length,
    unsynced: orders.filter((o) => o.tracking_number && !o.cafe24_shipping_synced).length,
    totalQty: orders.reduce((s, o) => s + o.quantity, 0),
    totalAmount: orders.reduce((s, o) => s + o.order_amount, 0),
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-gray-900">주문 현황</h1>
        <div className="text-sm text-gray-500">
          전체 <span className="font-bold text-gray-900">{stats.total}</span>건
          {stats.displayed !== stats.total && <> · 필터 <span className="font-bold text-blue-600">{stats.displayed}</span>건</>}
        </div>
      </div>

      {/* 필터 영역 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="grid grid-cols-6 gap-3 mb-3">
          {/* 판매사 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">판매사</label>
            <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option value="">전체</option>
              {stores.filter((s) => s.status === "active").map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          {/* 공급사 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">공급사</label>
            <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option value="">전체</option>
              <option value="__none__">미배정</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          {/* 상태 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">주문상태</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option value="">전체</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
          </div>
          {/* 날짜 시작 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">시작일</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
          </div>
          {/* 날짜 끝 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">종료일</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
          </div>
          {/* 빠른 날짜 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">빠른선택</label>
            <div className="flex gap-1 flex-wrap">
              {[
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

        {/* 검색 + 체크박스 필터 */}
        <div className="flex items-center gap-4">
          <input
            value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-64"
            placeholder="상품명, 주문번호, 주문자 검색"
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
            <button onClick={() => { setFilterStatus(""); setFilterStore(""); setFilterSupplier(""); setFilterNoTracking(false); setFilterNoSupplier(false); setDateFrom(daysAgo(60)); setDateTo(today()); setSearchKeyword(""); setPoTab("all"); }}
              className="px-3 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">초기화</button>
          </div>
        </div>
      </div>

      {/* 상단 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
        {[
          { label: "주문수량", value: `${stats.totalQty}개` },
          { label: "주문금액", value: `₩${stats.totalAmount.toLocaleString()}` },
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

      {/* 액션 바 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* 발주 탭 */}
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

        {stats.noSupplier > 0 && (
          <button onClick={handleAutoAssign} disabled={syncing}
            className="px-3 py-1.5 bg-white border border-orange-300 text-xs font-medium text-orange-700 rounded-lg hover:bg-orange-50 cursor-pointer disabled:opacity-50">
            공급사 자동배정 ({stats.noSupplier})
          </button>
        )}

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

        {/* 엑셀 등록 */}
        <div className="relative ml-auto">
          <select id="import-store" className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 pr-16 appearance-none bg-white" defaultValue="">
            <option value="" disabled>판매사 선택</option>
            <option value="name:전화주문">전화주문</option>
            <option value="name:수기주문">수기주문</option>
            {stores.filter((s) => s.status === "active").map((s) => (<option key={s.id} value={`id:${s.id}`}>{s.name}</option>))}
          </select>
          <label className="absolute right-0 top-0 h-full px-2 flex items-center bg-gray-100 border border-gray-300 rounded-r-lg text-xs font-medium text-gray-700 hover:bg-gray-200 cursor-pointer">
            수기등록
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              const sel = document.getElementById("import-store") as HTMLSelectElement;
              if (!sel.value) {
                alert("판매사를 먼저 선택해주세요");
                e.target.value = "";
                return;
              }
              const fd = new FormData();
              fd.append("file", file);
              if (sel.value.startsWith("id:")) fd.append("store_id", sel.value.slice(3));
              else fd.append("store_name", sel.value.slice(5));
              const res = await fetch("/admin/api/orders/import", { method: "POST", body: fd });
              const data = await res.json();
              if (res.ok) { alert(`${data.imported}건 등록`); fetchOrders(); } else alert(`오류: ${data.error}`);
              e.target.value = "";
            }} />
          </label>
        </div>

        {/* 송장 다운로드 */}
        <div className="relative">
          <select id="export-store" className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 pr-24 appearance-none bg-white" defaultValue="">
            <option value="" disabled>판매사 선택</option>
            <option value="__all__">전체</option>
            {stores.filter((s) => s.status === "active").map((s) => (<option key={s.id} value={s.id} data-name={s.name}>{s.name}</option>))}
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
              송장↓
            </button>
          </div>
        </div>

        {/* 선택 액션 */}
        {selected.size > 0 && (
          <>
            <div className="w-px h-5 bg-gray-300" />
            <span className="text-xs font-bold text-blue-600">{selected.size}건</span>
            <select onChange={(e) => { if (e.target.value) handleAssignSupplier(e.target.value); e.target.value = ""; }}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5">
              <option value="">공급사 배정</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
            <button
              onClick={() => {
                // 선택된 주문의 공급사 확인
                const selectedOrders = orders.filter(o => selected.has(o.id));
                const supplierIds = [...new Set(selectedOrders.map(o => o.supplier_id).filter(Boolean))];

                if (supplierIds.length === 0) {
                  alert("선택한 주문에 배정된 공급사가 없습니다.\n먼저 공급사를 배정해주세요.");
                  return;
                }

                if (supplierIds.length > 1) {
                  // 여러 공급사 → 공급사별로 자동 분리
                  const groups: Record<string, string[]> = {};
                  for (const o of selectedOrders) {
                    if (!o.supplier_id) continue;
                    if (!groups[o.supplier_id]) groups[o.supplier_id] = [];
                    groups[o.supplier_id].push(o.id);
                  }
                  const summary = Object.entries(groups).map(([sid, ids]) => {
                    const sup = suppliers.find(s => s.id === sid);
                    return `${sup?.name}: ${ids.length}건`;
                  }).join("\n");

                  if (!confirm(`공급사별로 발주서를 생성합니다.\n\n${summary}\n\n진행하시겠습니까?`)) return;

                  (async () => {
                    for (const [sid, ids] of Object.entries(groups)) {
                      setSelected(new Set(ids));
                      await handleCreatePOAndSend(sid);
                    }
                    setSelected(new Set());
                    fetchOrders();
                  })();
                } else {
                  // 단일 공급사
                  const sup = suppliers.find(s => s.id === supplierIds[0]);
                  if (confirm(`발주서를 생성하고 메일을 발송합니다.\n\n공급사: ${sup?.name}\n주문: ${selected.size}건\n\n진행하시겠습니까?`)) {
                    handleCreatePOAndSend(supplierIds[0] as string);
                  }
                }
              }}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 cursor-pointer"
            >
              선택 발주 ({selected.size})
            </button>
          </>
        )}
      </div>

      {/* 주문 리스트 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            조건에 맞는 주문이 없습니다.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={selected.size === orders.length && orders.length > 0} onChange={toggleAll} className="rounded" />
                </th>
                <th className="text-left px-2 py-2.5 font-medium">No</th>
                <th className="text-left px-2 py-2.5 font-medium">주문번호</th>
                <th className="text-left px-2 py-2.5 font-medium">상품정보</th>
                <th className="text-left px-2 py-2.5 font-medium">주문자/수령인</th>
                <th className="text-left px-2 py-2.5 font-medium">판매사</th>
                <th className="text-left px-2 py-2.5 font-medium">공급사</th>
                <th className="text-right px-2 py-2.5 font-medium">수량</th>
                <th className="text-right px-2 py-2.5 font-medium">금액</th>
                <th className="text-left px-2 py-2.5 font-medium">택배사/송장</th>
                <th className="text-center px-2 py-2.5 font-medium">발주</th>
                <th className="text-center px-2 py-2.5 font-medium">상태</th>
                <th className="text-right px-3 py-2.5 font-medium">주문일</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, idx) => {
                const noTrack = !o.tracking_number && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered";
                const noSup = !o.supplier_id;
                const noPO = !o.purchase_order_id && o.shipping_status !== "cancelled" && o.shipping_status !== "delivered";
                return (
                  <tr key={o.id}
                    className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 cursor-pointer ${
                      selected.has(o.id) ? "bg-blue-50/60" : noPO && noSup ? "bg-red-50/20" : noPO ? "bg-amber-50/20" : ""
                    }`}
                    onClick={() => toggleSelect(o.id)}
                  >
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSelect(o.id)} onClick={(e) => e.stopPropagation()} className="rounded" />
                    </td>
                    <td className="px-2 py-2.5 text-xs text-gray-400">{stats.displayed - idx}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap">
                      <div className="text-xs font-medium text-gray-900">{o.cafe24_order_id}</div>
                      <div className="text-[11px] text-gray-400">{formatDate(o.order_date)}</div>
                    </td>
                    <td className="px-2 py-2.5 max-w-[220px]">
                      <div className="text-sm text-gray-900 truncate">{o.product_name}</div>
                      {o.option_text && <div className="text-[11px] text-gray-400 truncate">{o.option_text}</div>}
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap">
                      <div className="text-xs text-gray-700">{o.buyer_name || o.receiver_name || "-"}</div>
                      {o.receiver_name && o.buyer_name && o.receiver_name !== o.buyer_name && (
                        <div className="text-[11px] text-gray-400">→ {o.receiver_name}</div>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-gray-500 whitespace-nowrap">{o.stores?.name || "-"}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {o.suppliers?.name ? (
                        <span className="text-xs text-gray-700">{o.suppliers.name}
                          {o.auto_assign_status === "auto" && <span className="text-[10px] text-green-500 ml-1">자동</span>}
                        </span>
                      ) : o.auto_assign_status === "review" && o.supplier_candidates && o.supplier_candidates.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-orange-500 font-medium">확인필요</span>
                          {o.supplier_candidates.map((c, ci) => (
                            <button key={ci} onClick={async () => {
                              await fetch("/admin/api/orders", {
                                method: "PATCH", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ ids: [o.id], updates: { supplier_id: c.supplierId } }),
                              });
                              await sb_patch(o.id, "manual");
                              fetchOrders();
                            }}
                              className="text-[11px] text-left text-blue-600 hover:underline cursor-pointer truncate max-w-[120px]"
                              title={`${c.supplier} (${c.score}점) - ${c.productName}`}
                            >
                              {c.supplier} ({c.score}점)
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-red-400 font-medium">미배정</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right text-gray-700">{o.quantity}</td>
                    <td className="px-2 py-2.5 text-right text-gray-700 whitespace-nowrap">₩{o.order_amount.toLocaleString()}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap">
                      {o.tracking_number ? (
                        <div>
                          <span className="text-[11px] text-gray-500">{o.shipping_company}</span>
                          <span className="text-xs text-gray-700 ml-1">{o.tracking_number}</span>
                          {!o.cafe24_shipping_synced && <span className="text-[10px] text-orange-500 ml-1">미연동</span>}
                        </div>
                      ) : noTrack ? (
                        <span className="text-[11px] text-red-400">미입력</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {o.purchase_order_id ? (
                        <span className="text-[11px] text-blue-600 font-medium">완료</span>
                      ) : noPO ? (
                        <span className="text-[11px] text-orange-500 font-medium">미발주</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLE[o.shipping_status] || STATUS_STYLE.pending}`}>
                        {STATUS_LABEL[o.shipping_status] || o.shipping_status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-400 text-right whitespace-nowrap">{formatDate(o.order_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 하단 합계 */}
      {orders.length > 0 && (
        <div className="mt-3 flex items-center gap-6 text-sm text-gray-500">
          <span>조회: <b className="text-gray-900">{stats.displayed}건</b></span>
          <span>수량 합계: <b className="text-gray-900">{stats.totalQty}개</b></span>
          <span>금액 합계: <b className="text-gray-900">₩{stats.totalAmount.toLocaleString()}</b></span>
        </div>
      )}
    </div>
  );
}
