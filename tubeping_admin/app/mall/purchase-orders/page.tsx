"use client";

import { useState, useEffect } from "react";

interface PurchaseOrder {
  id: string;
  po_number: string;
  order_date: string;
  total_items: number;
  total_amount: number;
  access_password: string;
  access_expires_at: string | null;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  completed_at: string | null;
  created_at: string;
  source: string;
  suppliers: { name: string; email: string } | null;
  shipment_stats: { tracked: number; synced: number; total: number };
  store_names: string[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성중",
  sent: "발주서 이메일 발송",
  viewed: "발주서 열람",
  completed: "송장등록완료",
  cancelled: "취소",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterPoNumber, setFilterPoNumber] = useState("");
  const [filterSentAt, setFilterSentAt] = useState("");
  const [filterViewedAt, setFilterViewedAt] = useState("");
  const [filterExpiry, setFilterExpiry] = useState("");
  const [importing, setImporting] = useState(false);

  const handleImportLegacy = async () => {
    if (!confirm("발주모아 26년도 데이터를 임포트합니다.\n이미 임포트된 PO는 건너뜁니다.\n\n계속할까요?")) return;
    setImporting(true);
    try {
      const res = await fetch("/admin/api/purchase-orders/import-legacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        alert(`임포트 완료!\n\n전체 PO: ${data.total_pos}건\n신규 임포트: ${data.imported}건\n중복 스킵: ${data.skipped}건${data.errors?.length > 0 ? `\n오류: ${data.errors.length}건` : ""}`);
        fetchPOs();
      } else {
        alert(`임포트 실패: ${data.error}`);
      }
    } catch (e) {
      alert(`오류: ${e instanceof Error ? e.message : "알 수 없음"}`);
    } finally {
      setImporting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === pos.length) setSelected(new Set());
    else setSelected(new Set(pos.map((p) => p.id)));
  };

  const fetchPOs = async () => {
    setLoading(true);
    const res = await fetch("/admin/api/purchase-orders");
    const data = await res.json();
    setPos(data.purchase_orders || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchPOs();
  }, []);

  // 카페24로 송장 전송 (PO 단위)
  const handleSyncCafe24 = async (po: PurchaseOrder) => {
    const pending = po.shipment_stats.tracked - po.shipment_stats.synced;
    if (pending <= 0) {
      alert("카페24에 전송할 새 송장이 없습니다.");
      return;
    }
    if (!confirm(`발주서 ${po.po_number} 의 송장 ${pending}건을 카페24에 전송합니다. 계속할까요?`)) return;
    setSyncingId(po.id);
    try {
      const res = await fetch("/admin/api/cafe24/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchase_order_id: po.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`전송 실패: ${data.error || "알 수 없는 오류"}`);
      } else {
        const failedList = (data.results || []).filter((r: { success: boolean }) => !r.success);
        let msg = `카페24 송장 전송 완료: 성공 ${data.synced || 0}건 / 실패 ${data.failed || 0}건`;
        if (failedList.length > 0) {
          msg += `\n\n실패 내역:\n` + failedList.slice(0, 5).map((r: { cafe24_order_id: string; error?: string }) => `- ${r.cafe24_order_id}: ${r.error?.substring(0, 80) || ""}`).join("\n");
        }
        alert(msg);
      }
      fetchPOs();
    } catch (e) {
      alert(`오류: ${e instanceof Error ? e.message : "알 수 없음"}`);
    } finally {
      setSyncingId(null);
    }
  };

  // 이메일 발송
  const handleSendEmail = async (po: PurchaseOrder) => {
    const res = await fetch("/admin/api/purchase-orders/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchase_order_id: po.id }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`이메일 발송 완료: ${po.suppliers?.email}`);
      fetchPOs();
    } else {
      alert(`발송 실패: ${data.error}`);
    }
  };

  // 카페24 일괄 전송 (전체 미동기화 송장)
  const handleBulkSyncCafe24 = async () => {
    const totalPending = pos.reduce((sum, p) => sum + Math.max(0, p.shipment_stats.tracked - p.shipment_stats.synced), 0);
    if (totalPending <= 0) {
      alert("카페24에 전송할 송장이 없습니다.");
      return;
    }
    if (!confirm(`전체 미동기화 송장 ${totalPending}건을 카페24에 일괄 전송합니다. 계속할까요?`)) return;
    setBulkSyncing(true);
    try {
      const res = await fetch("/admin/api/cafe24/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`전송 실패: ${data.error || "알 수 없는 오류"}`);
      } else {
        const failedList = (data.results || []).filter((r: { success: boolean }) => !r.success);
        let msg = `일괄 전송 결과: 성공 ${data.synced || 0}건 / 실패 ${data.failed || 0}건`;
        if (failedList.length > 0) {
          msg += `\n\n실패 내역 (최대 5건):\n` + failedList.slice(0, 5).map((r: { cafe24_order_id: string; error?: string }) => `- ${r.cafe24_order_id}: ${r.error?.substring(0, 100) || ""}`).join("\n");
        }
        alert(msg);
      }
      fetchPOs();
    } catch (e) {
      alert(`오류: ${e instanceof Error ? e.message : "알 수 없음"}`);
    } finally {
      setBulkSyncing(false);
    }
  };

  // 필터 옵션 목록
  const supplierOptions = [...new Set(pos.map((p) => p.suppliers?.name).filter(Boolean))].sort() as string[];
  const dateOptions = [...new Set(pos.map((p) => p.order_date))].sort().reverse();

  // 필터 적용
  const filtered = pos.filter((p) => {
    if (filterSupplier && p.suppliers?.name !== filterSupplier) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    if (filterDate && p.order_date !== filterDate) return false;
    if (filterPoNumber && !p.po_number.toLowerCase().includes(filterPoNumber.toLowerCase())) return false;
    if (filterSentAt === "sent" && !p.sent_at) return false;
    if (filterSentAt === "not_sent" && p.sent_at) return false;
    if (filterViewedAt === "viewed" && !p.viewed_at) return false;
    if (filterViewedAt === "not_viewed" && p.viewed_at) return false;
    if (filterExpiry === "expired") {
      if (!p.access_expires_at || new Date(p.access_expires_at).getTime() > Date.now()) return false;
    }
    if (filterExpiry === "active") {
      if (!p.access_expires_at || new Date(p.access_expires_at).getTime() <= Date.now()) return false;
    }
    return true;
  });

  const hasFilter = filterSupplier || filterStatus || filterDate || filterPoNumber || filterSentAt || filterViewedAt || filterExpiry;

  // 통계
  const stats = {
    total: pos.length,
    draft: pos.filter((p) => p.status === "draft").length,
    sent: pos.filter((p) => p.status === "sent" || p.status === "viewed").length,
    completed: pos.filter((p) => p.status === "completed").length,
  };
  const bulkPendingCafe24 = pos.reduce((sum, p) => sum + Math.max(0, p.shipment_stats.tracked - p.shipment_stats.synced), 0);
  const bulkPendingTracking = pos.filter((p) => (p.status === "sent" || p.status === "viewed") && p.shipment_stats.tracked < p.shipment_stats.total).length;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="flex-shrink-0 p-8 pb-0 bg-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">발주서 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            공급사별 발주서 현황. 주문관리에서 발주서를 생성합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-xs font-bold text-blue-600">{selected.size}건 선택</span>
              <button
                onClick={async () => {
                  const selectedPOs = pos.filter((p) => selected.has(p.id));
                  const withPending = selectedPOs.filter((p) => p.shipment_stats.tracked < p.shipment_stats.total && (p.status === "sent" || p.status === "viewed"));
                  if (withPending.length === 0) { alert("선택한 발주서 중 송장 미등록 건이 없습니다."); return; }
                  if (!confirm(`선택한 ${withPending.length}건에 송장 리마인더를 발송합니다. 계속할까요?`)) return;
                  for (const p of withPending) {
                    await fetch("/admin/api/purchase-orders/remind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchase_order_id: p.id }) });
                  }
                  alert(`${withPending.length}건 리마인더 발송 완료`);
                  fetchPOs();
                }}
                className="px-3 py-1.5 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 cursor-pointer"
              >
                선택 리마인더
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`선택한 ${selected.size}건 발주서를 삭제합니다.\n연결된 주문은 '미발주' 상태로 되돌아갑니다.\n\n계속할까요?`)) return;
                  for (const id of selected) {
                    await fetch("/admin/api/purchase-orders", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
                  }
                  alert(`${selected.size}건 삭제 완료`);
                  setSelected(new Set());
                  fetchPOs();
                }}
                className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 cursor-pointer"
              >
                선택 삭제
              </button>
              <div className="w-px h-4 bg-gray-300" />
            </>
          )}
          <button
            onClick={handleBulkSyncCafe24}
            disabled={bulkSyncing || bulkPendingCafe24 === 0}
            className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkSyncing ? "전송 중..." : bulkPendingCafe24 > 0 ? `카페24 송장 일괄 전송 (${bulkPendingCafe24}건)` : "카페24 송장 전송 (대기 없음)"}
          </button>
          <button
            onClick={handleImportLegacy}
            disabled={importing}
            className="px-4 py-2.5 bg-gray-700 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? "임포트 중..." : "발주모아 임포트"}
          </button>
          {bulkPendingTracking > 0 && (
            <button
              onClick={async () => {
                if (!confirm(`송장 미등록 발주서 ${bulkPendingTracking}건에 리마인더를 일괄 발송합니다. 계속할까요?`)) return;
                const res = await fetch("/admin/api/purchase-orders/remind", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                alert(`리마인더 발송: ${data.sent}건 완료\n\n${data.results?.map((r: { supplier: string; email: string; success: boolean }) => `${r.supplier}: ${r.success ? r.email : "실패"}`).join("\n") || ""}`);
                fetchPOs();
              }}
              className="px-4 py-2.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors cursor-pointer"
            >
              송장 미등록 일괄 리마인더 ({bulkPendingTracking}건)
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "전체 발주서", value: `${stats.total}건` },
          { label: "작성중", value: `${stats.draft}건`, highlight: stats.draft > 0 },
          { label: "발송/열람", value: `${stats.sent}건` },
          { label: "송장등록 완료", value: `${stats.completed}건` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-lg font-bold mt-1 ${s.highlight ? "text-[#C41E1E]" : "text-gray-900"}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      </div>
      {/* Table */}
      <div className="flex-1 overflow-auto px-8 pb-8">
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : pos.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            발주서가 없습니다. 주문관리에서 주문을 선택하고 발주서를 생성하세요.
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e5e7eb]">
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={selected.size > 0 && selected.size === pos.length} onChange={toggleAll} className="rounded border-gray-300 cursor-pointer" />
                </th>
                <th className="text-right px-6 py-3 font-medium">발주일</th>
                <th className="text-left px-6 py-3 font-medium">발주번호</th>
                <th className="text-left px-3 py-3 font-medium">공급사</th>
                <th className="text-right px-3 py-3 font-medium">상품수</th>
                <th className="text-right px-3 py-3 font-medium">금액</th>
                <th className="text-center px-3 py-3 font-medium">상태</th>
                <th className="text-center px-3 py-3 font-medium">발송시점</th>
                <th className="text-center px-3 py-3 font-medium">열람시점</th>
                <th className="text-center px-3 py-3 font-medium">송장/카페24</th>
                <th className="text-center px-3 py-3 font-medium">접속만료</th>
                <th className="text-center px-3 py-3 font-medium">액션</th>
              </tr>
              {/* 필터 행 */}
              <tr className="border-b border-gray-200 bg-gray-50">
                <th />
                <th className="px-3 py-2">
                  <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white cursor-pointer">
                    <option value="">전체</option>
                    {dateOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </th>
                <th className="px-3 py-2">
                  <input value={filterPoNumber} onChange={(e) => setFilterPoNumber(e.target.value)} placeholder="검색..." className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white" />
                </th>
                <th className="px-3 py-2">
                  <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white cursor-pointer">
                    <option value="">전체</option>
                    {supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </th>
                <th />
                <th />
                <th className="px-3 py-2">
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white cursor-pointer">
                    <option value="">전체</option>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </th>
                <th className="px-3 py-2">
                  <select value={filterSentAt} onChange={(e) => setFilterSentAt(e.target.value)} className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white cursor-pointer">
                    <option value="">전체</option>
                    <option value="sent">발송됨</option>
                    <option value="not_sent">미발송</option>
                  </select>
                </th>
                <th className="px-3 py-2">
                  <select value={filterViewedAt} onChange={(e) => setFilterViewedAt(e.target.value)} className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white cursor-pointer">
                    <option value="">전체</option>
                    <option value="viewed">열람함</option>
                    <option value="not_viewed">미열람</option>
                  </select>
                </th>
                <th />
                <th className="px-3 py-2">
                  <select value={filterExpiry} onChange={(e) => setFilterExpiry(e.target.value)} className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white cursor-pointer">
                    <option value="">전체</option>
                    <option value="active">유효</option>
                    <option value="expired">만료됨</option>
                  </select>
                </th>
                <th className="px-3 py-2">
                  {hasFilter && (
                    <button onClick={() => { setFilterSupplier(""); setFilterStatus(""); setFilterDate(""); setFilterPoNumber(""); setFilterSentAt(""); setFilterViewedAt(""); setFilterExpiry(""); }} className="text-[10px] text-red-500 hover:underline cursor-pointer whitespace-nowrap">
                      초기화
                    </button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading ? (
                <tr><td colSpan={12} className="py-8 text-center text-gray-400 text-sm">필터 조건에 맞는 발주서가 없습니다.</td></tr>
              ) : filtered.map((po) => (
                <tr key={po.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 ${selected.has(po.id) ? "bg-blue-50/40" : ""}`}>
                  <td className="px-4 py-3.5">
                    <input type="checkbox" checked={selected.has(po.id)} onChange={() => toggleSelect(po.id)} className="rounded border-gray-300 cursor-pointer" />
                  </td>
                  <td className="px-6 py-3.5 text-sm text-gray-500 text-right">
                    {po.order_date}
                  </td>
                  <td className="px-6 py-3.5 text-sm font-medium text-gray-900">
                    <div className="flex items-center gap-1.5">
                      {po.po_number}
                      {po.source === "legacy" && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">발주모아</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-700">
                    <div>{po.suppliers?.name}</div>
                    <div className="text-xs text-gray-400">{po.suppliers?.email}</div>
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                    {po.total_items}
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                    ₩{po.total_amount.toLocaleString()}
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full ${
                        STATUS_STYLE[po.status] || STATUS_STYLE.draft
                      }`}
                    >
                      {STATUS_LABEL[po.status] || po.status}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-xs text-gray-500 text-center">
                    {po.sent_at ? new Date(new Date(po.sent_at).getTime() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ") : "-"}
                  </td>
                  <td className="px-3 py-3.5 text-xs text-gray-500 text-center">
                    {po.viewed_at ? new Date(new Date(po.viewed_at).getTime() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ") : "-"}
                  </td>
                  <td className="px-3 py-3.5 text-xs text-center whitespace-nowrap">
                    {(() => {
                      const s = po.shipment_stats;
                      const pending = s.tracked - s.synced;
                      return (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-gray-600">송장 {s.tracked}/{s.total}</span>
                          <span className={pending > 0 ? "text-orange-600 font-medium" : "text-green-600"}>
                            카페24 {s.synced}/{s.tracked}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3.5 text-xs text-center whitespace-nowrap">
                    {(() => {
                      if (!po.access_expires_at) return <span className="text-gray-400">-</span>;
                      const exp = new Date(po.access_expires_at);
                      const now = new Date();
                      const diffMs = exp.getTime() - now.getTime();
                      const expired = diffMs < 0;
                      const days = Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
                      return (
                        <div className="flex flex-col items-center gap-1">
                          <span className={expired ? "text-red-600 font-medium" : days <= 2 ? "text-orange-600" : "text-green-600"}>
                            {expired ? `만료 (${days}일 전)` : `${days}일 남음`}
                          </span>
                          <button
                            onClick={async () => {
                              const res = await fetch("/admin/api/purchase-orders", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: po.id, days: 7 }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                alert("접속 기한이 7일 연장되었습니다.");
                                fetchPOs();
                              } else {
                                alert(`연장 실패: ${data.error}`);
                              }
                            }}
                            className="text-[10px] text-blue-600 hover:underline cursor-pointer"
                          >
                            +7일 연장
                          </button>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2">
                        {po.status !== "draft" && (
                          <a
                            href={`/admin/api/purchase-orders/download?id=${po.id}&type=po`}
                            className="text-xs text-gray-600 hover:underline cursor-pointer"
                            target="_blank"
                          >
                            발주파일
                          </a>
                        )}
                        {po.shipment_stats.tracked > 0 && (
                          <a
                            href={`/admin/api/purchase-orders/download?id=${po.id}&type=shipment`}
                            className="text-xs text-green-600 hover:underline cursor-pointer"
                            target="_blank"
                          >
                            송장파일
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {po.status === "draft" && (
                          <button
                            onClick={() => handleSendEmail(po)}
                            className="text-xs text-[#C41E1E] hover:underline cursor-pointer"
                          >
                            메일 발송
                          </button>
                        )}
                        {(po.status === "sent" || po.status === "viewed") && po.shipment_stats.tracked < po.shipment_stats.total && (
                          <button
                            onClick={async () => {
                              const res = await fetch("/admin/api/purchase-orders/remind", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ purchase_order_id: po.id }),
                              });
                              const data = await res.json();
                              alert(data.sent > 0 ? `송장 리마인더 발송 완료: ${po.suppliers?.email}` : "발송 대상 없음");
                            }}
                            className="text-xs text-orange-600 hover:underline cursor-pointer"
                          >
                            송장 리마인더
                          </button>
                        )}
                        {po.shipment_stats.tracked - po.shipment_stats.synced > 0 && (
                          <button
                            onClick={() => handleSyncCafe24(po)}
                            disabled={syncingId === po.id}
                            className="text-xs text-blue-600 hover:underline cursor-pointer disabled:opacity-50"
                          >
                            {syncingId === po.id ? "전송 중..." : "카페24 송장 전송"}
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (!confirm(`발주서 ${po.po_number}을(를) 삭제합니다.\n연결된 주문은 '미발주' 상태로 되돌아갑니다.\n\n계속할까요?`)) return;
                            const res = await fetch("/admin/api/purchase-orders", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: po.id }),
                            });
                            if (res.ok) {
                              alert(`${po.po_number} 삭제 완료`);
                              fetchPOs();
                            } else {
                              const data = await res.json().catch(() => ({}));
                              alert(`삭제 실패: ${data.error || res.status}`);
                            }
                          }}
                          className="text-xs text-red-500 hover:underline cursor-pointer"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>
    </div>
  );
}
