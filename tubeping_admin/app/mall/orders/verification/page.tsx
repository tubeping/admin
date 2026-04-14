"use client";

import { useState, useEffect, useCallback } from "react";

interface Store { id: string; name: string; }

type VerifyGroup = {
  product_name: string;
  product_id: string | null;
  tp_code: string | null;
  mapping_verified: boolean;
  expected_supplier_id: string | null;
  expected_supplier_name: string | null;
  order_count: number;
  current_supplier_names: string[];
  store_names: string[];
  status: "match" | "mismatch" | "unmatched_product" | "invalid_tp_code" | "unknown_supplier_code";
  order_ids: string[];
};

const STATUS_META: Record<VerifyGroup["status"], { text: string; cls: string }> = {
  match: { text: "일치", cls: "bg-green-100 text-green-700" },
  mismatch: { text: "불일치", cls: "bg-red-100 text-red-700" },
  unmatched_product: { text: "상품없음", cls: "bg-gray-100 text-gray-600" },
  invalid_tp_code: { text: "TP코드 비정상", cls: "bg-orange-100 text-orange-700" },
  unknown_supplier_code: { text: "공급사 코드 미등록", cls: "bg-orange-100 text-orange-700" },
};

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

type ProductOption = { id: string; product_name: string; tp_code: string | null; supplier: string | null };

export default function OrderMappingVerificationPage() {
  const [groups, setGroups] = useState<VerifyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [filterStore, setFilterStore] = useState("");
  const [dateFrom, setDateFrom] = useState(daysAgo(60));
  const [dateTo, setDateTo] = useState(today());
  const [includeVerified, setIncludeVerified] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "problem" | VerifyGroup["status"]>("problem");

  // 상품 연결 모달
  const [linkTarget, setLinkTarget] = useState<VerifyGroup | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStore) params.set("store_id", filterStore);
    if (dateFrom) params.set("start_date", dateFrom);
    if (dateTo) params.set("end_date", dateTo);
    if (includeVerified) params.set("include_verified", "true");
    const res = await fetch(`/admin/api/orders/mapping-verification?${params}`);
    const data = await res.json();
    setGroups(data.groups || []);
    setLoading(false);
  }, [filterStore, dateFrom, dateTo, includeVerified]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => {
    fetch("/admin/api/stores").then((r) => r.json()).then((d) => setStores(d.stores || []));
  }, []);

  const filtered = groups.filter((g) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "problem") return g.status !== "match";
    return g.status === statusFilter;
  });

  const counts = {
    total: groups.length,
    mismatch: groups.filter((g) => g.status === "mismatch").length,
    unmatched: groups.filter((g) => g.status === "unmatched_product").length,
    invalid: groups.filter((g) => g.status === "invalid_tp_code" || g.status === "unknown_supplier_code").length,
    match: groups.filter((g) => g.status === "match").length,
  };

  const handleVerify = async (productId: string) => {
    await fetch("/admin/api/orders/mapping-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", product_id: productId }),
    });
    fetchGroups();
  };

  const openLink = (g: VerifyGroup) => {
    setLinkTarget(g);
    setProductSearch(g.product_name.slice(0, 10));
    setProductOptions([]);
  };

  const searchProducts = useCallback(async (kw: string) => {
    if (!kw.trim()) { setProductOptions([]); return; }
    setSearching(true);
    const res = await fetch(`/admin/api/products?keyword=${encodeURIComponent(kw)}&limit=20`);
    const data = await res.json();
    const list: ProductOption[] = (data.products || []).map((p: { id: string; product_name: string; tp_code: string | null; supplier: string | null }) => ({
      id: p.id, product_name: p.product_name, tp_code: p.tp_code, supplier: p.supplier,
    }));
    setProductOptions(list);
    setSearching(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { if (linkTarget) searchProducts(productSearch); }, 300);
    return () => clearTimeout(t);
  }, [productSearch, linkTarget, searchProducts]);

  const confirmLink = async (product: ProductOption) => {
    if (!linkTarget) return;
    if (!confirm(`'${linkTarget.product_name}' 주문 ${linkTarget.order_count}건을\n'${product.product_name}' (${product.tp_code}) 상품으로 연결합니다.\n\n- 상품의 name_aliases에 추가\n- 주문 공급사 재배정\n- 연결된 모든 카페24 스토어에 custom_product_code=${product.tp_code} 푸시\n\n계속할까요?`)) return;
    setLinking(true);
    const res = await fetch("/admin/api/orders/mapping-verification/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_product_name: linkTarget.product_name,
        product_id: product.id,
        order_ids: linkTarget.order_ids,
      }),
    });
    const data = await res.json();
    setLinking(false);
    if (!res.ok) {
      alert(`실패: ${data.error}`);
      return;
    }
    const c = data.cafe24 || { attempted: 0, succeeded: 0, failed: 0 };
    alert(`연결 완료\n주문 재배정: ${data.reassigned}건\n카페24 자체코드 푸시: ${c.succeeded}/${c.attempted} 성공` + (c.failed > 0 ? `\n실패: ${c.errors?.join("\n") || ""}` : ""));
    setLinkTarget(null);
    fetchGroups();
  };

  const handleReassign = async (g: VerifyGroup) => {
    if (!g.expected_supplier_id) return;
    if (!confirm(`${g.order_count}건을 '${g.expected_supplier_name}'로 재배정합니다. 계속할까요?`)) return;
    await fetch("/admin/api/orders/mapping-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reassign",
        order_ids: g.order_ids,
        supplier_id: g.expected_supplier_id,
        product_id: g.product_id,
      }),
    });
    fetchGroups();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">매핑 검증</h1>
          <p className="text-xs text-gray-500 mt-1">상품명 단위로 products.tp_code 기반 공급사 매핑이 올바른지 검증합니다. 확인 완료한 상품은 기본적으로 숨김 처리됩니다.</p>
        </div>
        <span className="text-sm text-gray-500">총 {counts.total}개 상품</span>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {[
          { label: "전체", value: counts.total, cls: "text-gray-900", key: "all" as const },
          { label: "불일치", value: counts.mismatch, cls: "text-red-600", key: "mismatch" as const },
          { label: "상품없음", value: counts.unmatched, cls: "text-gray-600", key: "unmatched_product" as const },
          { label: "코드 비정상", value: counts.invalid, cls: "text-orange-600", key: "invalid_tp_code" as const },
          { label: "일치", value: counts.match, cls: "text-green-600", key: "match" as const },
        ].map((s) => (
          <button key={s.label} onClick={() => setStatusFilter(s.key)}
            className={`bg-white rounded-lg border px-3 py-2.5 text-left cursor-pointer hover:border-gray-400 ${statusFilter === s.key ? "border-gray-900" : "border-gray-200"}`}>
            <p className="text-[11px] text-gray-400">{s.label}</p>
            <p className={`text-sm font-bold mt-0.5 ${s.cls}`}>{s.value}건</p>
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">판매사</label>
          <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="text-sm border border-gray-300 rounded px-2 py-1.5 min-w-[140px]">
            <option value="">전체</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">시작일</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-sm border border-gray-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">종료일</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-sm border border-gray-300 rounded px-2 py-1.5" />
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer ml-auto">
          <input type="checkbox" checked={includeVerified} onChange={(e) => setIncludeVerified(e.target.checked)} className="w-3.5 h-3.5" />
          확인 완료 상품도 보기
        </label>
        <button onClick={() => setStatusFilter("problem")} className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 cursor-pointer">문제만 보기</button>
      </div>

      {/* 리스트 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">조건에 맞는 항목이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">상품명</th>
                  <th className="px-3 py-2 text-left font-medium">TP코드</th>
                  <th className="px-3 py-2 text-left font-medium">판매사</th>
                  <th className="px-3 py-2 text-center font-medium">주문수</th>
                  <th className="px-3 py-2 text-left font-medium">현재 공급사</th>
                  <th className="px-3 py-2 text-left font-medium">올바른 공급사</th>
                  <th className="px-3 py-2 text-center font-medium">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((g) => {
                  const meta = STATUS_META[g.status];
                  return (
                    <tr key={g.product_name} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.text}</span>
                        {g.mapping_verified && <div className="text-[10px] text-blue-500 mt-0.5">확인완료</div>}
                      </td>
                      <td className="px-3 py-2 max-w-[320px] text-gray-900">{g.product_name}</td>
                      <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{g.tp_code || "-"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 max-w-[160px]">{g.store_names.join(", ") || "-"}</td>
                      <td className="px-3 py-2 text-center text-gray-700">{g.order_count}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 max-w-[160px]">{g.current_supplier_names.join(", ")}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 max-w-[160px]">{g.expected_supplier_name || "-"}</td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {g.status === "mismatch" && g.expected_supplier_id && (
                            <button onClick={() => handleReassign(g)} className="text-[11px] px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer">재배정</button>
                          )}
                          {g.status === "unmatched_product" && (
                            <button onClick={() => openLink(g)} className="text-[11px] px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">상품 연결</button>
                          )}
                          {g.product_id && !g.mapping_verified && (
                            <button onClick={() => handleVerify(g.product_id!)} className="text-[11px] px-2 py-0.5 rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer">확인 완료</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 상품 연결 모달 */}
      {linkTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setLinkTarget(null)}>
          <div className="bg-white rounded-2xl w-[640px] max-h-[90vh] overflow-hidden flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">상품 연결</h2>
              <p className="text-xs text-gray-500 mt-1">주문 상품명: <span className="text-gray-900 font-medium">{linkTarget.product_name}</span></p>
              <p className="text-[11px] text-gray-500">연결 시 이 이름이 선택한 상품의 name_aliases에 추가되고, 해당 주문({linkTarget.order_count}건)의 공급사가 재배정되며, 연결된 모든 카페24 스토어에 자체상품코드(TP코드)가 푸시됩니다.</p>
            </div>
            <div className="p-5 border-b border-gray-100">
              <input
                type="text"
                autoFocus
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="상품명 또는 TP코드 검색"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {searching ? (
                <div className="p-8 text-center text-gray-400 text-sm">검색 중...</div>
              ) : productOptions.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">검색 결과 없음</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {productOptions.map((p) => (
                    <button key={p.id} onClick={() => confirmLink(p)} disabled={linking}
                      className="w-full text-left px-5 py-3 hover:bg-gray-50 cursor-pointer disabled:opacity-50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-900 line-clamp-2">{p.product_name}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">{p.supplier || "-"}</div>
                        </div>
                        <span className="text-xs font-mono font-bold text-[#C41E1E] bg-[#FFF0F5] px-2 py-0.5 rounded whitespace-nowrap">{p.tp_code || "-"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => setLinkTarget(null)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
