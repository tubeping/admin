"use client";

import { useState, useEffect, useCallback } from "react";

interface MatchedProduct {
  id: string;
  tp_code: string;
  product_name: string;
  selling: string;
}

interface Alert {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  alert_type: string;
  product_names: string[];
  option_info: string | null;
  effective_from: string | null;
  effective_to: string | null;
  title: string;
  detail: string;
  status: string;
  source: string;
  matched_product_ids: string[];
  matched_products: MatchedProduct[];
  created_at: string;
  applied_at: string | null;
}

const TYPE_COLOR: Record<string, string> = {
  out_of_stock: "bg-red-100 text-red-700 border-red-200",
  restock: "bg-green-100 text-green-700 border-green-200",
  discontinued: "bg-gray-100 text-gray-700 border-gray-300",
  price_change: "bg-blue-100 text-blue-700 border-blue-200",
};
const TYPE_LABEL: Record<string, string> = {
  out_of_stock: "품절",
  restock: "재입고",
  discontinued: "판매종료",
  price_change: "가격변경",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  applied: "bg-green-100 text-green-700",
  ignored: "bg-gray-100 text-gray-500",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  applied: "적용됨",
  ignored: "무시",
};

export default function StockAlertsPage() {
  const [filter, setFilter] = useState("pending");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Record<string, Set<string>>>({});

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const url = filter ? `/admin/api/product-stock-alerts?status=${filter}` : "/admin/api/product-stock-alerts";
    const res = await fetch(url);
    const data = await res.json();
    setAlerts(data.alerts || []);
    // 기본: 매칭된 모든 상품 선택
    const sel: Record<string, Set<string>> = {};
    for (const a of data.alerts || []) {
      sel[a.id] = new Set(a.matched_product_ids || []);
    }
    setSelectedProducts(sel);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const toggleProduct = (alertId: string, productId: string) => {
    setSelectedProducts((prev) => {
      const next = { ...prev };
      const set = new Set(next[alertId] || []);
      if (set.has(productId)) set.delete(productId);
      else set.add(productId);
      next[alertId] = set;
      return next;
    });
  };

  const handleApply = async (alert: Alert) => {
    const ids = [...(selectedProducts[alert.id] || [])];
    if (ids.length === 0) { alert.alert_type === "restock" ? alert : 0; window.alert("적용할 상품을 선택하세요."); return; }
    const action = alert.alert_type === "restock" ? "판매중으로 전환" : "판매중지";
    if (!confirm(`${ids.length}개 상품을 ${action}합니다. 계속할까요?`)) return;

    const res = await fetch("/admin/api/product-stock-alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: alert.id, action: "apply", product_ids: ids }),
    });
    const data = await res.json();
    if (res.ok) {
      window.alert(`${data.applied}개 상품 ${action} 완료`);
      fetchAlerts();
    } else {
      window.alert(`실패: ${data.error}`);
    }
  };

  const handleIgnore = async (alertId: string) => {
    if (!confirm("이 알림을 무시하시겠습니까?")) return;
    await fetch("/admin/api/product-stock-alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: alertId, action: "ignore" }),
    });
    fetchAlerts();
  };

  const handleDelete = async (alertId: string) => {
    if (!confirm("이 알림을 삭제하시겠습니까?")) return;
    await fetch("/admin/api/product-stock-alerts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: alertId }),
    });
    fetchAlerts();
  };

  const counts = {
    pending: alerts.filter((a) => a.status === "pending").length,
    applied: alerts.filter((a) => a.status === "applied").length,
    ignored: alerts.filter((a) => a.status === "ignored").length,
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">품절/재입고/판매종료 알림</h1>
          <p className="text-xs text-gray-500 mt-1">공급사 메일에서 수집한 재고 변동 알림. 확인 후 상품관리에 반영하세요.</p>
        </div>
        <div className="flex gap-2">
          {["pending", "applied", "ignored"].map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-xs rounded-lg border ${filter === k ? "bg-[#C41E1E] text-white border-[#C41E1E]" : "bg-white text-gray-700 border-gray-200"}`}
            >
              {STATUS_LABEL[k]} ({counts[k as keyof typeof counts]})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-400">로딩 중...</div>
      ) : alerts.length === 0 ? (
        <div className="p-12 text-center text-gray-400 bg-white border rounded-xl">알림이 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <div key={a.id} className="bg-white border rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-3 flex-1">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${TYPE_COLOR[a.alert_type] || TYPE_COLOR.out_of_stock}`}>
                    {TYPE_LABEL[a.alert_type] || a.alert_type}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{a.supplier_name}</span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500">{a.created_at.slice(0, 10)}</span>
                      {a.source === "gmail" && <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">자동</span>}
                    </div>
                    <p className="text-sm text-gray-800 mt-1">{a.title}</p>
                    {a.detail && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{a.detail}</p>}
                    {a.effective_from && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        기간: {a.effective_from}{a.effective_to && a.effective_to !== a.effective_from ? ` ~ ${a.effective_to}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[a.status]}`}>
                  {STATUS_LABEL[a.status]}
                </span>
              </div>

              {/* 매칭 상품 */}
              {a.matched_products && a.matched_products.length > 0 ? (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-600 mb-2">매칭된 상품 ({a.matched_products.length}개)</p>
                  <div className="space-y-1">
                    {a.matched_products.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-xs hover:bg-gray-50 p-1.5 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(selectedProducts[a.id] || new Set()).has(p.id)}
                          onChange={() => toggleProduct(a.id, p.id)}
                          disabled={a.status !== "pending"}
                          className="rounded"
                        />
                        <span className="font-mono text-[10px] font-bold text-[#C41E1E] bg-[#FFF0F5] px-1.5 py-0.5 rounded">{p.tp_code}</span>
                        <span className="flex-1 text-gray-700">{p.product_name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.selling === "T" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {p.selling === "T" ? "판매중" : "미판매"}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400">매칭된 상품 없음 — 메일 언급 상품명: {(a.product_names || []).join(", ") || "(없음)"}</p>
                </div>
              )}

              {/* 액션 */}
              {a.status === "pending" && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end gap-2">
                  <button
                    onClick={() => handleIgnore(a.id)}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50"
                  >
                    무시
                  </button>
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50"
                  >
                    삭제
                  </button>
                  {a.matched_products && a.matched_products.length > 0 && (
                    <button
                      onClick={() => handleApply(a)}
                      className="px-4 py-1.5 text-xs bg-[#C41E1E] text-white rounded hover:bg-[#A01818] font-medium"
                    >
                      {a.alert_type === "restock" ? "판매중 전환" : "판매중지 적용"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
