"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ══════════════════════════════════════════
   타입
   ══════════════════════════════════════════ */

type Cafe24Mapping = {
  id: string;
  store_id: string;
  cafe24_product_no: number | null;
  cafe24_product_code: string | null;
  sync_status: "none" | "pending" | "synced" | "error";
  last_sync_at: string | null;
};

type Product = {
  id: string;
  tp_code: string;
  product_name: string;
  price: number;
  supply_price: number;
  retail_price: number;
  image_url: string | null;
  selling: string;
  category: string | null;
  description: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  product_cafe24_mappings: Cafe24Mapping[];
};

type Store = {
  id: string;
  name: string;
  channel: string;
  subscribers: number;
  mall_id: string;
  store_url: string;
  status: string;
};

type SortKey = "tp_code" | "name" | "price" | "supply_price" | "margin" | "updated";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "card";
type SellingFilter = "all" | "selling" | "not_selling";

/* ══════════════════════════════════════════
   유틸
   ══════════════════════════════════════════ */

function formatNumber(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}천`;
  return n.toString();
}

function formatPrice(n: number): string {
  return `₩${n.toLocaleString()}`;
}

function marginRate(price: number, supply: number): string {
  if (!price || !supply || price <= 0) return "-";
  return `${(((price - supply) / price) * 100).toFixed(1)}%`;
}

function marginNum(price: number, supply: number): number {
  if (!price || !supply || price <= 0) return 0;
  return ((price - supply) / price) * 100;
}

const SYNC_STATUS: Record<string, { label: string; cls: string }> = {
  synced: { label: "동기화", cls: "bg-green-100 text-green-700" },
  pending: { label: "대기", cls: "bg-yellow-100 text-yellow-700" },
  error: { label: "오류", cls: "bg-red-100 text-red-700" },
  none: { label: "미연결", cls: "bg-gray-100 text-gray-500" },
};

/* ══════════════════════════════════════════
   탭 정의
   ══════════════════════════════════════════ */

const TABS = [
  { key: "inventory", label: "인벤토리" },
  { key: "mappings", label: "카페24 매핑" },
  { key: "overview", label: "현황" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/* ══════════════════════════════════════════
   메인 컴포넌트
   ══════════════════════════════════════════ */

export default function ProductsPage() {
  const [tab, setTab] = useState<TabKey>("inventory");
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [storesLoading, setStoresLoading] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [sellingFilter, setSellingFilter] = useState<SellingFilter>("all");
  const [catFilter, setCatFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // 정렬
  const [sortKey, setSortKey] = useState<SortKey>("tp_code");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // 뷰 모드
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // 카페24 가져오기
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");

  // 대량 동기화
  const [bulkSyncing, setBulkSyncing] = useState(false);

  const assignDropdownRef = useRef<HTMLDivElement>(null);

  /* ── 카페24 가져오기 ── */
  const importFromCafe24 = async () => {
    if (!confirm("카페24 마스터몰(shinsana)에서 자체상품코드가 있는 상품을 모두 가져옵니다.\n계속할까요?")) return;
    setImporting(true);
    setImportResult("");
    try {
      const res = await fetch("/admin/api/products/import-cafe24", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("가져오기 실패");
      const data = await res.json();
      setImportResult(data.message);
      fetchProducts(true);
    } catch (e) {
      setImportResult(e instanceof Error ? e.message : "가져오기 실패");
    } finally {
      setImporting(false);
    }
  };

  /* ── 데이터 로드 ── */
  const fetchProducts = useCallback(async (reset = false) => {
    setLoading(true);
    setError("");
    const newOffset = reset ? 0 : offset;
    const params = new URLSearchParams({ limit: "50", offset: String(newOffset) });
    if (keyword) params.set("keyword", keyword);
    if (catFilter) params.set("category", catFilter);
    if (sellingFilter === "selling") params.set("selling", "T");
    if (sellingFilter === "not_selling") params.set("selling", "F");

    try {
      const res = await fetch(`/admin/api/products?${params}`);
      if (!res.ok) throw new Error(`API 오류 (${res.status})`);
      const data = await res.json();
      const fetched: Product[] = data.products || [];
      if (reset) {
        setProducts(fetched);
        setOffset(fetched.length);
      } else {
        setProducts((prev) => [...prev, ...fetched]);
        setOffset(newOffset + fetched.length);
      }
      setTotal(data.total || fetched.length);
      setHasMore(fetched.length >= 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }, [offset, keyword, catFilter, sellingFilter]);

  const fetchStores = useCallback(async () => {
    setStoresLoading(true);
    try {
      const res = await fetch("/admin/api/stores");
      if (!res.ok) return;
      const data = await res.json();
      setStores((data.stores || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        name: (s.name as string) || "",
        channel: (s.channel as string) || "",
        subscribers: (s.subscribers as number) || 0,
        mall_id: (s.mall_id as string) || "",
        store_url: (s.store_url as string) || "",
        status: (s.status as string) || "pending",
      })));
    } catch { /* ignore */ }
    finally { setStoresLoading(false); }
  }, []);

  useEffect(() => {
    fetchProducts(true);
    fetchStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(e.target as Node)) {
        setShowAssignDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = () => {
    setOffset(0);
    fetchProducts(true);
  };

  /* ── 정렬 ── */
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sortedProducts = [...products].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "tp_code": return dir * a.tp_code.localeCompare(b.tp_code);
      case "name": return dir * a.product_name.localeCompare(b.product_name);
      case "price": return dir * (a.price - b.price);
      case "supply_price": return dir * (a.supply_price - b.supply_price);
      case "margin": return dir * (marginNum(a.price, a.supply_price) - marginNum(b.price, b.supply_price));
      case "updated": return dir * (a.updated_at.localeCompare(b.updated_at));
      default: return 0;
    }
  });

  /* ── 선택 ── */
  const toggleSelect = (id: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedProducts.size === sortedProducts.length) setSelectedProducts(new Set());
    else setSelectedProducts(new Set(sortedProducts.map((p) => p.id)));
  };

  /* ── 대량 상태 변경 ── */
  const bulkUpdateSelling = async (selling: "T" | "F") => {
    const label = selling === "T" ? "판매중" : "미판매";
    for (const pid of selectedProducts) {
      try {
        await fetch(`/admin/api/products/${pid}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selling }),
        });
      } catch { /* skip */ }
    }
    setSelectedProducts(new Set());
    fetchProducts(true);
    alert(`${selectedProducts.size}개 상품을 "${label}"로 변경했습니다.`);
  };

  /* ── 카페24 매핑 ── */
  const assignToStore = async (storeId: string) => {
    for (const pid of selectedProducts) {
      try {
        await fetch(`/admin/api/products/${pid}/mappings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store_id: storeId }),
        });
      } catch { /* skip */ }
    }
    setSelectedProducts(new Set());
    setShowAssignDropdown(false);
    fetchProducts(true);
  };

  const assignToAll = async () => {
    const activeStoreIds = stores.filter((s) => s.status === "active" || s.status === "connected").map((s) => s.id);
    for (const pid of selectedProducts) {
      for (const sid of activeStoreIds) {
        try {
          await fetch(`/admin/api/products/${pid}/mappings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ store_id: sid }),
          });
        } catch { /* skip */ }
      }
    }
    setSelectedProducts(new Set());
    setShowAssignDropdown(false);
    fetchProducts(true);
  };

  const removeMapping = async (productId: string, storeId: string) => {
    try {
      await fetch(`/admin/api/products/${productId}/mappings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId }),
      });
      fetchProducts(true);
    } catch { /* skip */ }
  };

  /* ── 상품 삭제 ── */
  /* ── 대량 동기화 ── */
  const bulkSync = async () => {
    if (!confirm(`${selectedProducts.size}개 상품을 매핑된 카페24 스토어에 동기화합니다.\n계속할까요?`)) return;
    setBulkSyncing(true);
    try {
      const res = await fetch("/admin/api/products/sync-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_ids: [...selectedProducts] }),
      });
      if (!res.ok) throw new Error("동기화 실패");
      const data = await res.json();
      alert(data.message);
      setSelectedProducts(new Set());
      fetchProducts(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "동기화 실패");
    } finally {
      setBulkSyncing(false);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!confirm("이 상품을 삭제하시겠습니까?")) return;
    try {
      await fetch(`/admin/api/products/${id}`, { method: "DELETE" });
      fetchProducts(true);
    } catch { /* skip */ }
  };

  const activeStores = stores.filter((s) => s.status === "active" || s.status === "connected");
  const getStoreName = (storeId: string) => stores.find((s) => s.id === storeId)?.name || storeId;
  const totalMappings = products.reduce((sum, p) => sum + p.product_cafe24_mappings.length, 0);
  const unmappedCount = products.filter((p) => p.product_cafe24_mappings.length === 0).length;
  const sellingCount = products.filter((p) => p.selling === "T").length;

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))] as string[];

  const SortIcon = ({ field }: { field: SortKey }) => {
    if (sortKey !== field) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-[#C41E1E] ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">상품관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            TubePing 자체코드(TP-XXXX)로 상품 통합 관리 → 카페24 스토어 매핑
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={importFromCafe24}
            disabled={importing}
            className="px-4 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            {importing ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            )}
            {importing ? "가져오는 중..." : "카페24 가져오기"}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            상품 등록
          </button>
          <span className="text-xs text-gray-400">
            {storesLoading ? "로딩..." : `${activeStores.length}개 스토어 연결`}
          </span>
        </div>
      </div>

      {/* 카페24 가져오기 결과 */}
      {importResult && (
        <div className="mb-4 p-4 bg-blue-50 text-blue-700 text-sm rounded-lg border border-blue-200 flex items-center justify-between">
          <span>{importResult}</span>
          <button onClick={() => setImportResult("")} className="text-xs text-blue-400 hover:text-blue-600 cursor-pointer">닫기</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: "전체 상품", value: total, color: "text-gray-900" },
          { label: "판매중", value: sellingCount, color: "text-green-600" },
          { label: "미판매", value: total - sellingCount, color: total - sellingCount > 0 ? "text-orange-500" : "text-gray-400" },
          { label: "카페24 매핑", value: totalMappings, color: "text-[#C41E1E]" },
          { label: "미매핑", value: unmappedCount, color: unmappedCount > 0 ? "text-yellow-600" : "text-gray-400" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs + View Toggle */}
      <div className="flex items-center justify-between mb-6 border-b border-gray-200">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors cursor-pointer rounded-t-lg ${
                tab === t.key
                  ? "text-[#C41E1E] bg-white border border-gray-200 border-b-white -mb-px"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "inventory" && (
          <div className="flex items-center gap-1 mr-2 -mb-px">
            <button onClick={() => setViewMode("table")} className={`p-2 rounded-lg cursor-pointer transition-colors ${viewMode === "table" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`} title="테이블 뷰">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
            </button>
            <button onClick={() => setViewMode("card")} className={`p-2 rounded-lg cursor-pointer transition-colors ${viewMode === "card" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`} title="카드 뷰">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
            </button>
          </div>
        )}
      </div>

      {/* ─── 인벤토리 탭 ─── */}
      {tab === "inventory" && (
        <div className="space-y-4">
          {/* 검색 + 필터 */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <svg className="w-4 h-4 absolute left-3 top-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="상품명 또는 TP코드 검색..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="w-80 pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
              />
            </div>
            {categories.length > 0 && (
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
              >
                <option value="">전체 카테고리</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <select
              value={sellingFilter}
              onChange={(e) => { setSellingFilter(e.target.value as SellingFilter); setTimeout(() => { setOffset(0); fetchProducts(true); }, 0); }}
              className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
            >
              <option value="all">전체 상태</option>
              <option value="selling">판매중</option>
              <option value="not_selling">미판매</option>
            </select>
            <button onClick={handleSearch} className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer">검색</button>

            <div className="flex-1" />

            {/* 대량 작업 */}
            {selectedProducts.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-medium">{selectedProducts.size}개 선택</span>
                <button onClick={() => bulkUpdateSelling("T")} className="px-3 py-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 cursor-pointer">판매 전환</button>
                <button onClick={() => bulkUpdateSelling("F")} className="px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 cursor-pointer">미판매 전환</button>
                <button onClick={bulkSync} disabled={bulkSyncing} className="px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 cursor-pointer flex items-center gap-1">
                  {bulkSyncing ? (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  )}
                  {bulkSyncing ? "동기화 중..." : "카페24 동기화"}
                </button>
                <div className="relative" ref={assignDropdownRef}>
                  <button onClick={() => setShowAssignDropdown(!showAssignDropdown)} className="px-4 py-2 bg-[#111111] text-white text-xs font-medium rounded-lg hover:bg-gray-800 cursor-pointer">스토어 매핑</button>
                  {showAssignDropdown && (
                    <div className="absolute right-0 top-10 w-72 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-2 max-h-[400px] overflow-y-auto">
                      <p className="px-4 py-2 text-xs text-gray-500 font-semibold border-b border-gray-100 mb-1">매핑할 카페24 스토어 선택</p>
                      {activeStores.length === 0 ? (
                        <p className="px-4 py-4 text-xs text-gray-400 text-center">연결된 스토어가 없습니다</p>
                      ) : (
                        <>
                          {activeStores.map((s) => (
                            <button key={s.id} onClick={() => assignToStore(s.id)} className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center justify-between cursor-pointer">
                              <div>
                                <p className="text-sm font-medium text-gray-900">{s.name}</p>
                                <p className="text-[10px] text-gray-400">{s.mall_id}.cafe24.com</p>
                              </div>
                              <span className="text-xs text-[#C41E1E] font-bold">+{selectedProducts.size}</span>
                            </button>
                          ))}
                          <div className="border-t border-gray-100 mt-1 pt-1">
                            <button onClick={assignToAll} className="w-full px-4 py-2.5 text-left hover:bg-[#FFF0F5] cursor-pointer">
                              <p className="text-sm font-bold text-[#C41E1E]">전체 스토어에 매핑</p>
                              <p className="text-[10px] text-gray-400">{activeStores.length}개 활성 스토어</p>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
              <button onClick={() => fetchProducts(true)} className="ml-auto text-xs text-red-500 hover:text-red-700 font-medium cursor-pointer">재시도</button>
            </div>
          )}

          {/* 테이블 뷰 */}
          {viewMode === "table" && (
            <div className="bg-white rounded-xl border border-gray-200">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-4 py-3 font-medium w-10">
                      <input type="checkbox" checked={selectedProducts.size > 0 && selectedProducts.size === sortedProducts.length} onChange={selectAll} className="rounded border-gray-300 cursor-pointer" />
                    </th>
                    <th className="text-left px-3 py-3 font-medium w-14">이미지</th>
                    <th className="text-left px-3 py-3 font-medium w-24 cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort("tp_code")}>
                      TP코드<SortIcon field="tp_code" />
                    </th>
                    <th className="text-left px-3 py-3 font-medium cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort("name")}>
                      상품명<SortIcon field="name" />
                    </th>
                    <th className="text-right px-3 py-3 font-medium cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort("price")}>
                      판매가<SortIcon field="price" />
                    </th>
                    <th className="text-right px-3 py-3 font-medium cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort("supply_price")}>
                      공급가<SortIcon field="supply_price" />
                    </th>
                    <th className="text-right px-3 py-3 font-medium cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort("margin")}>
                      마진<SortIcon field="margin" />
                    </th>
                    <th className="text-center px-3 py-3 font-medium">상태</th>
                    <th className="text-center px-3 py-3 font-medium">카페24 매핑</th>
                    <th className="text-center px-4 py-3 font-medium w-16">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && products.length === 0 ? (
                    <tr><td colSpan={10} className="px-6 py-16 text-center text-sm text-gray-400">상품 로딩 중...</td></tr>
                  ) : sortedProducts.length === 0 ? (
                    <tr><td colSpan={10} className="px-6 py-16 text-center text-sm text-gray-400">
                      등록된 상품이 없습니다. &quot;상품 등록&quot; 버튼으로 첫 상품을 추가하세요.
                    </td></tr>
                  ) : sortedProducts.map((p) => {
                    const isSelected = selectedProducts.has(p.id);
                    const mr = marginNum(p.price, p.supply_price);
                    const mappings = p.product_cafe24_mappings || [];

                    return (
                      <tr key={p.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors ${isSelected ? "bg-[#FFF0F5]/40" : ""}`}>
                        <td className="px-4 py-2.5">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(p.id)} className="rounded border-gray-300 cursor-pointer" />
                        </td>
                        <td className="px-3 py-2.5">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" className="w-11 h-11 rounded-lg object-cover border border-gray-100" />
                          ) : (
                            <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">없음</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-mono font-bold text-[#C41E1E] bg-[#FFF0F5] px-2 py-0.5 rounded">{p.tp_code}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => setEditingProduct(p)} className="text-sm font-medium text-gray-900 hover:text-[#C41E1E] text-left cursor-pointer line-clamp-2 max-w-[240px] transition-colors">
                            {p.product_name}
                          </button>
                          {p.category && <p className="text-[10px] text-gray-400 mt-0.5">{p.category}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-gray-900 text-right font-medium">{formatPrice(p.price)}</td>
                        <td className="px-3 py-2.5 text-sm text-gray-500 text-right">{formatPrice(p.supply_price)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-sm font-medium ${mr >= 30 ? "text-green-600" : mr >= 20 ? "text-blue-600" : "text-gray-500"}`}>
                            {marginRate(p.price, p.supply_price)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.selling === "T" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {p.selling === "T" ? "판매중" : "미판매"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {mappings.length > 0 ? (
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              {mappings.slice(0, 3).map((m) => (
                                <span key={m.id} className={`text-[9px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${SYNC_STATUS[m.sync_status]?.cls || "bg-gray-100 text-gray-500"}`}>
                                  {getStoreName(m.store_id)}
                                </span>
                              ))}
                              {mappings.length > 3 && <span className="text-[9px] text-gray-400">+{mappings.length - 3}</span>}
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-300">미매핑</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button onClick={() => deleteProduct(p.id)} className="text-xs text-gray-400 hover:text-red-500 cursor-pointer" title="삭제">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500">{sortedProducts.length}개 표시 / 총 {total}개</span>
                <div className="flex items-center gap-3">
                  {loading && <span className="text-xs text-gray-400">로딩 중...</span>}
                  {hasMore && !loading && (
                    <button onClick={() => fetchProducts(false)} className="px-4 py-2 text-sm text-[#C41E1E] font-medium border border-[#C41E1E]/30 rounded-lg hover:bg-[#FFF0F5] cursor-pointer">
                      더 불러오기
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 카드 뷰 */}
          {viewMode === "card" && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sortedProducts.map((p) => {
                  const isSelected = selectedProducts.has(p.id);
                  const mr = marginNum(p.price, p.supply_price);
                  const mappings = p.product_cafe24_mappings || [];

                  return (
                    <div key={p.id} className={`bg-white rounded-xl border overflow-hidden hover:shadow-md transition-all ${isSelected ? "border-[#C41E1E] ring-1 ring-[#C41E1E]/20" : "border-gray-200"}`}>
                      <div className="relative aspect-square bg-gray-50">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-sm text-gray-300">No Image</div>
                        )}
                        <div className="absolute top-2 left-2">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(p.id)} className="w-4 h-4 rounded border-gray-300 cursor-pointer" />
                        </div>
                        <div className="absolute top-2 right-2 flex gap-1">
                          <span className="text-[10px] font-mono font-bold text-[#C41E1E] bg-white/90 px-1.5 py-0.5 rounded">{p.tp_code}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${p.selling === "T" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {p.selling === "T" ? "판매중" : "미판매"}
                          </span>
                        </div>
                      </div>
                      <div className="p-3.5">
                        <button onClick={() => setEditingProduct(p)} className="text-sm font-medium text-gray-900 hover:text-[#C41E1E] text-left cursor-pointer line-clamp-2 leading-snug transition-colors">
                          {p.product_name}
                        </button>
                        <div className="flex items-center justify-between mt-2.5">
                          <span className="text-base font-bold text-gray-900">{formatPrice(p.price)}</span>
                          <span className={`text-xs font-medium ${mr >= 30 ? "text-green-600" : mr >= 20 ? "text-blue-600" : "text-gray-400"}`}>
                            마진 {marginRate(p.price, p.supply_price)}
                          </span>
                        </div>
                        {mappings.length > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FFF0F5] text-[#C41E1E] font-medium">
                              {mappings.length}개 스토어 매핑
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {sortedProducts.length === 0 && !loading && (
                <div className="text-center py-16 text-sm text-gray-400">등록된 상품이 없습니다.</div>
              )}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-gray-500">{sortedProducts.length}개 표시 / 총 {total}개</span>
                {hasMore && !loading && (
                  <button onClick={() => fetchProducts(false)} className="px-4 py-2 text-sm text-[#C41E1E] font-medium border border-[#C41E1E]/30 rounded-lg hover:bg-[#FFF0F5] cursor-pointer">더 불러오기</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 카페24 매핑 탭 ─── */}
      {tab === "mappings" && (
        <MappingsTab
          products={products}
          stores={stores}
          storesLoading={storesLoading}
          getStoreName={getStoreName}
          removeMapping={removeMapping}
        />
      )}

      {/* ─── 현황 탭 ─── */}
      {tab === "overview" && (
        <OverviewTab products={products} stores={stores} getStoreName={getStoreName} />
      )}

      {/* 상품 등록 모달 */}
      {showAddModal && (
        <AddProductModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); fetchProducts(true); }}
        />
      )}

      {/* 상품 수정 모달 */}
      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          stores={stores}
          getStoreName={getStoreName}
          onClose={() => setEditingProduct(null)}
          onSaved={() => { setEditingProduct(null); fetchProducts(true); }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   상품 등록 모달
   ══════════════════════════════════════════ */

function AddProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    product_name: "",
    price: "",
    supply_price: "",
    retail_price: "",
    image_url: "",
    category: "",
    description: "",
    memo: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!form.product_name.trim()) { setError("상품명을 입력하세요"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/admin/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          price: Number(form.price) || 0,
          supply_price: Number(form.supply_price) || 0,
          retail_price: Number(form.retail_price) || 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "등록 실패");
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록 실패");
    } finally {
      setSaving(false);
    }
  };

  const margin = Number(form.price) > 0
    ? (((Number(form.price) - Number(form.supply_price)) / Number(form.price)) * 100).toFixed(1)
    : "0";

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[560px] bg-white h-full overflow-y-auto shadow-xl border-l border-gray-200">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg cursor-pointer">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-gray-900">상품 등록</h2>
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-500 max-w-[200px] truncate">{error}</span>}
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer">
              {saving ? "등록 중..." : "등록"}
            </button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-400">TP코드는 자동 생성됩니다 (TP-XXXX)</p>

          <Field label="상품명 *">
            <input type="text" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder="상품명을 입력하세요" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="판매가">
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-gray-400">₩</span>
                <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
              </div>
            </Field>
            <Field label="공급가">
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-gray-400">₩</span>
                <input type="number" value={form.supply_price} onChange={(e) => setForm({ ...form, supply_price: e.target.value })} className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
              </div>
            </Field>
            <Field label="소비자가">
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-gray-400">₩</span>
                <input type="number" value={form.retail_price} onChange={(e) => setForm({ ...form, retail_price: e.target.value })} className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
              </div>
            </Field>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg flex items-center gap-6">
            <div className="text-xs text-gray-500">
              마진: <span className={`font-bold text-sm ${Number(margin) >= 30 ? "text-green-600" : Number(margin) >= 20 ? "text-blue-600" : "text-red-500"}`}>{margin}%</span>
            </div>
            <div className="text-xs text-gray-500">
              마진액: <span className="font-bold text-sm text-gray-900">₩{(Number(form.price) - Number(form.supply_price)).toLocaleString()}</span>
            </div>
          </div>

          <Field label="대표 이미지 URL">
            <input type="text" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          <Field label="카테고리">
            <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="예: 건강식품, 전자기기, 뷰티" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          <Field label="상품 설명">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="상품 설명..." className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          <Field label="관리자 메모">
            <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} rows={2} placeholder="내부 참고용 메모..." className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   상품 수정 모달
   ══════════════════════════════════════════ */

function EditProductModal({
  product, stores, getStoreName, onClose, onSaved,
}: {
  product: Product;
  stores: Store[];
  getStoreName: (id: string) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    product_name: product.product_name,
    price: String(product.price),
    supply_price: String(product.supply_price),
    retail_price: String(product.retail_price),
    image_url: product.image_url || "",
    selling: product.selling,
    category: product.category || "",
    description: product.description || "",
    memo: product.memo || "",
  });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaveMsg("");
    try {
      const res = await fetch(`/admin/api/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          price: Number(form.price) || 0,
          supply_price: Number(form.supply_price) || 0,
          retail_price: Number(form.retail_price) || 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "저장 실패");
      }
      setSaveMsg("저장 완료!");
      setTimeout(() => onSaved(), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError("");
    setSaveMsg("");
    try {
      // 먼저 저장
      const saveRes = await fetch(`/admin/api/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          price: Number(form.price) || 0,
          supply_price: Number(form.supply_price) || 0,
          retail_price: Number(form.retail_price) || 0,
        }),
      });
      if (!saveRes.ok) throw new Error("저장 실패");

      // 동기화
      const syncRes = await fetch(`/admin/api/products/${product.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!syncRes.ok) throw new Error("동기화 실패");
      const data = await syncRes.json();
      setSaveMsg(data.message);
      setTimeout(() => onSaved(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "동기화 실패");
    } finally {
      setSyncing(false);
    }
  };

  const margin = Number(form.price) > 0
    ? (((Number(form.price) - Number(form.supply_price)) / Number(form.price)) * 100).toFixed(1)
    : "0";

  const mappings = product.product_cafe24_mappings || [];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[600px] bg-white h-full overflow-y-auto shadow-xl border-l border-gray-200">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg cursor-pointer">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-gray-900">상품 수정</h2>
            <span className="text-xs font-mono font-bold text-[#C41E1E] bg-[#FFF0F5] px-2 py-0.5 rounded">{product.tp_code}</span>
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && <span className="text-xs text-green-600 font-medium">{saveMsg}</span>}
            {error && <span className="text-xs text-red-500 max-w-[200px] truncate">{error}</span>}
            <button onClick={handleSave} disabled={saving || syncing} className="px-5 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer">
              {saving ? "저장 중..." : "저장"}
            </button>
            {mappings.length > 0 && (
              <button onClick={handleSync} disabled={saving || syncing} className="px-5 py-2 bg-[#111111] text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 cursor-pointer flex items-center gap-1.5">
                {syncing ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                )}
                {syncing ? "동기화 중..." : "저장 + 동기화"}
              </button>
            )}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* 미리보기 */}
          <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
            {form.image_url ? (
              <img src={form.image_url} alt="" className="w-20 h-20 rounded-xl object-cover border border-gray-200" />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-gray-200 flex items-center justify-center text-xs text-gray-400">No img</div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-gray-900">{form.product_name || "(상품명)"}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-sm text-gray-900 font-medium">₩{Number(form.price).toLocaleString()}</span>
                <span className="text-xs text-gray-400">공급가 ₩{Number(form.supply_price).toLocaleString()}</span>
                <span className={`text-xs font-medium ${Number(margin) >= 30 ? "text-green-600" : Number(margin) >= 20 ? "text-blue-600" : "text-gray-500"}`}>
                  마진 {margin}%
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${form.selling === "T" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {form.selling === "T" ? "판매중" : "미판매"}
                </span>
                <span className="text-[10px] text-gray-400">카페24 매핑 {mappings.length}개</span>
              </div>
            </div>
          </div>

          {/* 기본 정보 */}
          <Field label="상품명">
            <input type="text" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="판매가">
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-gray-400">₩</span>
                <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
              </div>
            </Field>
            <Field label="공급가">
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-gray-400">₩</span>
                <input type="number" value={form.supply_price} onChange={(e) => setForm({ ...form, supply_price: e.target.value })} className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
              </div>
            </Field>
            <Field label="소비자가">
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-gray-400">₩</span>
                <input type="number" value={form.retail_price} onChange={(e) => setForm({ ...form, retail_price: e.target.value })} className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
              </div>
            </Field>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg flex items-center gap-6">
            <div className="text-xs text-gray-500">마진: <span className={`font-bold text-sm ${Number(margin) >= 30 ? "text-green-600" : Number(margin) >= 20 ? "text-blue-600" : "text-red-500"}`}>{margin}%</span></div>
            <div className="text-xs text-gray-500">마진액: <span className="font-bold text-sm text-gray-900">₩{(Number(form.price) - Number(form.supply_price)).toLocaleString()}</span></div>
          </div>

          <Field label="판매 상태">
            <select value={form.selling} onChange={(e) => setForm({ ...form, selling: e.target.value })} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none cursor-pointer">
              <option value="T">판매중</option>
              <option value="F">미판매</option>
            </select>
          </Field>

          <Field label="대표 이미지 URL">
            <input type="text" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          <Field label="카테고리">
            <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          <Field label="상품 설명">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          <Field label="관리자 메모">
            <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} rows={2} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
          </Field>

          {/* 카페24 매핑 현황 */}
          {mappings.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-500 mb-2">카페24 매핑 ({mappings.length}개)</h3>
              <div className="space-y-2">
                {mappings.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{getStoreName(m.store_id)}</p>
                      <p className="text-[10px] text-gray-400">
                        {m.cafe24_product_code ? `코드: ${m.cafe24_product_code}` : ""}
                        {m.cafe24_product_no ? ` · No: ${m.cafe24_product_no}` : ""}
                      </p>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${SYNC_STATUS[m.sync_status]?.cls || "bg-gray-100 text-gray-500"}`}>
                      {SYNC_STATUS[m.sync_status]?.label || m.sync_status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
            생성: {new Date(product.created_at).toLocaleString("ko")} · 수정: {new Date(product.updated_at).toLocaleString("ko")}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   카페24 매핑 탭
   ══════════════════════════════════════════ */

function MappingsTab({
  products, stores, storesLoading, getStoreName, removeMapping,
}: {
  products: Product[];
  stores: Store[];
  storesLoading: boolean;
  getStoreName: (id: string) => string;
  removeMapping: (productId: string, storeId: string) => void;
}) {
  const activeStores = stores.filter((s) => s.status === "active" || s.status === "connected");
  const [filterStoreId, setFilterStoreId] = useState("");

  // 스토어별 매핑 현황
  const storeMap = new Map<string, { store: Store; mappings: { product: Product; mapping: Cafe24Mapping }[] }>();
  for (const s of activeStores) {
    storeMap.set(s.id, { store: s, mappings: [] });
  }
  for (const p of products) {
    for (const m of p.product_cafe24_mappings || []) {
      const entry = storeMap.get(m.store_id);
      if (entry) entry.mappings.push({ product: p, mapping: m });
    }
  }

  if (storesLoading) {
    return <div className="flex items-center justify-center py-20 text-gray-400">스토어 데이터 로딩 중...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">TubePing 자체 상품 ↔ 카페24 스토어 매핑 현황</p>
        {activeStores.length > 0 && (
          <select value={filterStoreId} onChange={(e) => setFilterStoreId(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg cursor-pointer">
            <option value="">전체 스토어</option>
            {activeStores.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.mall_id})</option>
            ))}
          </select>
        )}
      </div>

      {activeStores.length === 0 ? (
        <div className="text-center py-20 text-sm text-gray-400">연결된 스토어가 없습니다.</div>
      ) : (
        [...storeMap.entries()]
          .filter(([id]) => !filterStoreId || id === filterStoreId)
          .map(([id, { store, mappings }]) => (
            <div key={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 flex items-center justify-between bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#C41E1E] flex items-center justify-center">
                    <span className="text-white font-bold text-xs">{store.name.slice(0, 2)}</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{store.name}</h3>
                    <p className="text-xs text-gray-400">{store.mall_id}.cafe24.com · {store.channel || ""}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-900">{mappings.length}개 매핑</span>
              </div>

              {mappings.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">매핑된 상품이 없습니다.</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="text-[11px] text-gray-400 border-b border-gray-50">
                      <th className="text-left px-6 py-2 font-medium">TP코드</th>
                      <th className="text-left px-3 py-2 font-medium">상품명</th>
                      <th className="text-left px-3 py-2 font-medium">카페24 코드</th>
                      <th className="text-right px-3 py-2 font-medium">판매가</th>
                      <th className="text-center px-3 py-2 font-medium">동기화</th>
                      <th className="text-center px-6 py-2 font-medium">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map(({ product: p, mapping: m }) => (
                      <tr key={m.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
                        <td className="px-6 py-2.5">
                          <span className="text-xs font-mono font-bold text-[#C41E1E] bg-[#FFF0F5] px-2 py-0.5 rounded">{p.tp_code}</span>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-gray-900 line-clamp-1 max-w-[200px]">{p.product_name}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 font-mono">{m.cafe24_product_code || "-"}</td>
                        <td className="px-3 py-2.5 text-sm text-gray-700 text-right">{formatPrice(p.price)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${SYNC_STATUS[m.sync_status]?.cls || "bg-gray-100 text-gray-500"}`}>
                            {SYNC_STATUS[m.sync_status]?.label || m.sync_status}
                          </span>
                        </td>
                        <td className="px-6 py-2.5 text-center">
                          <button onClick={() => removeMapping(p.id, m.store_id)} className="text-xs text-gray-400 hover:text-red-500 cursor-pointer">해제</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   현황 탭
   ══════════════════════════════════════════ */

function OverviewTab({
  products, stores, getStoreName,
}: {
  products: Product[];
  stores: Store[];
  getStoreName: (id: string) => string;
}) {
  const totalMappings = products.reduce((sum, p) => sum + p.product_cafe24_mappings.length, 0);
  const unmappedCount = products.filter((p) => p.product_cafe24_mappings.length === 0).length;
  const sellingCount = products.filter((p) => p.selling === "T").length;
  const avgMargin = products.length > 0
    ? products.reduce((sum, p) => sum + marginNum(p.price, p.supply_price), 0) / products.length
    : 0;

  // 카테고리별
  const catMap = new Map<string, number>();
  for (const p of products) {
    const cat = p.category || "미분류";
    catMap.set(cat, (catMap.get(cat) || 0) + 1);
  }

  // 스토어별 매핑 수
  const storeMappingCount = new Map<string, number>();
  for (const p of products) {
    for (const m of p.product_cafe24_mappings) {
      storeMappingCount.set(m.store_id, (storeMappingCount.get(m.store_id) || 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "전체 상품", value: products.length, color: "text-gray-900" },
          { label: "판매중", value: sellingCount, color: "text-green-600" },
          { label: "미판매", value: products.length - sellingCount, color: products.length - sellingCount > 0 ? "text-orange-500" : "text-gray-400" },
          { label: "카페24 매핑", value: totalMappings, color: "text-[#C41E1E]" },
          { label: "미매핑", value: unmappedCount, color: unmappedCount > 0 ? "text-yellow-600" : "text-gray-400" },
          { label: "평균 마진", value: `${avgMargin.toFixed(1)}%`, color: avgMargin >= 30 ? "text-green-600" : "text-blue-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center hover:shadow-sm transition-shadow">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 카테고리별 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">카테고리별 상품</h3>
          {catMap.size === 0 ? (
            <p className="text-xs text-gray-400">데이터 없음</p>
          ) : (
            <div className="space-y-2">
              {[...catMap.entries()].sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{cat}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#C41E1E] rounded-full" style={{ width: `${(count / products.length) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 스토어별 매핑 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">스토어별 매핑 현황</h3>
          {storeMappingCount.size === 0 ? (
            <p className="text-xs text-gray-400">매핑된 스토어 없음</p>
          ) : (
            <div className="space-y-2">
              {[...storeMappingCount.entries()].sort((a, b) => b[1] - a[1]).map(([sid, count]) => (
                <div key={sid} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{getStoreName(sid)}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min((count / products.length) * 100, 100)}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#FFF0F5] rounded-xl border border-[#C41E1E]/10 p-6">
        <h3 className="text-sm font-bold text-[#C41E1E] mb-3">운영 흐름</h3>
        <div className="grid grid-cols-4 gap-4">
          {[
            { step: "1", title: "상품 등록", desc: "TubePing 자체코드(TP-XXXX)로 상품 통합 관리" },
            { step: "2", title: "카페24 매핑", desc: "자체 상품을 여러 카페24 스토어에 매핑" },
            { step: "3", title: "동기화", desc: "매핑된 상품을 카페24 스토어에 자동 동기화" },
            { step: "4", title: "통합 관리", desc: "가격/재고 변경은 TubePing에서. 동기화로 전체 반영" },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="w-8 h-8 rounded-full bg-[#C41E1E] text-white font-bold text-sm flex items-center justify-center mx-auto mb-2">{item.step}</div>
              <p className="text-sm font-semibold text-gray-900">{item.title}</p>
              <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── 필드 래퍼 ── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
