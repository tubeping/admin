"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

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
  // 판매사몰 가격 레이어 (import-seller-mall 로 채워짐)
  seller_price?: number | null;
  seller_shipping_fee?: number | null;
  seller_product_code?: string | null;
  seller_synced_at?: string | null;
};

type Variant = {
  id: string;
  variant_code: string | null;
  option_name: string | null;
  option_value: string | null;
  option_text: string | null;
  price: number;
  supply_price: number;
  retail_price: number;
  supply_shipping_fee: number;
  tax_type: string;
  quantity: number;
  display: string;
  selling: string;
};

type ApprovalStatus = "pending" | "requested" | "re_requested" | "approved" | "rejected";

type Product = {
  id: string;
  tp_code: string;
  product_name: string;
  price: number;
  supply_price: number;
  retail_price: number;
  supply_shipping_fee: number;
  image_url: string | null;
  selling: string;
  display: string;
  approval_status: string;
  category: string | null;
  description: string | null;
  memo: string | null;
  supplier: string | null;
  total_stock: number;
  fulfillment_warehouse_supplier_id: string | null;
  created_at: string;
  updated_at: string;
  product_cafe24_mappings: Cafe24Mapping[];
  product_variants: Variant[];
};

type SupplierOption = {
  id: string;
  name: string;
  short_code: string | null;
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
type DisplayFilter = "all" | "displayed" | "hidden";
type FulfillmentFilter = "all" | "direct" | "warehouse";
type ApprovalFilter = "all" | "pending" | "requested" | "re_requested" | "approved" | "rejected";
type StockFilter = "all" | "out" | "in";

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

const APPROVAL_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "승인대기", cls: "bg-gray-100 text-gray-600" },
  requested: { label: "승인요청", cls: "bg-blue-100 text-blue-700" },
  re_requested: { label: "재승인요청", cls: "bg-yellow-100 text-yellow-700" },
  approved: { label: "승인완료", cls: "bg-green-100 text-green-700" },
  rejected: { label: "반려", cls: "bg-red-100 text-red-700" },
};

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
  { key: "store-prices", label: "판매사 가격" },
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
  const [displayFilter, setDisplayFilter] = useState<DisplayFilter>("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<FulfillmentFilter>("all");
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  // 전체 통계 (서버에서 별도 로드 — 현재 페이지가 아닌 전체 기준)
  const [summaryStats, setSummaryStats] = useState({ total: 0, selling: 0, totalMappings: 0, unmapped: 0, categories: [] as string[], suppliers: [] as string[] });

  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [showSendDropdown, setShowSendDropdown] = useState(false);
  const [showFulfillmentDropdown, setShowFulfillmentDropdown] = useState(false);
  const [propagating, setPropagating] = useState(false);
  const [linkOnConflict, setLinkOnConflict] = useState(true);
  const [warehouses, setWarehouses] = useState<SupplierOption[]>([]);
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
  const sendDropdownRef = useRef<HTMLDivElement>(null);
  const fulfillmentDropdownRef = useRef<HTMLDivElement>(null);

  /* ── 전체 통계 로드 ── */
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/products/summary-stats");
      if (!res.ok) return;
      const data = await res.json();
      setSummaryStats(data);
    } catch { /* ignore */ }
  }, []);

  /* ── 데이터 로드 (서버사이드 페이지네이션) ── */
  const fetchProducts = useCallback(async (resetPage = false) => {
    setLoading(true);
    setError("");

    const currentPage = resetPage ? 0 : page;
    if (resetPage) {
      setPage(0);
      setSelectedProducts(new Set());
    }

    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(currentPage * PAGE_SIZE));
    params.set("with_count", "1");
    if (keyword) params.set("keyword", keyword);
    if (catFilter) params.set("category", catFilter);
    if (sellingFilter === "selling") params.set("selling", "T");
    if (sellingFilter === "not_selling") params.set("selling", "F");
    if (displayFilter === "displayed") params.set("display", "T");
    if (displayFilter === "hidden") params.set("display", "F");
    if (approvalFilter !== "all") params.set("approval_status", approvalFilter);
    if (fulfillmentFilter !== "all") params.set("fulfillment", fulfillmentFilter);
    if (stockFilter !== "all") params.set("stock", stockFilter);
    if (supplierFilter) params.set("supplier", supplierFilter);

    try {
      const res = await fetch(`/admin/api/products?${params}`);
      if (!res.ok) throw new Error(`API 오류 (${res.status})`);
      const data = await res.json();
      setProducts(data.products || []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }, [keyword, catFilter, sellingFilter, displayFilter, approvalFilter, fulfillmentFilter, stockFilter, supplierFilter, page]);

  // ref로 최신 fetchProducts를 추적 (useEffect에서 stale closure 방지)
  const fetchProductsRef = useRef(fetchProducts);
  fetchProductsRef.current = fetchProducts;

  /** 데이터 변경 후 목록 + 통계 모두 갱신 */
  const refreshAll = useCallback(() => {
    fetchProductsRef.current(true);
    fetchSummary();
  }, [fetchSummary]);

  /** 인라인 단일 필드 수정 (공급사·판매가·공급가·출고지). 낙관적 업데이트 후 PUT */
  const updateProductField = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      // 낙관적 반영
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      try {
        const res = await fetch(`/admin/api/products/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`저장 실패 (${res.status})`);
        // 공급사 변경 시 필터용 공급사 목록도 갱신
        if ("supplier" in patch) fetchSummary();
      } catch (e) {
        alert(e instanceof Error ? e.message : "저장 실패 — 다시 시도해주세요");
        fetchProductsRef.current?.(); // 서버 값으로 롤백
      }
    },
    [fetchSummary]
  );

  /* ── 카페24 가져오기 ── */
  const importFromCafe24 = async () => {
    if (!confirm("카페24 마스터몰(tubeping)에서 자체상품코드가 있는 상품을 모두 가져옵니다.\n계속할까요?")) return;
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
      refreshAll();
    } catch (e) {
      setImportResult(e instanceof Error ? e.message : "가져오기 실패");
    } finally {
      setImporting(false);
    }
  };

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

  // 초기 로드: 스토어 + 창고 + 전체 통계
  useEffect(() => {
    fetchStores();
    fetchSummary();
    (async () => {
      try {
        const res = await fetch("/admin/api/suppliers?status=active");
        if (!res.ok) return;
        const data = await res.json();
        const whs = (data.suppliers || [])
          .filter((s: SupplierOption) => (s.short_code || "").toUpperCase().startsWith("WH"))
          .map((s: SupplierOption) => ({ id: s.id, name: s.name, short_code: s.short_code }));
        setWarehouses(whs);
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 필터/페이지 변경 시 자동 fetch + 선택 초기화
  useEffect(() => {
    fetchProductsRef.current?.();
    setSelectedProducts(new Set());
  }, [sellingFilter, displayFilter, catFilter, approvalFilter, fulfillmentFilter, stockFilter, supplierFilter, page]);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(e.target as Node)) {
        setShowAssignDropdown(false);
      }
      if (sendDropdownRef.current && !sendDropdownRef.current.contains(e.target as Node)) {
        setShowSendDropdown(false);
      }
      if (fulfillmentDropdownRef.current && !fulfillmentDropdownRef.current.contains(e.target as Node)) {
        setShowFulfillmentDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = () => {
    setPage(0);
    fetchProducts(true);
  };

  /* ── 정렬 ── */
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // 출고/판매/진열/승인/재고/공급사 필터는 서버사이드 처리 → 여기선 정렬만
  const sortedProducts = useMemo(() => [...products].sort((a, b) => {
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
  }), [products, sortKey, sortDir]);

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

  /* ── 대량 상태 변경 (병렬) ── */
  const bulkUpdateSelling = async (selling: "T" | "F") => {
    const label = selling === "T" ? "판매중" : "미판매";
    const count = selectedProducts.size;
    await Promise.allSettled(
      [...selectedProducts].map((pid) =>
        fetch(`/admin/api/products/${pid}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selling }),
        })
      )
    );
    setSelectedProducts(new Set());
    refreshAll();
    alert(`${count}개 상품을 "${label}"로 변경했습니다.`);
  };

  /* ── 카페24 매핑 (병렬) ── */
  const assignToStore = async (storeId: string) => {
    await Promise.allSettled(
      [...selectedProducts].map((pid) =>
        fetch(`/admin/api/products/${pid}/mappings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store_id: storeId }),
        })
      )
    );
    setSelectedProducts(new Set());
    setShowAssignDropdown(false);
    refreshAll();
  };

  const assignToAll = async () => {
    const activeStoreIds = stores.filter((s) => s.status === "active" || s.status === "connected").map((s) => s.id);
    await Promise.allSettled(
      [...selectedProducts].flatMap((pid) =>
        activeStoreIds.map((sid) =>
          fetch(`/admin/api/products/${pid}/mappings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ store_id: sid }),
          })
        )
      )
    );
    setSelectedProducts(new Set());
    setShowAssignDropdown(false);
    refreshAll();
  };

  /* ── 스토어로 보내기 (propagate: 매핑 + 즉시 동기화) ── */
  const sendToStores = async (storeIds: string[]) => {
    if (storeIds.length === 0) return;
    const count = selectedProducts.size;
    setPropagating(true);
    try {
      const res = await fetch("/admin/api/products/propagate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_ids: [...selectedProducts],
          store_ids: storeIds,
          on_conflict: linkOnConflict ? "link" : "report",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "전송 실패");
        return;
      }
      const parts: string[] = [`${count}개 상품 × ${storeIds.length}개 스토어 처리`];
      if (data.ok_count > 0) parts.push(`${data.ok_count}개 성공`);
      if (data.conflict_count > 0) parts.push(`${data.conflict_count}개 충돌`);
      if (data.error_count > 0) parts.push(`${data.error_count}개 실패`);
      let msg = parts.join(" / ");
      if (data.conflict_count > 0 && !linkOnConflict) {
        const sample = data.conflicts.slice(0, 5).map((c: { tp_code: string; mall_id: string }) => `· ${c.tp_code} (${c.mall_id})`).join("\n");
        const more = data.conflicts.length > 5 ? `\n... 외 ${data.conflicts.length - 5}건` : "";
        msg += `\n\n[충돌 상세]\n${sample}${more}\n\n"이미 있으면 자동 연결" 옵션을 켜고 다시 보내면 연결됩니다.`;
      }
      alert(msg);
      setSelectedProducts(new Set());
      setShowSendDropdown(false);
      refreshAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "전송 실패");
    } finally {
      setPropagating(false);
    }
  };

  const sendToAllStores = async () => {
    const activeStoreIds = stores.filter((s) => s.status === "active" || s.status === "connected").map((s) => s.id);
    await sendToStores(activeStoreIds);
  };

  const removeMapping = async (productId: string, storeId: string) => {
    try {
      await fetch(`/admin/api/products/${productId}/mappings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId }),
      });
      refreshAll();
    } catch { /* skip */ }
  };

  /* ── 대량 출고 방식 변경 (병렬) ── */
  const bulkSetFulfillment = async (warehouseId: string | null) => {
    const label = warehouseId ? "창고발주" : "자체배송";
    if (!confirm(`${selectedProducts.size}개 상품을 "${label}"(으)로 변경합니다.\n계속할까요?`)) return;
    const count = selectedProducts.size;
    await Promise.allSettled(
      [...selectedProducts].map((pid) =>
        fetch(`/admin/api/products/${pid}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fulfillment_warehouse_supplier_id: warehouseId }),
        })
      )
    );
    setSelectedProducts(new Set());
    setShowFulfillmentDropdown(false);
    refreshAll();
    alert(`${count}개 상품을 "${label}"(으)로 변경했습니다.`);
  };

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
      refreshAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "동기화 실패");
    } finally {
      setBulkSyncing(false);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!confirm("이 상품을 삭제하시겠습니까?\n(연결된 주문·매출 기록은 보존되며 상품 연결만 해제됩니다)")) return;
    try {
      const res = await fetch(`/admin/api/products/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`삭제 실패: ${data.error ?? `서버 오류 (${res.status})`}`);
        return;
      }
      refreshAll();
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : "네트워크 오류"}`);
    }
  };

  const activeStores = useMemo(() => stores.filter((s) => s.status === "active" || s.status === "connected"), [stores]);
  const getStoreName = useCallback((storeId: string) => stores.find((s) => s.id === storeId)?.name || storeId, [stores]);

  // 전체 통계는 서버에서 로드한 summaryStats 사용
  const { totalMappings, unmappedCount, sellingCount } = useMemo(() => ({
    totalMappings: summaryStats.totalMappings,
    unmappedCount: summaryStats.unmapped,
    sellingCount: summaryStats.selling,
  }), [summaryStats]);

  // 카테고리는 서버에서 전체 목록을 가져옴
  const categories = summaryStats.categories;

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

      {/* Stats — 전체 기준 (서버 통계) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: "전체 상품", value: summaryStats.total, color: "text-gray-900" },
          { label: "판매중", value: sellingCount, color: "text-green-600" },
          { label: "미판매", value: summaryStats.total - sellingCount, color: summaryStats.total - sellingCount > 0 ? "text-orange-500" : "text-gray-400" },
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
                placeholder="상품명 / TP코드 / 공급사명 / 공급사코드(예: ar) 검색..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="w-80 pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
              />
            </div>
            {categories.length > 0 && (
              <select
                value={catFilter}
                onChange={(e) => { setPage(0); setCatFilter(e.target.value); }}
                className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
              >
                <option value="">전체 카테고리</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {summaryStats.suppliers.length > 0 && (
              <select
                value={supplierFilter}
                onChange={(e) => { setPage(0); setSupplierFilter(e.target.value); }}
                className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
              >
                <option value="">전체 공급사</option>
                {summaryStats.suppliers.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            <select
              value={sellingFilter}
              onChange={(e) => { setPage(0); setSellingFilter(e.target.value as SellingFilter); }}
              className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
            >
              <option value="all">전체 판매</option>
              <option value="selling">판매중</option>
              <option value="not_selling">미판매</option>
            </select>
            <select
              value={displayFilter}
              onChange={(e) => { setPage(0); setDisplayFilter(e.target.value as DisplayFilter); }}
              className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
            >
              <option value="all">전체 진열</option>
              <option value="displayed">진열함</option>
              <option value="hidden">진열안함</option>
            </select>
            <select
              value={approvalFilter}
              onChange={(e) => { setPage(0); setApprovalFilter(e.target.value as ApprovalFilter); }}
              className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
            >
              <option value="all">전체 승인</option>
              <option value="pending">승인대기</option>
              <option value="requested">승인요청</option>
              <option value="re_requested">재승인요청</option>
              <option value="approved">승인완료</option>
              <option value="rejected">반려</option>
            </select>
            <select
              value={fulfillmentFilter}
              onChange={(e) => { setPage(0); setFulfillmentFilter(e.target.value as FulfillmentFilter); }}
              className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
            >
              <option value="all">전체 출고지</option>
              <option value="direct">자체배송</option>
              <option value="warehouse">창고발주</option>
            </select>
            <select
              value={stockFilter}
              onChange={(e) => { setPage(0); setStockFilter(e.target.value as StockFilter); }}
              className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 focus:outline-none cursor-pointer"
            >
              <option value="all">전체 재고</option>
              <option value="in">재고있음</option>
              <option value="out">품절</option>
            </select>
            <button onClick={handleSearch} className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer">검색</button>
            {(catFilter || supplierFilter || sellingFilter !== "all" || displayFilter !== "all" || approvalFilter !== "all" || fulfillmentFilter !== "all" || stockFilter !== "all" || keyword) && (
              <button
                onClick={() => {
                  setPage(0);
                  setKeyword(""); setCatFilter(""); setSupplierFilter("");
                  setSellingFilter("all"); setDisplayFilter("all");
                  setApprovalFilter("all"); setFulfillmentFilter("all"); setStockFilter("all");
                  // 키워드만 걸려있던 경우 필터 deps가 안 바뀌어 effect가 안 돌 수 있어 명시적 재조회
                  setTimeout(() => fetchProductsRef.current?.(true), 0);
                }}
                className="px-3 py-2.5 text-sm font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                필터 초기화
              </button>
            )}

            <div className="flex-1" />

            {/* 대량 작업 */}
            {selectedProducts.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-medium">{selectedProducts.size}개 선택</span>
                <button onClick={() => bulkUpdateSelling("T")} className="px-3 py-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 cursor-pointer">판매 전환</button>
                <button onClick={() => bulkUpdateSelling("F")} className="px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 cursor-pointer">미판매 전환</button>
                <div className="relative" ref={fulfillmentDropdownRef}>
                  <button onClick={() => setShowFulfillmentDropdown(!showFulfillmentDropdown)} className="px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 cursor-pointer">출고 방식</button>
                  {showFulfillmentDropdown && (
                    <div className="absolute right-0 top-10 w-64 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-2">
                      <p className="px-4 py-2 text-xs text-gray-500 font-semibold border-b border-gray-100 mb-1">출고 방식 변경</p>
                      {warehouses.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-gray-400 text-center">
                          등록된 창고 공급사가 없습니다.<br />
                          (공급사 short_code를 WH로 지정)
                        </p>
                      ) : warehouses.map((w) => (
                        <button
                          key={w.id}
                          onClick={() => bulkSetFulfillment(w.id)}
                          className="w-full px-4 py-2.5 text-left hover:bg-amber-50 flex items-center justify-between cursor-pointer"
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">창고발주: {w.name}</p>
                            {w.short_code && <p className="text-[10px] text-gray-400">{w.short_code}</p>}
                          </div>
                        </button>
                      ))}
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <button onClick={() => bulkSetFulfillment(null)} className="w-full px-4 py-2.5 text-left hover:bg-gray-50 cursor-pointer">
                          <p className="text-sm font-medium text-gray-700">자체배송으로 해제</p>
                          <p className="text-[10px] text-gray-400">tp_code 공급사가 직접 출고</p>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={bulkSync} disabled={bulkSyncing} className="px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 cursor-pointer flex items-center gap-1">
                  {bulkSyncing ? (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  )}
                  {bulkSyncing ? "동기화 중..." : "카페24 동기화"}
                </button>
                <div className="relative" ref={sendDropdownRef}>
                  <button
                    onClick={() => setShowSendDropdown(!showSendDropdown)}
                    disabled={propagating}
                    className="px-4 py-2 bg-[#C41E1E] text-white text-xs font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer flex items-center gap-1"
                  >
                    {propagating ? (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                    )}
                    {propagating ? "전송 중..." : "스토어로 보내기"}
                  </button>
                  {showSendDropdown && (
                    <div className="absolute right-0 top-10 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-2 max-h-[500px] overflow-y-auto">
                      <p className="px-4 py-2 text-xs text-gray-500 font-semibold border-b border-gray-100 mb-1">
                        선택한 {selectedProducts.size}개 상품을 자식 카페24에 매핑 + 즉시 동기화
                      </p>
                      <label className="px-4 py-2 flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:bg-gray-50 border-b border-gray-100">
                        <input
                          type="checkbox"
                          checked={linkOnConflict}
                          onChange={(e) => setLinkOnConflict(e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        자식 mall에 같은 자체코드 상품 있으면 자동 연결
                      </label>
                      {activeStores.length === 0 ? (
                        <p className="px-4 py-4 text-xs text-gray-400 text-center">활성 스토어가 없습니다</p>
                      ) : (
                        <>
                          {activeStores.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => sendToStores([s.id])}
                              disabled={propagating}
                              className="w-full px-4 py-2.5 text-left hover:bg-[#FFF0F5] flex items-center justify-between cursor-pointer disabled:opacity-50"
                            >
                              <div>
                                <p className="text-sm font-medium text-gray-900">{s.name}</p>
                                <p className="text-[10px] text-gray-400">{s.mall_id}.cafe24.com</p>
                              </div>
                              <span className="text-xs text-[#C41E1E] font-bold">→</span>
                            </button>
                          ))}
                          <div className="border-t border-gray-100 mt-1 pt-1">
                            <button
                              onClick={sendToAllStores}
                              disabled={propagating}
                              className="w-full px-4 py-2.5 text-left hover:bg-[#FFF0F5] cursor-pointer disabled:opacity-50"
                            >
                              <p className="text-sm font-bold text-[#C41E1E]">전체 활성 스토어로 보내기</p>
                              <p className="text-[10px] text-gray-400">{activeStores.length}개 스토어 × {selectedProducts.size}개 상품</p>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
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
              <button onClick={refreshAll} className="ml-auto text-xs text-red-500 hover:text-red-700 font-medium cursor-pointer">재시도</button>
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
                    <th className="text-left px-3 py-3 font-medium w-24">공급사</th>
                    <th className="text-left px-3 py-3 font-medium w-28">출고지</th>
                    <th className="text-right px-3 py-3 font-medium cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort("price")}>
                      판매가<SortIcon field="price" />
                    </th>
                    <th className="text-right px-3 py-3 font-medium cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort("supply_price")}>
                      공급가<SortIcon field="supply_price" />
                    </th>
                    <th className="text-right px-3 py-3 font-medium cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort("margin")}>
                      마진<SortIcon field="margin" />
                    </th>
                    <th className="text-right px-3 py-3 font-medium">재고</th>
                    <th className="text-center px-3 py-3 font-medium">판매</th>
                    <th className="text-center px-3 py-3 font-medium">진열</th>
                    <th className="text-center px-3 py-3 font-medium">승인</th>
                    <th className="text-center px-3 py-3 font-medium">카페24 매핑</th>
                    <th className="text-center px-4 py-3 font-medium w-16">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && products.length === 0 ? (
                    <tr><td colSpan={15} className="px-6 py-16 text-center text-sm text-gray-400">상품 로딩 중...</td></tr>
                  ) : sortedProducts.length === 0 ? (
                    <tr><td colSpan={15} className="px-6 py-16 text-center text-sm text-gray-400">
                      등록된 상품이 없습니다. &quot;상품 등록&quot; 버튼으로 첫 상품을 추가하세요.
                    </td></tr>
                  ) : sortedProducts.map((p) => {
                    const isSelected = selectedProducts.has(p.id);
                    const mr = marginNum(p.price, p.supply_price);
                    const mappings = p.product_cafe24_mappings || [];

                    const warehouse = p.fulfillment_warehouse_supplier_id
                      ? warehouses.find((w) => w.id === p.fulfillment_warehouse_supplier_id)
                      : null;

                    return (
                      <tr key={p.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors ${isSelected ? "bg-[#FFF0F5]/40" : warehouse ? "bg-amber-50/40" : ""}`}>
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
                        <td className="px-3 py-2.5">
                          <InlineText
                            value={p.supplier || ""}
                            placeholder="공급사"
                            onSave={(v) => updateProductField(p.id, { supplier: v || null })}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            value={p.fulfillment_warehouse_supplier_id || ""}
                            onChange={(e) => updateProductField(p.id, { fulfillment_warehouse_supplier_id: e.target.value || null })}
                            title="출고지 (자체배송=tp코드 공급사 출고 / 창고발주=지정 창고 출고)"
                            className={`w-full max-w-[110px] px-1.5 py-1 text-xs border rounded cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30 ${warehouse ? "border-amber-300 bg-amber-50 text-amber-800 font-medium" : "border-gray-200 text-gray-600"}`}
                          >
                            <option value="">자체배송</option>
                            {warehouses.map((w) => (
                              <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <InlineNumber
                            value={p.price}
                            onSave={(v) => updateProductField(p.id, { price: v })}
                            className="text-gray-900 font-medium"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <InlineNumber
                            value={p.supply_price}
                            onSave={(v) => updateProductField(p.id, { supply_price: v })}
                            className="text-gray-500"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-sm font-medium ${mr >= 30 ? "text-green-600" : mr >= 20 ? "text-blue-600" : "text-gray-500"}`}>
                            {marginRate(p.price, p.supply_price)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-sm font-medium ${p.total_stock <= 0 ? "text-red-500" : p.total_stock < 10 ? "text-yellow-600" : "text-gray-700"}`}>
                            {p.total_stock}
                          </span>
                          {(p.product_variants || []).length > 0 && (
                            <span className="text-[10px] text-gray-400 ml-1">({(p.product_variants || []).length}옵션)</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.selling === "T" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {p.selling === "T" ? "판매중" : "미판매"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.display === "T" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>
                            {p.display === "T" ? "진열함" : "진열안함"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${APPROVAL_STATUS[p.approval_status]?.cls || "bg-gray-100 text-gray-500"}`}>
                            {APPROVAL_STATUS[p.approval_status]?.label || p.approval_status}
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
                <span className="text-xs text-gray-500">
                  {total === 0 ? "0개" : `${page * PAGE_SIZE + 1}~${Math.min((page + 1) * PAGE_SIZE, total)}개`} / 총 {total}개
                </span>
                <div className="flex items-center gap-2">
                  {loading && <span className="text-xs text-gray-400">로딩 중...</span>}
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0 || loading}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    ← 이전
                  </button>
                  <span className="text-xs text-gray-600 font-medium px-2">
                    {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                  </span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * PAGE_SIZE >= total || loading}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    다음 →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 카드 뷰 */}
          {viewMode === "card" && (
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                <span className="text-xs text-gray-500">
                  {total === 0 ? "0개" : `${page * PAGE_SIZE + 1}~${Math.min((page + 1) * PAGE_SIZE, total)}개`} / 총 {total}개
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0 || loading}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    ← 이전
                  </button>
                  <span className="text-xs text-gray-600 font-medium px-2">
                    {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                  </span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * PAGE_SIZE >= total || loading}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    다음 →
                  </button>
                </div>
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

      {/* ─── 판매사 가격 탭 ─── */}
      {tab === "store-prices" && (
        <StorePricesTab products={products} stores={stores} storesLoading={storesLoading} onImported={refreshAll} />
      )}

      {/* ─── 현황 탭 ─── */}
      {tab === "overview" && (
        <OverviewTab products={products} stores={stores} getStoreName={getStoreName} summaryStats={summaryStats} />
      )}

      {/* 상품 등록 모달 */}
      {showAddModal && (
        <AddProductModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); refreshAll(); }}
          stores={stores}
        />
      )}

      {/* 상품 수정 모달 */}
      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          stores={stores}
          getStoreName={getStoreName}
          onClose={() => setEditingProduct(null)}
          onSaved={() => { setEditingProduct(null); refreshAll(); }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   상품 등록 모달
   ══════════════════════════════════════════ */

function AddProductModal({ onClose, onCreated, stores }: { onClose: () => void; onCreated: () => void; stores: Store[] }) {
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
  const [syncToStores, setSyncToStores] = useState(true);
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(
    new Set(stores.filter((s) => s.status === "active" || s.status === "connected").map((s) => s.id))
  );
  const [syncResult, setSyncResult] = useState("");

  const toggleStore = (id: string) => {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!form.product_name.trim()) { setError("상품명을 입력하세요"); return; }
    setSaving(true);
    setError("");
    setSyncResult("");
    try {
      // 1. TubePing DB에 상품 등록
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
      const { product } = await res.json();

      // 2. 선택된 스토어에 매핑 생성 (cafe24_product_no 없이 → 동기화 시 POST)
      if (syncToStores && selectedStoreIds.size > 0) {
        for (const storeId of selectedStoreIds) {
          await fetch(`/admin/api/products/${product.id}/mappings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ store_id: storeId }),
          });
        }

        // 3. 동기화 실행 (매핑된 스토어에 상품 생성)
        const syncRes = await fetch(`/admin/api/products/${product.id}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (syncRes.ok) {
          const syncData = await syncRes.json();
          setSyncResult(syncData.message);
        }
      }

      setTimeout(() => onCreated(), syncToStores ? 1500 : 300);
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
      <div className="w-full sm:w-[560px] bg-white h-full overflow-y-auto shadow-xl border-l border-gray-200">
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

          {/* 카페24 스토어 동시 등록 */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={syncToStores} onChange={(e) => setSyncToStores(e.target.checked)} className="rounded border-gray-300" />
                <span className="text-sm font-medium text-gray-900">카페24 스토어에 동시 등록</span>
              </label>
              {syncToStores && (
                <span className="text-xs text-gray-400">{selectedStoreIds.size}개 선택</span>
              )}
            </div>
            {syncToStores && (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {stores.filter((s) => s.status === "active" || s.status === "connected").map((s) => (
                  <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                    <input type="checkbox" checked={selectedStoreIds.has(s.id)} onChange={() => toggleStore(s.id)} className="rounded border-gray-300" />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">{s.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{s.mall_id}.cafe24.com</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {syncResult && (
              <div className="mt-3 p-3 bg-green-50 text-green-700 text-xs rounded-lg border border-green-200">{syncResult}</div>
            )}
          </div>
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
    tp_code: product.tp_code,
    product_name: product.product_name,
    price: String(product.price),
    supply_price: String(product.supply_price),
    retail_price: String(product.retail_price),
    image_url: product.image_url || "",
    selling: product.selling,
    display: product.display || "T",
    approval_status: product.approval_status || "approved",
    category: product.category || "",
    description: product.description || "",
    memo: product.memo || "",
  });
  const [variants, setVariants] = useState<Variant[]>(product.product_variants || []);
  const [fullMappings, setFullMappings] = useState<Cafe24Mapping[]>(product.product_cafe24_mappings || []);
  const [deleteVariantIds, setDeleteVariantIds] = useState<string[]>([]);

  // 모달 열릴 때 detail full data fetch (list query는 슬림화돼서 detail 컬럼이 없음)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/admin/api/products/${product.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const p = data.product;
        if (cancelled || !p) return;
        if (p.product_variants) setVariants(p.product_variants);
        if (p.product_cafe24_mappings) setFullMappings(p.product_cafe24_mappings);
        if (p.description !== undefined) setForm((f) => ({ ...f, description: p.description || "" }));
        if (p.memo !== undefined) setForm((f) => ({ ...f, memo: p.memo || "" }));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [product.id]);
  const [activeTab, setActiveTab] = useState<"basic" | "options" | "mappings">("basic");
  const [optLoading, setOptLoading] = useState(false);
  const [optMsg, setOptMsg] = useState("");

  // option_text 계산 헬퍼 (옵션명=옵션값)
  const optionTextOf = (v: Pick<Variant, "option_name" | "option_value" | "option_text">): string => {
    if (v.option_text && v.option_text.trim()) return v.option_text.trim();
    const name = (v.option_name || "").trim();
    const value = (v.option_value || "").trim();
    return `${name}=${value}`.replace(/^=+|=+$/g, "");
  };

  // 카페24/주문에서 옵션 불러오기 → variants에 머지
  const fetchOptionsFromCafe24 = async () => {
    setOptLoading(true);
    setOptMsg("");
    try {
      const res = await fetch(`/admin/api/products/${product.id}/fetch-options`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "불러오기 실패");
      }
      const data = await res.json();
      const existingByText = new Map(variants.map((v) => [optionTextOf(v), v]));
      const merged: Variant[] = [...variants];
      let added = 0;
      for (const f of (data.options || []) as Array<{ option_text: string; variant_code?: string | null }>) {
        if (existingByText.has(f.option_text)) continue;
        const eqIdx = f.option_text.indexOf("=");
        const option_name = eqIdx > 0 ? f.option_text.slice(0, eqIdx).trim() : null;
        const option_value = eqIdx > 0 ? f.option_text.slice(eqIdx + 1).trim() : f.option_text;
        merged.push({
          id: "",
          variant_code: f.variant_code || null,
          option_name,
          option_value,
          option_text: f.option_text,
          price: Number(form.price) || 0,
          supply_price: 0,
          retail_price: Number(form.retail_price) || 0,
          supply_shipping_fee: 0,
          tax_type: "과세",
          quantity: 0,
          display: "T",
          selling: "T",
        });
        added++;
      }
      setVariants(merged);
      setOptMsg(`불러오기 완료 — 카페24 ${data.cafe24_count}건, 주문 ${data.orders_count}건${added > 0 ? `, 신규 ${added}건 추가` : ""}`);
    } catch (e) {
      setOptMsg(e instanceof Error ? e.message : "실패");
    } finally {
      setOptLoading(false);
    }
  };

  const updateVariantField = (idx: number, patch: Partial<Variant>) => {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };

  const addEmptyVariant = () => {
    setVariants([
      ...variants,
      {
        id: "",
        variant_code: null,
        option_name: "",
        option_value: "",
        option_text: null,
        price: Number(form.price) || 0,
        supply_price: 0,
        retail_price: Number(form.retail_price) || 0,
        supply_shipping_fee: 0,
        tax_type: "과세",
        quantity: 0,
        display: "T",
        selling: "T",
      },
    ]);
  };

  const removeVariant = (idx: number) => {
    const target = variants[idx];
    if (target.id) setDeleteVariantIds([...deleteVariantIds, target.id]);
    setVariants(variants.filter((_, i) => i !== idx));
  };
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const buildSaveBody = () => ({
    ...form,
    price: Number(form.price) || 0,
    supply_price: Number(form.supply_price) || 0,
    retail_price: Number(form.retail_price) || 0,
    variants: variants,
    delete_variant_ids: deleteVariantIds,
  });

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaveMsg("");
    try {
      const res = await fetch(`/admin/api/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSaveBody()),
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
        body: JSON.stringify(buildSaveBody()),
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

  const mappings = fullMappings;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full sm:w-[600px] bg-white h-full overflow-y-auto shadow-xl border-l border-gray-200">
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

          {/* 탭 */}
          <div className="flex gap-1 border-b border-gray-200">
            {([
              { key: "basic" as const, label: "기본 정보" },
              { key: "options" as const, label: `옵션 (${variants.length})` },
              { key: "mappings" as const, label: `카페24 매핑 (${mappings.length})` },
            ]).map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-4 py-2.5 text-sm font-medium cursor-pointer rounded-t-lg transition-colors ${activeTab === t.key ? "text-[#C41E1E] bg-white border border-gray-200 border-b-white -mb-px" : "text-gray-500 hover:text-gray-900"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── 기본 정보 탭 ── */}
          {activeTab === "basic" && (
            <div className="space-y-4">
              <Field label="자체코드 (TP코드)">
                <input type="text" value={form.tp_code} onChange={(e) => setForm({ ...form, tp_code: e.target.value })} placeholder="예: TP-0001" className="w-full px-3 py-2.5 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]" />
              </Field>
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

              <div className="grid grid-cols-3 gap-4">
                <Field label="판매 상태">
                  <select value={form.selling} onChange={(e) => setForm({ ...form, selling: e.target.value })} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none cursor-pointer">
                    <option value="T">판매중</option>
                    <option value="F">미판매</option>
                  </select>
                </Field>
                <Field label="진열 상태">
                  <select value={form.display} onChange={(e) => setForm({ ...form, display: e.target.value })} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none cursor-pointer">
                    <option value="T">진열함</option>
                    <option value="F">진열안함</option>
                  </select>
                </Field>
                <Field label="승인 상태">
                  <select value={form.approval_status} onChange={(e) => setForm({ ...form, approval_status: e.target.value })} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none cursor-pointer">
                    <option value="pending">승인대기</option>
                    <option value="requested">승인요청</option>
                    <option value="re_requested">재승인요청</option>
                    <option value="approved">승인완료</option>
                    <option value="rejected">반려</option>
                  </select>
                </Field>
              </div>

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

              {product.fulfillment_warehouse_supplier_id && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs font-semibold text-amber-800">창고발주 상품</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    주문 시 지정된 창고로 발주가 나갑니다. 출고 설정 변경은 상품 목록의 <span className="font-semibold">[출고 방식]</span> 대량 버튼을 이용하세요.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── 옵션 통합 탭 ── */}
          {activeTab === "options" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">옵션 통합 관리</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    판매가·공급가·재고·배송비·과세를 한 행에서 관리합니다. 저장 시 [저장+동기화]로 카페24에 반영됩니다.
                    <br />공급가/공급배송비/과세는 admin 내부 정산용이며 카페24엔 전송되지 않습니다.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={fetchOptionsFromCafe24}
                    disabled={optLoading}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    {optLoading ? "불러오는 중..." : "카페24/주문에서 불러오기"}
                  </button>
                  <button
                    type="button"
                    onClick={addEmptyVariant}
                    className="px-3 py-1.5 text-xs font-medium text-[#C41E1E] bg-[#FFF0F5] border border-[#C41E1E]/20 rounded-lg hover:bg-[#C41E1E]/10 cursor-pointer whitespace-nowrap"
                  >+ 옵션 추가</button>
                </div>
              </div>

              {optMsg && (
                <div className={`text-xs px-3 py-2 rounded-lg ${optMsg.includes("실패") || optMsg.includes("Failed") ? "text-red-600 bg-red-50" : "text-green-700 bg-green-50"}`}>{optMsg}</div>
              )}

              {variants.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  옵션이 없습니다. 위 &quot;카페24/주문에서 불러오기&quot;를 클릭하거나 &quot;옵션 추가&quot;로 직접 입력하세요.
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                  <table className="w-full min-w-[920px]">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-100">
                        <th className="text-left px-3 py-3 font-medium">옵션명</th>
                        <th className="text-left px-3 py-3 font-medium">옵션값</th>
                        <th className="text-right px-3 py-3 font-medium w-24">판매가</th>
                        <th className="text-right px-3 py-3 font-medium w-24">공급가</th>
                        <th className="text-right px-3 py-3 font-medium w-24">공급배송비</th>
                        <th className="text-right px-3 py-3 font-medium w-20">재고</th>
                        <th className="text-left px-3 py-3 font-medium w-20">과세</th>
                        <th className="text-center px-2 py-3 font-medium w-12">판매</th>
                        <th className="text-center px-2 py-3 font-medium w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v, idx) => {
                        const marginPct = v.price > 0 ? ((v.price - v.supply_price) / v.price) * 100 : 0;
                        return (
                          <tr key={v.id || `new-${idx}`} className="border-b border-gray-50 last:border-0">
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={v.option_name || ""}
                                onChange={(e) => updateVariantField(idx, { option_name: e.target.value, option_text: null })}
                                placeholder="색상"
                                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30"
                              />
                              {v.variant_code && (
                                <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">{v.variant_code}</p>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={v.option_value || ""}
                                onChange={(e) => updateVariantField(idx, { option_value: e.target.value, option_text: null })}
                                placeholder="블랙"
                                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={v.price}
                                onChange={(e) => updateVariantField(idx, { price: Number(e.target.value) || 0 })}
                                className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={v.supply_price}
                                onChange={(e) => updateVariantField(idx, { supply_price: Number(e.target.value) || 0 })}
                                className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30"
                              />
                              {v.supply_price > 0 && v.price > 0 && (
                                <p className={`text-[10px] text-right mt-0.5 ${marginPct >= 30 ? "text-green-600" : marginPct >= 20 ? "text-blue-600" : "text-gray-400"}`}>
                                  마진 {marginPct.toFixed(1)}%
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={v.supply_shipping_fee}
                                onChange={(e) => updateVariantField(idx, { supply_shipping_fee: Number(e.target.value) || 0 })}
                                className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={v.quantity}
                                onChange={(e) => updateVariantField(idx, { quantity: Number(e.target.value) || 0 })}
                                className={`w-full px-2 py-1.5 text-sm text-right border rounded focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30 ${v.quantity <= 0 ? "border-red-300 bg-red-50" : v.quantity < 10 ? "border-yellow-300 bg-yellow-50" : "border-gray-200"}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={v.tax_type}
                                onChange={(e) => updateVariantField(idx, { tax_type: e.target.value })}
                                className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded cursor-pointer focus:outline-none"
                              >
                                <option value="과세">과세</option>
                                <option value="면세">면세</option>
                              </select>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <select
                                value={v.selling}
                                onChange={(e) => updateVariantField(idx, { selling: e.target.value })}
                                className="text-xs border border-gray-200 rounded px-1.5 py-1.5 cursor-pointer focus:outline-none"
                              >
                                <option value="T">판매</option>
                                <option value="F">중지</option>
                              </select>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeVariant(idx)}
                                className="text-xs text-gray-400 hover:text-red-500 cursor-pointer"
                                title="삭제"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl flex items-center justify-between">
                    <span className="text-xs text-gray-500">총 {variants.length}개 옵션</span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-gray-500">총 재고: <span className="font-bold text-gray-900">{variants.reduce((s, v) => s + v.quantity, 0)}</span></span>
                      {variants.some((v) => v.quantity <= 0) && (
                        <span className="text-red-500 font-medium">품절 {variants.filter((v) => v.quantity <= 0).length}개</span>
                      )}
                      {variants.some((v) => v.supply_price === 0) && (
                        <span className="text-orange-500 font-medium">공급가 미입력 {variants.filter((v) => v.supply_price === 0).length}개</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 카페24 매핑 탭 ── */}
          {activeTab === "mappings" && (
            <div className="space-y-4">
              {mappings.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">매핑된 스토어가 없습니다. 인벤토리에서 &quot;스토어 매핑&quot;으로 추가하세요.</div>
              ) : (
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
              )}
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
   판매사 가격 탭 — 판매사 자사몰별 판매가·배송비 (import-seller-mall)
   ══════════════════════════════════════════ */

function StorePricesTab({
  products, stores, storesLoading, onImported,
}: {
  products: Product[];
  stores: Store[];
  storesLoading: boolean;
  onImported: () => void;
}) {
  // 판매사몰 = active Cafe24 몰 중 마스터(tubeping)·수기 스토어 제외
  const sellerStores = useMemo(
    () =>
      stores.filter(
        (s) =>
          (s.status === "active" || s.status === "connected") &&
          s.mall_id !== "tubeping" &&
          !/^(manual_|excel_|test_)/.test(s.mall_id)
      ),
    [stores]
  );
  const [storeId, setStoreId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string>("");
  const [unmatched, setUnmatched] = useState<
    { cafe24_product_no: number; product_name: string; custom_product_code: string }[]
  >([]);

  useEffect(() => {
    if (!storeId && sellerStores.length) setStoreId(sellerStores[0].id);
  }, [sellerStores, storeId]);

  const runImport = async () => {
    if (!storeId) return;
    const sName = sellerStores.find((s) => s.id === storeId)?.name || "";
    if (!confirm(`'${sName}' 판매사몰에서 상품(판매가·배송비)을 가져옵니다.\n계속할까요?`)) return;
    setImporting(true);
    setResult("");
    setUnmatched([]);
    try {
      const res = await fetch("/admin/api/products/import-seller-mall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setResult(data.error || "가져오기 실패");
        return;
      }
      setResult(data.message);
      setUnmatched(data.unmatched || []);
      onImported();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "가져오기 실패");
    } finally {
      setImporting(false);
    }
  };

  const rows = useMemo(() => {
    if (!storeId) return [];
    const kw = keyword.trim().toLowerCase();
    const out: { product: Product; mapping: Cafe24Mapping }[] = [];
    for (const p of products) {
      const m = (p.product_cafe24_mappings || []).find(
        (mm) => mm.store_id === storeId && mm.seller_price != null
      );
      if (!m) continue;
      if (
        kw &&
        !(
          p.product_name.toLowerCase().includes(kw) ||
          (p.tp_code || "").toLowerCase().includes(kw) ||
          (m.seller_product_code || "").toLowerCase().includes(kw)
        )
      )
        continue;
      out.push({ product: p, mapping: m });
    }
    return out;
  }, [products, storeId, keyword]);

  if (storesLoading)
    return <div className="flex items-center justify-center py-20 text-gray-400">스토어 데이터 로딩 중...</div>;
  if (!sellerStores.length)
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        연동된 판매사몰(Cafe24)이 없습니다.
      </div>
    );

  return (
    <div className="space-y-4">
      {/* 컨트롤 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">판매사몰 선택</label>
          <select
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value);
              setResult("");
              setUnmatched([]);
            }}
            className="w-full sm:w-72 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {sellerStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.mall_id})
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">상품 검색</label>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="상품명 / 코드"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={runImport}
          disabled={importing || !storeId}
          className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer whitespace-nowrap"
        >
          {importing ? "가져오는 중..." : "이 판매사몰에서 가져오기"}
        </button>
      </div>

      {result && (
        <div className="p-4 bg-blue-50 text-blue-700 text-sm rounded-lg border border-blue-200 flex items-center justify-between">
          <span>{result}</span>
          <button onClick={() => setResult("")} className="text-xs text-blue-400 hover:text-blue-600 cursor-pointer">
            닫기
          </button>
        </div>
      )}

      {/* 보류(미매칭) 리포트 */}
      {unmatched.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            보류 — 마스터에 없는 상품 {unmatched.length}건 (수동 확인 필요)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-amber-700/70 text-left">
                  <th className="py-1 pr-3 font-medium">카페24 번호</th>
                  <th className="py-1 pr-3 font-medium">상품명</th>
                  <th className="py-1 font-medium">자체코드</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.slice(0, 100).map((u) => (
                  <tr key={u.cafe24_product_no} className="border-t border-amber-100">
                    <td className="py-1 pr-3 text-amber-900">{u.cafe24_product_no}</td>
                    <td className="py-1 pr-3 text-amber-900">{u.product_name}</td>
                    <td className="py-1 font-mono text-amber-900">{u.custom_product_code || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unmatched.length > 100 && (
              <p className="text-[11px] text-amber-600 mt-2">…외 {unmatched.length - 100}건</p>
            )}
          </div>
        </div>
      )}

      {/* 판매사 가격 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm text-gray-500">
          판매가 보유 상품 <b className="text-gray-900">{rows.length}</b>건
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-4 py-2.5 font-medium">판매사 코드</th>
                <th className="px-3 py-2.5 font-medium">상품명</th>
                <th className="px-3 py-2.5 font-medium text-right">공급가</th>
                <th className="px-3 py-2.5 font-medium text-right">판매가</th>
                <th className="px-3 py-2.5 font-medium text-right">판매 배송비</th>
                <th className="px-3 py-2.5 font-medium text-right">마진</th>
                <th className="px-3 py-2.5 font-medium">가져온 시각</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    이 판매사몰의 판매가 데이터가 없습니다. 위 &quot;가져오기&quot;를 실행하세요.
                  </td>
                </tr>
              ) : (
                rows.map(({ product: p, mapping: m }) => {
                  const sp = m.seller_price ?? 0;
                  const margin =
                    sp > 0 && p.supply_price > 0 ? `${(((sp - p.supply_price) / sp) * 100).toFixed(1)}%` : "-";
                  return (
                    <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono font-bold text-[#C41E1E] bg-[#FFF0F5] px-2 py-0.5 rounded">
                          {m.seller_product_code || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-900">{p.product_name}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{formatPrice(p.supply_price)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-gray-900">{formatPrice(sp)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">
                        {m.seller_shipping_fee == null
                          ? "미확인"
                          : m.seller_shipping_fee > 0
                            ? formatPrice(m.seller_shipping_fee)
                            : "무료"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{margin}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-400">
                        {m.seller_synced_at
                          ? new Date(m.seller_synced_at).toLocaleString("ko-KR", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   카페24 매핑 탭
   ══════════════════════════════════════════ */

type MappingStat = { id: string; name: string; mall_id: string; status: string; channel: string; mapped: number; unmapped: number; total: number };

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
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<"mapped" | "unmapped">("mapped");
  const [dbStats, setDbStats] = useState<MappingStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  // DB에서 실제 매핑 통계 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/admin/api/products/mapping-stats");
        if (res.ok) {
          const data = await res.json();
          setDbStats(data.stats || []);
        }
      } catch { /* ignore */ }
      finally { setStatsLoading(false); }
    })();
  }, []);

  // 로드된 상품 기준 매핑 (상세 보기용)
  const storeMap = new Map<string, { store: Store; mappings: { product: Product; mapping: Cafe24Mapping }[]; unmapped: Product[] }>();
  for (const s of activeStores) {
    storeMap.set(s.id, { store: s, mappings: [], unmapped: [] });
  }
  for (const p of products) {
    const mappedStoreIds = new Set((p.product_cafe24_mappings || []).map((m) => m.store_id));
    for (const m of p.product_cafe24_mappings || []) {
      const entry = storeMap.get(m.store_id);
      if (entry) entry.mappings.push({ product: p, mapping: m });
    }
    for (const s of activeStores) {
      if (!mappedStoreIds.has(s.id)) {
        const entry = storeMap.get(s.id);
        if (entry) entry.unmapped.push(p);
      }
    }
  }

  if (storesLoading) {
    return <div className="flex items-center justify-center py-20 text-gray-400">스토어 데이터 로딩 중...</div>;
  }

  return (
    <div className="space-y-4">
      {/* 연동 현황 요약 표 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
              <th className="text-left px-5 py-3 font-medium">스토어</th>
              <th className="text-left px-3 py-3 font-medium">카페24 ID</th>
              <th className="text-center px-3 py-3 font-medium">상태</th>
              <th className="text-right px-3 py-3 font-medium">매핑</th>
              <th className="text-right px-3 py-3 font-medium">미매핑</th>
              <th className="text-right px-3 py-3 font-medium">매핑률</th>
              <th className="text-center px-5 py-3 font-medium">토큰</th>
            </tr>
          </thead>
          <tbody>
            {statsLoading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-400">통계 로딩 중...</td></tr>
            ) : dbStats.map((s) => {
              const rate = s.total > 0 ? Math.round((s.mapped / s.total) * 100) : 0;
              return (
                <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30 cursor-pointer" onClick={() => { setExpandedStoreId(s.id); setFilterStoreId(""); }}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#C41E1E] flex items-center justify-center">
                        <span className="text-white font-bold text-[10px]">{s.name.slice(0, 2)}</span>
                      </div>
                      <span className="text-sm font-medium text-gray-900">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-blue-500 font-mono">{s.mall_id}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${s.status === "active" || s.status === "connected" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {s.status === "active" || s.status === "connected" ? "활성" : s.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm font-bold text-green-600 text-right">{s.mapped}</td>
                  <td className="px-3 py-3 text-sm text-right">
                    {s.unmapped > 0 ? (
                      <span className="font-bold text-orange-500">{s.unmapped}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${rate >= 80 ? "bg-green-500" : rate >= 50 ? "bg-yellow-500" : "bg-orange-500"}`} style={{ width: `${rate}%` }} />
                      </div>
                      <span className={`text-xs font-medium ${rate >= 80 ? "text-green-600" : rate >= 50 ? "text-yellow-600" : "text-orange-500"}`}>{rate}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`w-2 h-2 rounded-full inline-block ${s.status === "active" || s.status === "connected" ? "bg-green-500" : "bg-gray-300"}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">스토어 클릭 시 매핑/미매핑 상세 확인</p>
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
          .map(([id, { store, mappings, unmapped }]) => {
            const isExpanded = expandedStoreId === id;
            return (
              <div key={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* 스토어 헤더 — 클릭으로 펼치기/접기 */}
                <div
                  onClick={() => setExpandedStoreId(isExpanded ? null : id)}
                  className="px-6 py-4 flex items-center justify-between bg-gray-50 border-b border-gray-100 cursor-pointer hover:bg-gray-100/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#C41E1E] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">{store.name.slice(0, 2)}</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{store.name}</h3>
                      <p className="text-xs text-gray-400">{store.mall_id}.cafe24.com</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-green-600">{mappings.length}개 매핑</span>
                      {unmapped.length > 0 && (
                        <span className="text-sm font-bold text-orange-500">{unmapped.length}개 미매핑</span>
                      )}
                    </div>
                    <svg className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* 펼쳐진 내용 */}
                {isExpanded && (
                  <div>
                    {/* 매핑/미매핑 토글 */}
                    <div className="px-6 py-2 bg-white border-b border-gray-100 flex items-center gap-2">
                      <button
                        onClick={() => setViewFilter("mapped")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${viewFilter === "mapped" ? "bg-green-100 text-green-700" : "text-gray-500 hover:bg-gray-100"}`}
                      >
                        매핑됨 ({mappings.length})
                      </button>
                      <button
                        onClick={() => setViewFilter("unmapped")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${viewFilter === "unmapped" ? "bg-orange-100 text-orange-700" : "text-gray-500 hover:bg-gray-100"}`}
                      >
                        미매핑 ({unmapped.length})
                      </button>
                    </div>

                    {/* 매핑된 상품 목록 */}
                    {viewFilter === "mapped" && (
                      mappings.length === 0 ? (
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
                            {mappings.slice(0, 50).map(({ product: p, mapping: m }) => (
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
                          {mappings.length > 50 && (
                            <tfoot>
                              <tr><td colSpan={6} className="px-6 py-2 text-xs text-gray-400 text-center">외 {mappings.length - 50}개 더...</td></tr>
                            </tfoot>
                          )}
                        </table>
                      )
                    )}

                    {/* 미매핑 상품 목록 */}
                    {viewFilter === "unmapped" && (
                      unmapped.length === 0 ? (
                        <div className="py-8 text-center text-sm text-green-500 font-medium">모든 상품이 매핑되어 있습니다.</div>
                      ) : (
                        <div>
                          <div className="px-6 py-2 bg-orange-50 border-b border-orange-100">
                            <p className="text-xs text-orange-600">이 스토어에 매핑되지 않은 상품입니다. 해당 카페24 몰에 같은 자체코드로 상품이 등록되어 있어야 매핑 가능합니다.</p>
                          </div>
                          <table className="w-full">
                            <thead>
                              <tr className="text-[11px] text-gray-400 border-b border-gray-50">
                                <th className="text-left px-6 py-2 font-medium">TP코드</th>
                                <th className="text-left px-3 py-2 font-medium">상품명</th>
                                <th className="text-right px-3 py-2 font-medium">판매가</th>
                                <th className="text-center px-3 py-2 font-medium">상태</th>
                              </tr>
                            </thead>
                            <tbody>
                              {unmapped.slice(0, 50).map((p) => (
                                <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30">
                                  <td className="px-6 py-2.5">
                                    <span className="text-xs font-mono font-bold text-orange-500 bg-orange-50 px-2 py-0.5 rounded">{p.tp_code}</span>
                                  </td>
                                  <td className="px-3 py-2.5 text-sm text-gray-900 line-clamp-1 max-w-[250px]">{p.product_name}</td>
                                  <td className="px-3 py-2.5 text-sm text-gray-700 text-right">{formatPrice(p.price)}</td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">미매핑</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            {unmapped.length > 50 && (
                              <tfoot>
                                <tr><td colSpan={4} className="px-6 py-2 text-xs text-gray-400 text-center">외 {unmapped.length - 50}개 더...</td></tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   현황 탭
   ══════════════════════════════════════════ */

function OverviewTab({
  products, stores, getStoreName, summaryStats,
}: {
  products: Product[];
  stores: Store[];
  getStoreName: (id: string) => string;
  summaryStats: { total: number; selling: number; totalMappings: number; unmapped: number; categories: string[] };
}) {
  const [mappingStats, setMappingStats] = useState<{ id: string; name: string; mapped: number; total: number }[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/admin/api/products/mapping-stats");
        if (!res.ok) return;
        const data = await res.json();
        setMappingStats((data.stats || []).map((s: Record<string, unknown>) => ({
          id: s.id as string,
          name: s.name as string,
          mapped: (s.mapped as number) || 0,
          total: (s.total as number) || 0,
        })));
      } catch { /* ignore */ }
    })();
  }, []);

  const avgMargin = products.length > 0
    ? products.reduce((sum, p) => sum + marginNum(p.price, p.supply_price), 0) / products.length
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "전체 상품", value: summaryStats.total, color: "text-gray-900" },
          { label: "판매중", value: summaryStats.selling, color: "text-green-600" },
          { label: "미판매", value: summaryStats.total - summaryStats.selling, color: summaryStats.total - summaryStats.selling > 0 ? "text-orange-500" : "text-gray-400" },
          { label: "카페24 매핑", value: summaryStats.totalMappings, color: "text-[#C41E1E]" },
          { label: "미매핑", value: summaryStats.unmapped, color: summaryStats.unmapped > 0 ? "text-yellow-600" : "text-gray-400" },
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
          {summaryStats.categories.length === 0 ? (
            <p className="text-xs text-gray-400">데이터 없음</p>
          ) : (
            <div className="space-y-2">
              {summaryStats.categories.map((cat) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{cat}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 스토어별 매핑 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">스토어별 매핑 현황</h3>
          {mappingStats.length === 0 ? (
            <p className="text-xs text-gray-400">매핑된 스토어 없음</p>
          ) : (
            <div className="space-y-2">
              {mappingStats.map((s) => (
                <div key={s.id} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{s.name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${s.total > 0 ? Math.min((s.mapped / s.total) * 100, 100) : 0}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{s.mapped}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#FFF0F5] rounded-xl border border-[#C41E1E]/10 p-6">
        <h3 className="text-sm font-bold text-[#C41E1E] mb-3">운영 흐름</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

/* ══════════════════════════════════════════
   인라인 편집 셀 (목록에서 바로 수정)
   ══════════════════════════════════════════ */

/** 숫자 인라인 편집 — 클릭 시 입력창, Enter/blur 저장, Esc 취소 */
function InlineNumber({
  value, onSave, prefix = "₩", className = "",
}: {
  value: number;
  onSave: (v: number) => void;
  prefix?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const start = () => { setDraft(String(value)); setEditing(true); };
  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (!Number.isNaN(n) && n !== value) onSave(n);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-24 px-2 py-1 text-sm text-right border border-[#C41E1E]/50 rounded focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30"
      />
    );
  }
  return (
    <button
      onClick={start}
      title="클릭해서 수정"
      className={`group inline-flex items-center gap-1 text-sm hover:text-[#C41E1E] cursor-pointer ${className}`}
    >
      {prefix}{value.toLocaleString()}
      <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  );
}

/** 텍스트 인라인 편집 — 클릭 시 입력창, Enter/blur 저장, Esc 취소 */
function InlineText({
  value, onSave, placeholder = "",
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v !== value) onSave(v);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-24 px-2 py-1 text-xs border border-[#C41E1E]/50 rounded focus:outline-none focus:ring-1 focus:ring-[#C41E1E]/30"
      />
    );
  }
  return (
    <button
      onClick={start}
      title="클릭해서 수정"
      className="group inline-flex items-center gap-1 text-xs text-gray-600 hover:text-[#C41E1E] cursor-pointer max-w-[110px]"
    >
      <span className="truncate">{value || <span className="text-gray-300">{placeholder || "-"}</span>}</span>
      <svg className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  );
}
