"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

interface Product {
  id: string;
  tp_code: string;
  product_name: string;
  price: number;
  supply_price: number;
}

interface PhoneOrder {
  id: string;
  cafe24_order_id: string;
  order_date: string;
  product_name: string;
  option_text: string;
  quantity: number;
  product_price: number;
  order_amount: number;
  payment_amount: number;
  buyer_name: string;
  buyer_phone: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  receiver_zipcode: string;
  memo: string;
  shipping_status: string;
  supplier_id: string | null;
  purchase_order_id: string | null;
  suppliers: { name: string; email: string } | null;
  purchase_orders: { id: string; po_number: string; status: string } | null;
}

interface InputRow {
  product_name: string;
  tp_code: string;
  unit_price: number;
  option_text: string;
  quantity: number;
  receiver_name: string;
  buyer_name: string;
  receiver_phone: string;
  receiver_zipcode: string;
  receiver_address: string;
  memo: string;
  status: "idle" | "saving" | "ok" | "error";
  result?: { order_id: string; payment_amount: number };
  error?: string;
}

interface SavedRow {
  order_id: string;
  receiver_name: string;
  payment_amount: number;
}

type TabKey = "draft" | "all" | "pending" | "ready_po" | "in_po";

const TAB_LABEL: Record<TabKey, string> = {
  draft: "초안 (미등록)",
  all: "전체",
  pending: "입금대기",
  ready_po: "발주대기",
  in_po: "발주완료",
};

const emptyRow = (defaults?: Partial<InputRow>): InputRow => ({
  product_name: defaults?.product_name || "",
  tp_code: defaults?.tp_code || "",
  unit_price: defaults?.unit_price || 0,
  option_text: "",
  quantity: 1,
  receiver_name: "",
  buyer_name: "",
  receiver_phone: "",
  receiver_zipcode: "",
  receiver_address: "",
  memo: "",
  status: "idle",
});

export default function PhoneOrderPage() {
  // 입력 스프레드시트 상태
  const [rows, setRows] = useState<InputRow[]>(() => Array.from({ length: 5 }, () => emptyRow()));
  // 기본 탭은 "초안" — 저장 직후 사용자가 검토하는 영역
  const initialTab: TabKey = "draft";
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productOpen, setProductOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [buyerSameAsReceiver, setBuyerSameAsReceiver] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [savedResults, setSavedResults] = useState<SavedRow[]>([]);
  const [formOpen, setFormOpen] = useState(true);

  // 목록 상태
  const [orders, setOrders] = useState<PhoneOrder[]>([]);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);

  // 상품 검색
  const searchProducts = useCallback(async (kw: string) => {
    if (!kw || kw.length < 1) { setProducts([]); return; }
    const res = await fetch(`/admin/api/products?keyword=${encodeURIComponent(kw)}&limit=10`);
    const data = await res.json();
    setProducts(data.products || []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchProducts(productSearch), 200);
    return () => clearTimeout(t);
  }, [productSearch, searchProducts]);

  // 목록 조회 — 초안(draft) 포함해서 가져옴
  const fetchOrders = useCallback(async () => {
    const res = await fetch("/admin/api/orders?limit=500&include_draft=true");
    const data = await res.json();
    const phoneOrders = (data.orders || []).filter((o: PhoneOrder) =>
      (o.cafe24_order_id || "").startsWith("PT-")
    );
    setOrders(phoneOrders);
  }, []);

  const syncSheet = async () => {
    if (!confirm("Google Sheet에서 전화주문을 지금 동기화합니다. 계속할까요?")) return;
    setSyncing(true);
    try {
      const res = await fetch("/admin/api/orders/morning-collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSvQIEMjooRsJH0uRpQQRINDQebSMqTKB_tlLkvr9woGi5QdmdrBkfbgrrVtUwXpQ/pub?output=csv" }),
      });
      const data = await res.json();
      alert(`시트 ${data.total_rows || 0}행 · 신규 ${data.imported || 0} · 이미 등록 ${data.skipped_already || 0} · 입금대기 ${data.skipped_no_payment || 0}`);
      fetchOrders();
    } catch (e) {
      alert(`실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // 상품 선택 — 모든 빈 행에 적용
  const applyProduct = (p: Product) => {
    setSelectedProduct(p);
    setProductSearch(p.product_name);
    setProductOpen(false);
    setRows((rs) => rs.map((r) =>
      (!r.product_name && r.status !== "ok")
        ? { ...r, product_name: p.product_name, tp_code: p.tp_code, unit_price: p.price }
        : r
    ));
  };
  const applyProductToAll = () => {
    if (!selectedProduct) { alert("상품을 먼저 선택하세요."); return; }
    setRows((rs) => rs.map((r) =>
      r.status === "ok"
        ? r
        : { ...r, product_name: selectedProduct.product_name, tp_code: selectedProduct.tp_code, unit_price: selectedProduct.price }
    ));
  };

  // 행 편집
  const updateRow = (idx: number, patch: Partial<InputRow>) => {
    setRows((rs) => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };
  const addRows = (n: number) => {
    const base = selectedProduct
      ? { product_name: selectedProduct.product_name, tp_code: selectedProduct.tp_code, unit_price: selectedProduct.price }
      : undefined;
    setRows((rs) => [...rs, ...Array.from({ length: n }, () => emptyRow(base))]);
  };
  const removeRow = (idx: number) => {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  };
  const clearAllRows = () => {
    if (!confirm("입력행을 모두 비우시겠습니까? (저장된 결과는 유지됩니다)")) return;
    setRows(Array.from({ length: 5 }, () => emptyRow()));
  };

  // 엑셀 붙여넣기 핸들러 (수령인 / 입금자명 / 연락처 / 우편번호 / 주소 / 배송메시지 / 수량 순)
  const handlePaste = (e: React.ClipboardEvent, startIdx: number) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return; // 단일 셀 붙여넣기는 기본 동작
    e.preventDefault();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return;

    const parsed = lines.map((line) => line.split("\t"));
    setRows((rs) => {
      const next = [...rs];
      // 필요한 만큼 행 추가
      const needed = startIdx + parsed.length - next.length;
      if (needed > 0) {
        const base = selectedProduct
          ? { product_name: selectedProduct.product_name, tp_code: selectedProduct.tp_code, unit_price: selectedProduct.price }
          : undefined;
        for (let i = 0; i < needed; i++) next.push(emptyRow(base));
      }
      parsed.forEach((cols, i) => {
        const r = next[startIdx + i];
        if (!r) return;
        // 컬럼 순서: 수령인 / 입금자명 / 연락처 / 우편번호 / 주소 / 메시지 / 수량(선택)
        const [recv, buyer, phone, zip, addr, memo, qtyStr] = cols;
        const qty = parseInt((qtyStr || "").replace(/[^0-9]/g, ""), 10);
        next[startIdx + i] = {
          ...r,
          receiver_name: recv?.trim() || r.receiver_name,
          buyer_name: buyer?.trim() || r.buyer_name,
          receiver_phone: phone?.trim() || r.receiver_phone,
          receiver_zipcode: zip?.trim() || r.receiver_zipcode,
          receiver_address: addr?.trim() || r.receiver_address,
          memo: memo?.trim() || r.memo,
          quantity: qty && qty > 0 ? qty : r.quantity,
        };
      });
      return next;
    });
  };

  // 행 유효성
  const isRowValid = (r: InputRow) => !!r.product_name && !!r.receiver_name && !!r.receiver_phone && !!r.receiver_address && r.quantity >= 1 && r.unit_price >= 0;
  const validRows = useMemo(() => rows.filter((r) => r.status !== "ok" && isRowValid(r)), [rows]);
  const totalAmount = useMemo(() => validRows.reduce((s, r) => s + r.unit_price * r.quantity, 0), [validRows]);

  // 일괄 저장 — 각 행을 순차 호출 (고유 입금액 충돌 방지)
  const saveAll = async () => {
    if (validRows.length === 0) { alert("저장 가능한 행이 없습니다. 상품/수령인/연락처/주소/수량을 채워주세요."); return; }
    if (!confirm(`${validRows.length}건을 저장합니다. 계속할까요?`)) return;

    setSavingAll(true);
    const newResults: SavedRow[] = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.status === "ok") continue;
        if (!isRowValid(r)) continue;
        setRows((rs) => rs.map((x, j) => j === i ? { ...x, status: "saving" } : x));
        const payload = {
          product_name: r.product_name,
          tp_code: r.tp_code,
          option_text: r.option_text,
          quantity: r.quantity,
          unit_price: r.unit_price,
          buyer_name: buyerSameAsReceiver ? r.receiver_name : r.buyer_name,
          buyer_phone: r.receiver_phone,
          receiver_name: r.receiver_name,
          receiver_phone: r.receiver_phone,
          receiver_address: r.receiver_address,
          receiver_zipcode: r.receiver_zipcode,
          memo: r.memo,
        };
        try {
          const res = await fetch("/admin/api/orders/phone-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) {
            setRows((rs) => rs.map((x, j) => j === i ? { ...x, status: "error", error: data.error || `${res.status}` } : x));
          } else {
            setRows((rs) => rs.map((x, j) => j === i ? { ...x, status: "ok", result: { order_id: data.order_id, payment_amount: data.payment_amount } } : x));
            newResults.push({ order_id: data.order_id, receiver_name: r.receiver_name, payment_amount: data.payment_amount });
          }
        } catch (e) {
          setRows((rs) => rs.map((x, j) => j === i ? { ...x, status: "error", error: e instanceof Error ? e.message : "unknown" } : x));
        }
      }
      if (newResults.length > 0) {
        setSavedResults((prev) => [...newResults, ...prev]);
        fetchOrders();
      }
    } finally {
      setSavingAll(false);
    }
  };

  // 목록 액션 — 발주 전환
  const togglePayment = async (orderId: string, currentStatus: string) => {
    const newStatus = currentStatus === "pending" ? "ordered" : "pending";
    const label = newStatus === "ordered" ? "입금확인" : "입금전";
    if (!confirm(`${label}으로 변경하시겠습니까?`)) return;
    await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [orderId], updates: { shipping_status: newStatus } }),
    });
    fetchOrders();
  };

  const bulkConfirmPayment = async () => {
    const ids = Array.from(selected).filter((id) => {
      const o = orders.find((x) => x.id === id);
      return o && o.shipping_status === "pending";
    });
    if (ids.length === 0) { alert("입금대기 상태인 주문이 선택되지 않았습니다."); return; }
    if (!confirm(`${ids.length}건을 입금확인 처리하시겠습니까?\n계좌이체 입금이 확인된 주문만 진행해주세요.`)) return;
    await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, updates: { shipping_status: "ordered" } }),
    });
    setSelected(new Set());
    fetchOrders();
  };

  // 주문집계 등록 — 초안(draft) → 입금대기(pending) 승격, 주문집계 페이지에서 보이게 됨
  const bulkPromoteToAggregate = async () => {
    const ids = Array.from(selected).filter((id) => {
      const o = orders.find((x) => x.id === id);
      return o && o.shipping_status === "draft";
    });
    if (ids.length === 0) { alert("초안 상태인 주문이 선택되지 않았습니다."); return; }
    if (!confirm(`${ids.length}건을 주문집계에 등록합니다.\n이후 주문집계 페이지에서도 보이며, 계좌이체 입금이 확인되면 '입금확인' 처리하세요.\n\n계속할까요?`)) return;
    await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, updates: { shipping_status: "pending" } }),
    });
    setSelected(new Set());
    fetchOrders();
  };

  // 단건 주문집계 등록 (행 액션)
  const promoteOne = async (orderId: string) => {
    if (!confirm("이 주문을 주문집계에 등록하시겠습니까?")) return;
    await fetch("/admin/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [orderId], updates: { shipping_status: "pending" } }),
    });
    fetchOrders();
  };

  const bulkCreatePO = async () => {
    const targets = Array.from(selected).map((id) => orders.find((o) => o.id === id)).filter(Boolean) as PhoneOrder[];
    if (targets.length === 0) { alert("선택된 주문이 없습니다."); return; }
    const alreadyPO = targets.filter((o) => o.purchase_order_id);
    const pending = targets.filter((o) => o.shipping_status === "pending");
    let warn = "";
    if (pending.length > 0) warn += `\n· 입금대기 ${pending.length}건 포함`;
    if (alreadyPO.length > 0) warn += `\n· 이미 발주된 주문 ${alreadyPO.length}건 포함 (중복 생성됩니다)`;
    if (!confirm(`${targets.length}건의 발주서를 생성합니다. (창고발주는 자동 라우팅)${warn}\n\n계속할까요?`)) return;

    setBulkBusy(true);
    try {
      const res = await fetch("/admin/api/purchase-orders/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: targets.map((o) => o.id) }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`발주 실패: ${data.error || res.status}`); return; }
      const lines = (data.results || []).map((r: { supplier_name: string; po_number?: string; order_count: number; is_warehouse: boolean; email_sent: boolean; error?: string }) => {
        const tag = r.is_warehouse ? "[창고] " : "";
        const status = r.email_sent ? "✓" : "✗";
        const err = r.error ? ` (${r.error})` : "";
        return `${status} ${tag}${r.supplier_name}: ${r.po_number || "?"} (${r.order_count}건)${err}`;
      });
      let msg = `발주 결과: PO ${data.created_count}건 생성, 메일 ${data.email_success}건 발송`;
      if (lines.length) msg += `\n\n${lines.join("\n")}`;
      if (data.skipped?.length) msg += `\n\n건너뜀 ${data.skipped.length}건`;
      alert(msg);
      setSelected(new Set());
      fetchOrders();
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { alert("선택된 주문이 없습니다."); return; }
    const withPO = ids.filter((id) => orders.find((o) => o.id === id)?.purchase_order_id);
    if (withPO.length > 0) {
      alert(`이미 발주된 주문이 ${withPO.length}건 포함되어 있어 삭제할 수 없습니다.\n발주를 먼저 취소해주세요.`);
      return;
    }
    if (!confirm(`${ids.length}건의 전화주문을 삭제합니다.\n정산항목까지 함께 삭제됩니다. 계속할까요?`)) return;
    const res = await fetch("/admin/api/orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (!res.ok) { alert(`삭제 실패: ${data.error}`); return; }
    setSelected(new Set());
    fetchOrders();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => alert("복사됨"));
  };

  // 필터링
  const filtered = useMemo(() => {
    return orders.filter((o) => {
      // 초안 탭은 draft만, 그 외 탭은 draft 제외
      if (tab === "draft") {
        if (o.shipping_status !== "draft") return false;
      } else {
        if (o.shipping_status === "draft") return false;
      }
      if (tab === "pending" && o.shipping_status !== "pending") return false;
      if (tab === "ready_po" && (o.shipping_status === "pending" || o.purchase_order_id)) return false;
      if (tab === "in_po" && !o.purchase_order_id) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${o.cafe24_order_id} ${o.product_name} ${o.receiver_name} ${o.receiver_phone} ${o.buyer_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, tab, search]);

  const stats = useMemo(() => ({
    draft: orders.filter((o) => o.shipping_status === "draft").length,
    total: orders.filter((o) => o.shipping_status !== "draft").length,
    pending: orders.filter((o) => o.shipping_status === "pending").length,
    readyPO: orders.filter((o) => o.shipping_status !== "pending" && o.shipping_status !== "draft" && !o.purchase_order_id && o.shipping_status !== "cancelled").length,
    inPO: orders.filter((o) => !!o.purchase_order_id).length,
    totalAmount: orders.filter((o) => o.shipping_status !== "draft").reduce((s, o) => s + (o.order_amount || 0), 0),
  }), [orders]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) setSelected(new Set());
    else setSelected(new Set(filtered.map((o) => o.id)));
  };

  const statusBadge = (o: PhoneOrder) => {
    if (o.purchase_order_id && o.purchase_orders) {
      return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700" title={o.purchase_orders.po_number}>발주 {o.purchase_orders.po_number}</span>;
    }
    if (o.shipping_status === "draft") {
      return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">초안 (미등록)</span>;
    }
    if (o.shipping_status === "pending") {
      return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">입금대기</span>;
    }
    if (o.shipping_status === "cancelled") {
      return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">취소</span>;
    }
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">발주대기</span>;
  };

  const rowStatusBadge = (r: InputRow) => {
    if (r.status === "ok") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">✓ 저장됨</span>;
    if (r.status === "saving") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">저장중</span>;
    if (r.status === "error") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700" title={r.error}>오류</span>;
    if (isRowValid(r)) return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">대기</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">미완성</span>;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">전화주문 관리</h1>
          <p className="text-xs text-gray-500 mt-1">
            ① 스프레드시트로 입력·저장(초안) → ② 검토 후 <strong>주문집계 등록</strong> → ③ 계좌이체 <strong>입금확인</strong> → ④ 발주서 생성
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={syncSheet}
            disabled={syncing}
            className="px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? "동기화 중..." : "시트 동기화 (레거시)"}
          </button>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="px-3 py-2 text-xs font-medium bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818]"
          >
            {formOpen ? "입력시트 닫기" : "+ 신규 입력시트"}
          </button>
        </div>
      </div>

      {/* 직전 저장 결과 안내 */}
      {savedResults.length > 0 && (
        <div className="mb-5 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-4">
          <div className="flex items-center justify-between gap-4 mb-2">
            <p className="text-xs text-green-700 font-semibold">✓ 직전 저장 결과 {savedResults.length}건 — 고객에게 안내할 고유 입금액</p>
            <div className="flex gap-2">
              <button
                onClick={() => copyToClipboard(savedResults.map((r) => `${r.receiver_name}: ₩${r.payment_amount.toLocaleString()} (${r.order_id})`).join("\n"))}
                className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700"
              >
                전체 복사
              </button>
              <button onClick={() => setSavedResults([])} className="text-gray-400 hover:text-gray-600 text-xs">닫기</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
            {savedResults.slice(0, 30).map((r) => (
              <div key={r.order_id} className="bg-white rounded px-2.5 py-1.5 flex items-center justify-between gap-2 border border-green-200">
                <span className="font-medium text-gray-800 truncate">{r.receiver_name}</span>
                <span className="font-mono text-green-700 font-bold whitespace-nowrap">₩{r.payment_amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-2">신한 140-014-420770 · 주식회사 신산애널리틱스</p>
        </div>
      )}

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-4">
        {[
          { label: "초안 (미등록)", value: `${stats.draft}건`, hl: stats.draft > 0, hlColor: "text-gray-700" },
          { label: "전체 전화주문", value: `${stats.total}건` },
          { label: "입금대기", value: `${stats.pending}건`, hl: stats.pending > 0 },
          { label: "발주대기", value: `${stats.readyPO}건`, hl: stats.readyPO > 0 },
          { label: "발주완료", value: `${stats.inPO}건` },
          { label: "총 주문금액", value: `₩${stats.totalAmount.toLocaleString()}` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-lg border border-gray-200 px-3 py-2.5">
            <p className="text-[11px] text-gray-400">{s.label}</p>
            <p className={`text-sm font-bold mt-0.5 ${s.hl ? (s.hlColor || "text-[#C41E1E]") : "text-gray-900"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 스프레드시트 입력 영역 */}
      {formOpen && (
        <div className="bg-white rounded-xl border p-4 mb-5">
          {/* 상단: 상품 선택 + 도구 */}
          <div className="flex items-end gap-3 mb-3 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <label className="block text-[11px] font-medium text-gray-600 mb-1">상품 선택 (TP코드/이름) — 빈 행에 자동 적용</label>
              <div className="relative">
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => { setProductSearch(e.target.value); setProductOpen(true); }}
                  onFocus={() => setProductOpen(true)}
                  placeholder="상품명 입력..."
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                {productOpen && products.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
                    {products.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => applyProduct(p)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-0 flex items-center gap-2"
                      >
                        <span className="font-mono text-[10px] font-bold text-[#C41E1E] bg-[#FFF0F5] px-1.5 py-0.5 rounded">{p.tp_code}</span>
                        <span className="flex-1 truncate">{p.product_name}</span>
                        <span className="text-xs text-gray-500">₩{p.price.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedProduct && (
                <p className="text-[10px] text-gray-500 mt-1">
                  선택: <span className="font-mono text-[#C41E1E] font-semibold">{selectedProduct.tp_code}</span> · {selectedProduct.product_name} · ₩{selectedProduct.price.toLocaleString()}
                </p>
              )}
            </div>
            <button
              onClick={applyProductToAll}
              disabled={!selectedProduct}
              className="px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              전체 행에 적용
            </button>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none px-2 py-2">
              <input type="checkbox" checked={buyerSameAsReceiver} onChange={(e) => setBuyerSameAsReceiver(e.target.checked)} />
              주문자=수령인 (입금자명 비우면 수령인으로)
            </label>
          </div>

          <details className="mb-3 text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700">💡 엑셀/구글시트에서 복사 → 첫 셀에 붙여넣기 (수령인 / 입금자명 / 연락처 / 우편번호 / 주소 / 메시지 / 수량)</summary>
            <div className="mt-2 bg-gray-50 rounded p-2 font-mono text-[10px] leading-relaxed">
              예시 (탭 구분):<br />
              김대일{"\t"}김대일{"\t"}010-6341-5015{"\t"}{"\t"}경기도고양시일산동구일산로11 506동303호{"\t"}{"\t"}1<br />
              윤인숙{"\t"}윤인숙{"\t"}010-5897-4737{"\t"}{"\t"}서울특별시 양천구 신정로14길 1 203동 909호{"\t"}{"\t"}1
            </div>
          </details>

          {/* 스프레드시트 테이블 */}
          <div ref={tableRef} className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-2 w-8 text-center font-medium">#</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[200px]">상품</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[100px]">옵션</th>
                  <th className="px-2 py-2 w-16 text-center font-medium">수량</th>
                  <th className="px-2 py-2 w-24 text-right font-medium">단가</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[90px]">수령인</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[90px]">입금자명</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[130px]">연락처</th>
                  <th className="px-2 py-2 w-20 text-left font-medium">우편번호</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[280px]">주소(전체)</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[140px]">배송메시지</th>
                  <th className="px-2 py-2 w-20 text-center font-medium">상태</th>
                  <th className="px-2 py-2 w-10 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const done = r.status === "ok";
                  const cellBase = "w-full border-0 bg-transparent px-1.5 py-1.5 text-xs focus:bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400";
                  return (
                    <tr key={idx} className={`border-t border-gray-100 ${done ? "bg-green-50/40" : "hover:bg-gray-50/40"}`}>
                      <td className="px-2 py-1 text-center text-gray-400 text-[10px]">{idx + 1}</td>
                      <td className="px-1 py-0">
                        <input
                          type="text"
                          value={r.product_name}
                          onChange={(e) => updateRow(idx, { product_name: e.target.value })}
                          disabled={done}
                          placeholder="상품명"
                          className={cellBase}
                        />
                        {r.tp_code && <div className="px-1.5 text-[9px] text-[#C41E1E] font-mono">{r.tp_code}</div>}
                      </td>
                      <td className="px-1 py-0">
                        <input type="text" value={r.option_text} onChange={(e) => updateRow(idx, { option_text: e.target.value })} disabled={done} className={cellBase} />
                      </td>
                      <td className="px-1 py-0">
                        <input type="number" min={1} value={r.quantity} onChange={(e) => updateRow(idx, { quantity: Number(e.target.value) || 1 })} disabled={done} className={`${cellBase} text-center`} />
                      </td>
                      <td className="px-1 py-0">
                        <input type="number" min={0} value={r.unit_price} onChange={(e) => updateRow(idx, { unit_price: Number(e.target.value) || 0 })} disabled={done} className={`${cellBase} text-right`} />
                      </td>
                      <td className="px-1 py-0">
                        <input
                          type="text"
                          value={r.receiver_name}
                          onChange={(e) => updateRow(idx, { receiver_name: e.target.value })}
                          onPaste={(e) => handlePaste(e, idx)}
                          disabled={done}
                          className={cellBase}
                        />
                      </td>
                      <td className="px-1 py-0">
                        <input
                          type="text"
                          value={r.buyer_name}
                          onChange={(e) => updateRow(idx, { buyer_name: e.target.value })}
                          disabled={done}
                          placeholder={buyerSameAsReceiver ? "(수령인 동일)" : ""}
                          className={cellBase}
                        />
                      </td>
                      <td className="px-1 py-0">
                        <input type="tel" value={r.receiver_phone} onChange={(e) => updateRow(idx, { receiver_phone: e.target.value })} disabled={done} placeholder="010-0000-0000" className={cellBase} />
                      </td>
                      <td className="px-1 py-0">
                        <input type="text" value={r.receiver_zipcode} onChange={(e) => updateRow(idx, { receiver_zipcode: e.target.value })} disabled={done} className={cellBase} />
                      </td>
                      <td className="px-1 py-0">
                        <input type="text" value={r.receiver_address} onChange={(e) => updateRow(idx, { receiver_address: e.target.value })} disabled={done} placeholder="도로명 + 상세주소" className={cellBase} />
                      </td>
                      <td className="px-1 py-0">
                        <input type="text" value={r.memo} onChange={(e) => updateRow(idx, { memo: e.target.value })} disabled={done} className={cellBase} />
                      </td>
                      <td className="px-2 py-1 text-center">
                        {rowStatusBadge(r)}
                        {r.result && <div className="text-[9px] font-mono text-green-700 mt-0.5">₩{r.result.payment_amount.toLocaleString()}</div>}
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button
                          onClick={() => removeRow(idx)}
                          disabled={done}
                          className="text-gray-400 hover:text-red-500 disabled:opacity-30 text-sm"
                          title="행 삭제"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 하단 액션 */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button onClick={() => addRows(1)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">+ 1행</button>
            <button onClick={() => addRows(10)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">+ 10행</button>
            <button onClick={() => addRows(50)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">+ 50행</button>
            <button onClick={clearAllRows} className="px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">전체 비우기</button>

            <div className="ml-auto flex items-center gap-3">
              <div className="text-xs text-gray-600">
                저장 가능 <span className="font-bold text-gray-900">{validRows.length}건</span>
                {totalAmount > 0 && <> · 합계 <span className="font-bold text-gray-900">₩{totalAmount.toLocaleString()}</span></>}
              </div>
              <button
                onClick={saveAll}
                disabled={savingAll || validRows.length === 0}
                className="px-5 py-2 bg-[#C41E1E] text-white text-sm font-semibold rounded-lg hover:bg-[#A01818] disabled:opacity-50"
              >
                {savingAll ? "저장 중..." : `${validRows.length}건 일괄 저장`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 목록 액션 바 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex border border-gray-300 rounded-lg overflow-hidden">
          {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => {
            const count =
              key === "draft" ? stats.draft :
              key === "all" ? stats.total :
              key === "pending" ? stats.pending :
              key === "ready_po" ? stats.readyPO :
              stats.inPO;
            const isDraftTab = key === "draft";
            return (
              <button
                key={key}
                onClick={() => { setTab(key); setSelected(new Set()); }}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  tab === key
                    ? (isDraftTab ? "bg-gray-700 text-white" : "bg-[#C41E1E] text-white")
                    : (isDraftTab && count > 0 ? "bg-yellow-50 text-yellow-800 hover:bg-yellow-100" : "bg-white text-gray-600 hover:bg-gray-50")
                }`}
              >
                {TAB_LABEL[key]} ({count})
              </button>
            );
          })}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="주문번호 / 상품 / 수령인 / 연락처 검색"
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-64"
        />

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-gray-500">선택 {selected.size}건</span>
              {/* 초안 탭에서만 — 주문집계 등록 (draft → pending 승격) */}
              {tab === "draft" && (
                <button
                  onClick={bulkPromoteToAggregate}
                  className="px-3 py-1.5 bg-[#C41E1E] text-white text-xs font-bold rounded-lg hover:bg-[#A01818] cursor-pointer shadow-sm"
                >
                  → 주문집계 등록 ({selected.size})
                </button>
              )}
              {/* 초안 아닌 탭에서만 — 입금확인 / 선택 발주 / 삭제 */}
              {tab !== "draft" && (
                <button
                  onClick={bulkConfirmPayment}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 cursor-pointer shadow-sm"
                >
                  💰 입금확인 처리 ({selected.size})
                </button>
              )}
              {tab !== "draft" && (
                <button
                  onClick={bulkCreatePO}
                  disabled={bulkBusy}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                >
                  {bulkBusy ? "발주 중..." : `선택 발주 (${selected.size})`}
                </button>
              )}
              <button
                onClick={bulkDelete}
                className="px-3 py-1.5 border border-red-300 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 cursor-pointer"
              >
                삭제
              </button>
            </>
          )}
        </div>
      </div>

      {/* 목록 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
              <th className="px-3 py-2.5 w-10 text-center">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <th className="text-left px-3 py-2.5 font-medium">주문번호</th>
              <th className="text-left px-3 py-2.5 font-medium">일시</th>
              <th className="text-left px-3 py-2.5 font-medium">상품</th>
              <th className="text-center px-3 py-2.5 font-medium">수량</th>
              <th className="text-right px-3 py-2.5 font-medium">금액</th>
              <th className="text-left px-3 py-2.5 font-medium">수령인</th>
              <th className="text-left px-3 py-2.5 font-medium">연락처</th>
              <th className="text-left px-3 py-2.5 font-medium">주소</th>
              <th className="text-center px-3 py-2.5 font-medium">상태</th>
              <th className="text-center px-3 py-2.5 font-medium">액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-8 text-gray-400 text-xs">조건에 맞는 전화주문이 없습니다.</td>
              </tr>
            ) : filtered.map((o) => (
              <tr key={o.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggleSelect(o.id)}
                    className="rounded"
                  />
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-gray-700">{o.cafe24_order_id}</td>
                <td className="px-3 py-2.5 text-[11px] text-gray-500">
                  {o.order_date ? new Date(o.order_date).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}
                </td>
                <td className="px-3 py-2.5 text-gray-800 max-w-[260px]">
                  <div className="truncate" title={o.product_name}>{o.product_name}</div>
                  {o.option_text && <div className="text-[10px] text-gray-400 truncate">{o.option_text}</div>}
                </td>
                <td className="px-3 py-2.5 text-center text-gray-700">{o.quantity}</td>
                <td className="px-3 py-2.5 text-right text-gray-800">
                  ₩{(o.payment_amount || o.order_amount).toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-gray-700">{o.receiver_name}</td>
                <td className="px-3 py-2.5 text-[12px] text-gray-600">{o.receiver_phone}</td>
                <td className="px-3 py-2.5 text-[11px] text-gray-500 max-w-[220px]">
                  <div className="truncate" title={o.receiver_address}>{o.receiver_address}</div>
                  {o.memo && <div className="text-[10px] text-gray-400 truncate" title={o.memo}>📝 {o.memo}</div>}
                </td>
                <td className="px-3 py-2.5 text-center">{statusBadge(o)}</td>
                <td className="px-3 py-2.5 text-center">
                  {o.shipping_status === "draft" ? (
                    <button
                      onClick={() => promoteOne(o.id)}
                      className="text-[11px] px-2 py-1 rounded bg-[#C41E1E] text-white font-medium hover:bg-[#A01818] cursor-pointer whitespace-nowrap"
                    >
                      → 주문집계 등록
                    </button>
                  ) : o.shipping_status === "pending" ? (
                    <button
                      onClick={() => togglePayment(o.id, o.shipping_status)}
                      className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 cursor-pointer whitespace-nowrap"
                    >
                      💰 입금확인
                    </button>
                  ) : (
                    <button
                      onClick={() => togglePayment(o.id, o.shipping_status)}
                      className="text-[11px] text-gray-500 hover:text-[#C41E1E] underline whitespace-nowrap"
                    >
                      입금취소
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
