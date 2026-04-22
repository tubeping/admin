"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx";

interface PurchaseOrder {
  id: string;
  po_number: string;
  order_date: string;
  total_items: number;
  total_amount: number;
  access_password: string;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  completed_at: string | null;
  created_at: string;
  suppliers: { name: string; email: string } | null;
  shipment_stats: { tracked: number; synced: number; total: number };
  store_names: string[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성중",
  sent: "발송완료",
  viewed: "열람",
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
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">발주서 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            공급사별 발주서 현황. 주문관리에서 발주서를 생성합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              // 1. Acts29 스토어 id 찾기
              const storesRes = await fetch("/admin/api/stores");
              const storesData = await storesRes.json();
              const actsStore = (storesData.stores || []).find((s: { name: string }) => s.name === "Acts29");
              if (!actsStore) { alert("Acts29 스토어가 없습니다."); return; }

              // 2. 해당 store_id로 주문 조회
              const res = await fetch(`/admin/api/orders?store_id=${actsStore.id}&limit=500`);
              if (!res.ok) { alert("조회 실패"); return; }
              const data = await res.json();
              const orders = (data.orders || []).filter((o: { tracking_number?: string; shipping_status?: string }) =>
                o.tracking_number && o.shipping_status !== "cancelled"
              );
              if (orders.length === 0) { alert("ACTs 송장 등록된 주문이 없습니다."); return; }
              const rows = orders.map((o: { cafe24_order_item_code?: string; cafe24_order_id?: string; shipping_company?: string; tracking_number?: string }) => ({
                "상품주문번호": o.cafe24_order_item_code || o.cafe24_order_id || "",
                "택배사": o.shipping_company || "",
                "송장번호": o.tracking_number || "",
              }));
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "발송처리");
              XLSX.writeFile(wb, `acts_송장_발송처리_${new Date().toISOString().slice(0, 10)}.xlsx`);
            }}
            className="px-4 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
          >
            액츠발송양식 다운로드
          </button>
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

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : pos.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            발주서가 없습니다. 주문관리에서 주문을 선택하고 발주서를 생성하세요.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={selected.size > 0 && selected.size === pos.length} onChange={toggleAll} className="rounded border-gray-300 cursor-pointer" />
                </th>
                <th className="text-left px-6 py-3 font-medium">발주번호</th>
                <th className="text-left px-3 py-3 font-medium">공급사</th>
                <th className="text-left px-3 py-3 font-medium">판매사</th>
                <th className="text-right px-3 py-3 font-medium">상품수</th>
                <th className="text-right px-3 py-3 font-medium">금액</th>
                <th className="text-center px-3 py-3 font-medium">상태</th>
                <th className="text-center px-3 py-3 font-medium">발송</th>
                <th className="text-center px-3 py-3 font-medium">열람</th>
                <th className="text-center px-3 py-3 font-medium">송장/카페24</th>
                <th className="text-right px-6 py-3 font-medium">발주일</th>
                <th className="text-center px-3 py-3 font-medium">액션</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => (
                <tr key={po.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 ${selected.has(po.id) ? "bg-blue-50/40" : ""}`}>
                  <td className="px-4 py-3.5">
                    <input type="checkbox" checked={selected.has(po.id)} onChange={() => toggleSelect(po.id)} className="rounded border-gray-300 cursor-pointer" />
                  </td>
                  <td className="px-6 py-3.5 text-sm font-medium text-gray-900">
                    {po.po_number}
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-700">
                    <div>{po.suppliers?.name}</div>
                    <div className="text-xs text-gray-400">{po.suppliers?.email}</div>
                  </td>
                  <td className="px-3 py-3.5 text-xs text-gray-600">
                    {(po.store_names || []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {po.store_names.map((name, i) => (
                          <span key={i} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-medium">{name}</span>
                        ))}
                      </div>
                    ) : "-"}
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
                  <td className="px-6 py-3.5 text-sm text-gray-500 text-right">
                    {po.order_date}
                  </td>
                  <td className="px-3 py-3.5 text-center space-x-2">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
