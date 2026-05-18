"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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

/** 수동 상품 검색·추가 위젯 */
function ManualMatcher({
  alertId,
  currentIds,
  onAdd,
}: {
  alertId: string;
  currentIds: Set<string>;
  onAdd: (p: MatchedProduct) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MatchedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/admin/api/products/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        setResults(data.products || []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[#C41E1E] underline hover:no-underline mt-1"
      >
        + 직접 상품 검색해서 매칭
      </button>
    );
  }

  return (
    <div className="mt-2 border border-gray-200 rounded-lg p-2 bg-gray-50">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="상품명 또는 tp_code 검색 (2자 이상)"
          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
          autoFocus
        />
        <button
          onClick={() => {
            setOpen(false);
            setQ("");
            setResults([]);
          }}
          className="text-xs text-gray-500 px-2"
        >
          닫기
        </button>
      </div>
      {loading && <p className="text-[11px] text-gray-400 mt-1">검색 중...</p>}
      {!loading && q.length >= 2 && results.length === 0 && (
        <p className="text-[11px] text-gray-400 mt-1">결과 없음</p>
      )}
      {results.length > 0 && (
        <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
          {results.map((p) => {
            const already = currentIds.has(p.id);
            return (
              <button
                key={p.id + alertId}
                onClick={() => !already && onAdd(p)}
                disabled={already}
                className={`w-full text-left flex items-center gap-2 text-xs p-1.5 rounded ${already ? "opacity-40 cursor-not-allowed" : "hover:bg-white"}`}
              >
                <span className="font-mono text-[10px] font-bold text-[#C41E1E] bg-[#FFF0F5] px-1.5 py-0.5 rounded">
                  {p.tp_code}
                </span>
                <span className="flex-1 text-gray-700">{p.product_name}</span>
                {already ? (
                  <span className="text-[10px] text-gray-400">추가됨</span>
                ) : (
                  <span className="text-[10px] text-[#C41E1E]">+ 추가</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function StockAlertsPage() {
  const [filter, setFilter] = useState("pending");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Record<string, Set<string>>>({});
  const [extraMatches, setExtraMatches] = useState<Record<string, MatchedProduct[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const url = filter ? `/admin/api/product-stock-alerts?status=${filter}` : "/admin/api/product-stock-alerts";
    const res = await fetch(url);
    const data = await res.json();
    setAlerts(data.alerts || []);
    const sel: Record<string, Set<string>> = {};
    for (const a of data.alerts || []) {
      sel[a.id] = new Set(a.matched_product_ids || []);
    }
    setSelectedProducts(sel);
    setExtraMatches({});
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

  const handleRematch = async (alertId: string) => {
    setBusy(alertId);
    const res = await fetch("/admin/api/product-stock-alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: alertId, action: "rematch" }),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok) {
      window.alert(`재매칭 결과: ${data.matched}개`);
      fetchAlerts();
    } else {
      window.alert(`실패: ${data.error}`);
    }
  };

  const handleAddManual = async (alertId: string, product: MatchedProduct) => {
    setExtraMatches((prev) => {
      const next = { ...prev };
      const list = next[alertId] || [];
      if (!list.find((p) => p.id === product.id)) next[alertId] = [...list, product];
      return next;
    });
    setSelectedProducts((prev) => {
      const next = { ...prev };
      const set = new Set(next[alertId] || []);
      set.add(product.id);
      next[alertId] = set;
      return next;
    });
    // 즉시 DB 반영
    const allIds = new Set([
      ...(alerts.find((a) => a.id === alertId)?.matched_product_ids || []),
      product.id,
    ]);
    await fetch("/admin/api/product-stock-alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: alertId, action: "set_match", product_ids: [...allIds] }),
    });
  };

  const handleApply = async (alert: Alert) => {
    const ids = [...(selectedProducts[alert.id] || [])];
    if (ids.length === 0) { window.alert("적용할 상품을 선택하세요."); return; }
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
          {alerts.map((a) => {
            const displayMatched = [
              ...(a.matched_products || []),
              ...(extraMatches[a.id] || []).filter(
                (p) => !(a.matched_products || []).find((q) => q.id === p.id)
              ),
            ];
            const selected = selectedProducts[a.id] || new Set();
            return (
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
                    {a.detail && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap line-clamp-3">{a.detail}</p>}
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
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-600">
                    매칭된 상품 ({displayMatched.length}개)
                  </p>
                  {a.status === "pending" && (
                    <button
                      onClick={() => handleRematch(a.id)}
                      disabled={busy === a.id}
                      className="text-[11px] text-gray-500 hover:text-[#C41E1E] underline disabled:opacity-50"
                    >
                      {busy === a.id ? "재매칭 중..." : "재매칭"}
                    </button>
                  )}
                </div>

                {displayMatched.length > 0 ? (
                  <div className="space-y-1">
                    {displayMatched.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-xs hover:bg-gray-50 p-1.5 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
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
                ) : (
                  <p className="text-xs text-gray-400">매칭된 상품 없음 — 메일 언급 상품명: {(a.product_names || []).join(", ") || "(없음)"}</p>
                )}

                {a.status === "pending" && (
                  <ManualMatcher
                    alertId={a.id}
                    currentIds={new Set(displayMatched.map((p) => p.id))}
                    onAdd={(p) => handleAddManual(a.id, p)}
                  />
                )}
              </div>

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
                  <button
                    onClick={() => handleApply(a)}
                    disabled={selected.size === 0}
                    className="px-4 py-1.5 text-xs bg-[#C41E1E] text-white rounded hover:bg-[#A01818] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {a.alert_type === "restock" ? "판매중 전환" : "판매중지 적용"} ({selected.size})
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
