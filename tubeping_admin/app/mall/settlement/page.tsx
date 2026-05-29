"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";

// ─── Types ───
interface Store {
  id: string;
  name: string;
  mall_id: string;
  settlement_type: string;
  influencer_rate: number;
  company_rate: number;
}
interface Settlement {
  id: string;
  settlement_no: string;
  store_id: string;
  period: string;
  start_date: string;
  end_date: string;
  cafe24_sales: number;
  phone_sales: number;
  refund_amount: number;
  total_sales: number;
  pg_fee: number;
  cogs_taxable: number;
  cogs_exempt: number;
  cogs_exempt_vat: number;
  total_cogs: number;
  ship_taxable: number;
  ship_exempt: number;
  ship_exempt_vat: number;
  total_shipping: number;
  tpl_cost: number;
  other_cost: number;
  vat_amount: number;
  total_cost: number;
  net_profit: number;
  profit_rate: number;
  influencer_amount: number;
  withholding_tax: number;
  influencer_actual: number;
  company_amount: number;
  snap_influencer_rate: number;
  snap_company_rate: number;
  snap_settlement_type: string;
  snap_pg_fee_rate: number;
  status: string;
  confirmed_at: string | null;
  paid_at: string | null;
  total_orders: number;
  total_items: number;
  memo: string | null;
  seller_memo: string | null;
  created_at: string;
  share_token: string | null;
  seller_confirmed: boolean;
  seller_confirmed_at: string | null;
  stores?: Store;
}
interface SettlementItem {
  id: string;
  order_id: string;
  cafe24_order_id: string;
  cafe24_order_item_code: string;
  order_date: string;
  product_name: string;
  option_text: string;
  quantity: number;
  product_price: number;
  order_amount: number;
  shipping_fee: number;
  discount_amount: number;
  coupon_discount: number;
  app_discount: number;
  additional_discount: number;
  settled_amount: number;
  supply_price: number;
  supply_total: number;
  supply_shipping: number;
  tax_type: string;
  item_type: string;
  sales_channel: string;
  supplier_name: string;
  store_name: string;
  admin_note: string;
  seller_note: string;
}
interface ProductSummary {
  product_name: string;
  quantity: number;
  sales: number;
  cogs: number;
  shipping: number;
  profit: number;
  margin: number;
}
interface SupplierSettlement {
  id: string;
  supplier_id: string;
  supplier_name: string;
  period: string;
  status: string;
  total_supply: number;
  total_shipping: number;
  total_amount: number;
  total_sales: number;
  item_count: number;
  total_quantity: number;
  sent_at: string | null;
  confirmed_at: string | null;
  invoiced_at: string | null;
  paid_at: string | null;
  invoice_no: string | null;
  memo: string | null;
  created_at: string;
}
interface SupplierProduct {
  name: string;
  qty: number;
  supply: number;
  shipping: number;
  sales: number;
}

// ─── 상태 스타일 ───
const SELLER_STATUS: Record<string, { label: string; style: string }> = {
  draft: { label: "임시", style: "bg-gray-100 text-gray-600" },
  confirmed: { label: "확정", style: "bg-blue-100 text-blue-700" },
  paid: { label: "지급완료", style: "bg-green-100 text-green-700" },
};
const SUP_STATUS: Record<string, { label: string; style: string; icon: string }> = {
  draft: { label: "자료작성", style: "bg-gray-100 text-gray-600", icon: "📝" },
  sent: { label: "자료전달", style: "bg-yellow-100 text-yellow-700", icon: "📤" },
  confirmed: { label: "확인완료", style: "bg-blue-100 text-blue-700", icon: "✓" },
  invoiced: { label: "세금계산서", style: "bg-purple-100 text-purple-700", icon: "🧾" },
  paid: { label: "지급완료", style: "bg-green-100 text-green-700", icon: "💰" },
};
const SUP_STATUS_ORDER = ["draft", "sent", "confirmed", "invoiced", "paid"];

const W = (n: number) => `₩${n.toLocaleString()}`;

function periodOptions() {
  const opts: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return opts;
}

// ─── Excel 다운로드 ───
function downloadSellerExcel(
  s: Settlement,
  items: SettlementItem[],
  products: ProductSummary[]
) {
  const wb = XLSX.utils.book_new();
  const storeName = s.stores?.name || "판매자";
  const infPct = s.snap_influencer_rate ?? 70;
  const coPct = s.snap_company_rate ?? 30;
  const sType = s.snap_settlement_type || "사업자";

  const summaryRows = [
    [`${storeName} 정산서`],
    [
      `정산기간: ${s.start_date} ~ ${s.end_date}  |  ${sType}  |  ${infPct}:${coPct} 분배`,
    ],
    [],
    ["[ 매출 ]"],
    ["자사몰 매출", s.cafe24_sales],
    ...(s.phone_sales > 0 ? [["전화주문 매출", s.phone_sales]] : []),
    ...(s.refund_amount !== 0 ? [["환불/반품", s.refund_amount]] : []),
    ["순매출", s.total_sales],
    [],
    ["[ 비용 ]"],
    [`PG수수료 (${s.snap_pg_fee_rate}%)`, s.pg_fee],
    ["제품원가", s.total_cogs],
    ["배송비", s.total_shipping],
    ...(s.tpl_cost > 0 ? [["3PL 물류비", s.tpl_cost]] : []),
    ...(s.other_cost > 0 ? [["기타비용", s.other_cost]] : []),
    ...(s.vat_amount > 0 ? [["부가세 (10%)", s.vat_amount]] : []),
    ["총비용", s.total_cost],
    [],
    ["[ 순익 ]"],
    ["순익", s.net_profit],
    ["순익률", `${s.profit_rate}%`],
    [],
    [`[ 수익 분배 (${infPct}:${coPct}) ]`],
    [`${storeName} 정산금 (${infPct}%)`, s.influencer_amount],
    ...(sType === "프리랜서" && s.withholding_tax > 0
      ? [
          ["원천세 (3.3%)", s.withholding_tax],
          [`${storeName} 실지급액`, s.influencer_actual],
        ]
      : []),
    [`신산애널리틱스 (${coPct}%)`, s.company_amount],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1["!cols"] = [{ wch: 30 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, "정산요약");

  const chLabel: Record<string, string> = { cafe24: "자사몰", phone: "전화", sms: "문자", sample: "샘플", group: "공구", gift: "증정" };
  const orderHeaders = [
    "구분", "판매방식", "주문번호", "주문일", "상품명", "옵션", "수량",
    "단가", "상품금액", "배송비", "쿠폰할인", "앱할인", "추가할인", "정산매출",
    "공급가", "공급배송비", "순익", "과세구분", "공급사",
  ];
  const orderRows = items.map((i) => [
    i.item_type, chLabel[i.sales_channel] || i.sales_channel || "기타",
    i.cafe24_order_id, (i.order_date || "").slice(0, 10),
    i.product_name, i.option_text || "", i.quantity, i.product_price,
    i.product_price * i.quantity, i.shipping_fee || 0,
    i.coupon_discount || 0, i.app_discount || 0, i.additional_discount || 0,
    i.settled_amount, i.supply_total, i.supply_shipping,
    i.settled_amount - i.supply_total - i.supply_shipping,
    i.tax_type, i.supplier_name || "",
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([orderHeaders, ...orderRows]);
  ws2["!cols"] = [
    { wch: 6 }, { wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 40 }, { wch: 20 },
    { wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 8 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "주문상세");

  const prodHeaders = [
    "상품명", "판매수량", "매출", "매입가합계", "배송비합계", "이익", "마진율",
  ];
  const prodRows = products.map((p) => [
    p.product_name, p.quantity, p.sales, p.cogs, p.shipping, p.profit,
    `${p.margin}%`,
  ]);
  const ws3 = XLSX.utils.aoa_to_sheet([prodHeaders, ...prodRows]);
  ws3["!cols"] = [
    { wch: 50 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws3, "상품별매출");

  XLSX.writeFile(wb, `${storeName}_${s.period}_정산서.xlsx`);
}

function downloadSupplierExcel(
  suppliers: SupplierSettlement[],
  period: string
) {
  const wb = XLSX.utils.book_new();
  const headers = [
    "공급사", "건수", "수량", "공급가 합계", "배송비 합계", "지급 총액",
    "판매금액", "상태",
  ];
  const rows = suppliers.map((s) => [
    s.supplier_name, s.item_count, s.total_quantity, s.total_supply,
    s.total_shipping, s.total_amount, s.total_sales,
    SUP_STATUS[s.status]?.label || s.status,
  ]);
  const totalRow = [
    "합계",
    suppliers.reduce((a, b) => a + b.item_count, 0),
    suppliers.reduce((a, b) => a + b.total_quantity, 0),
    suppliers.reduce((a, b) => a + b.total_supply, 0),
    suppliers.reduce((a, b) => a + b.total_shipping, 0),
    suppliers.reduce((a, b) => a + b.total_amount, 0),
    suppliers.reduce((a, b) => a + b.total_sales, 0),
    "",
  ];
  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows, [], totalRow]);
  ws1["!cols"] = [
    { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "공급사별 정산");

  XLSX.writeFile(wb, `공급사정산_${period}.xlsx`);
}

// ═══════════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════════
export default function SettlementPage() {
  const [mainTab, setMainTab] = useState<"seller" | "supplier">("seller");
  const [stores, setStores] = useState<Store[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(periodOptions()[0]);
  const [filterStore, setFilterStore] = useState("");

  // 판매사 상세
  const [detail, setDetail] = useState<Settlement | null>(null);
  const [detailItems, setDetailItems] = useState<SettlementItem[]>([]);
  const [productSummary, setProductSummary] = useState<ProductSummary[]>([]);
  const [detailTab, setDetailTab] = useState<
    "summary" | "orders" | "products"
  >("summary");

  // 메모/비고
  const [adminMemo, setAdminMemo] = useState("");
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [savingMemo, setSavingMemo] = useState(false);

  // 정산 생성
  const [creating, setCreating] = useState(false);
  const [createStore, setCreateStore] = useState("");
  const [createPeriod, setCreatePeriod] = useState(periodOptions()[0]);
  const [includeNoTracking, setIncludeNoTracking] = useState(true);
  const [dateBasis, setDateBasis] = useState<"order_date" | "shipped_at">(
    "order_date"
  );
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(true);
  const [createAllResult, setCreateAllResult] = useState<{
    total: number;
    created: number;
    skipped: number;
    errors: number;
    results: { store_name: string; status: string; error?: string }[];
  } | null>(null);

  // 공급사 정산
  const [supSettlements, setSupSettlements] = useState<SupplierSettlement[]>([]);
  const [supLoading, setSupLoading] = useState(false);
  const [supDetail, setSupDetail] = useState<SupplierSettlement | null>(null);
  const [supDetailProducts, setSupDetailProducts] = useState<SupplierProduct[]>([]);
  const [supDetailItems, setSupDetailItems] = useState<SettlementItem[]>([]);
  const [supCreating, setSupCreating] = useState(false);
  const [supFilterStatus, setSupFilterStatus] = useState("");

  // ─── Data Fetching ───
  const fetchStores = useCallback(async () => {
    const res = await fetch("/admin/api/stores");
    const data = await res.json();
    setStores(data.stores || []);
  }, []);

  const fetchSettlements = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (filterStore) params.set("store_id", filterStore);
      const res = await fetch(`/admin/api/settlements?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSettlements(data.settlements || []);
    } catch {
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  }, [period, filterStore]);

  const fetchSupSettlements = useCallback(async () => {
    if (!period) return;
    setSupLoading(true);
    try {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (supFilterStatus) params.set("status", supFilterStatus);
      const res = await fetch(`/admin/api/supplier-settlements?${params}`);
      const data = await res.json();
      setSupSettlements(data.supplierSettlements || []);
    } catch {
      setSupSettlements([]);
    } finally {
      setSupLoading(false);
    }
  }, [period, supFilterStatus]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);
  useEffect(() => {
    fetchSettlements();
  }, [fetchSettlements]);
  useEffect(() => {
    if (mainTab === "supplier") fetchSupSettlements();
  }, [mainTab, fetchSupSettlements]);

  // ─── 판매사 정산 핸들러 ───
  const handleCreate = async (storeId?: string) => {
    const targetStore = storeId || createStore;
    if (!targetStore) return alert("판매자를 선택하세요");
    setCreating(true);
    const payload: Record<string, unknown> = {
      store_id: targetStore,
      period: createPeriod,
      include_no_tracking: includeNoTracking,
      date_basis: dateBasis,
    };
    if (dateStart) payload.start_date = dateStart;
    if (dateEnd) payload.end_date = dateEnd;
    const res = await fetch("/admin/api/settlements/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) return alert(data.error || "정산 생성 실패");
    setPeriod(createPeriod);
    setFilterStore(targetStore);
    setShowCreateForm(false);
    fetchSettlements();
  };

  const handleCreateAll = async () => {
    if (
      !confirm("모든 활성 판매사의 정산서를 일괄 생성합니다. 진행하시겠습니까?")
    )
      return;
    setCreating(true);
    setCreateAllResult(null);
    const payload: Record<string, unknown> = {
      period: createPeriod,
      include_no_tracking: includeNoTracking,
      date_basis: dateBasis,
    };
    if (dateStart) payload.start_date = dateStart;
    if (dateEnd) payload.end_date = dateEnd;
    const res = await fetch("/admin/api/settlements/calculate-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setCreating(false);
    setCreateAllResult(data);
    setPeriod(createPeriod);
    setFilterStore("");
    fetchSettlements();
  };

  const openDetail = async (s: Settlement) => {
    const res = await fetch(`/admin/api/settlements/${s.id}`);
    const data = await res.json();
    setDetail(data.settlement);
    setDetailItems(data.items || []);
    setProductSummary(data.productSummary || []);
    setDetailTab("summary");
    setAdminMemo(data.settlement?.memo || "");
    setEditingNoteId(null);
    const noteMap: Record<string, string> = {};
    for (const item of (data.items || [])) {
      if (item.admin_note) noteMap[item.id] = item.admin_note;
    }
    setAdminNotes(noteMap);
  };

  const saveAdminMemo = async () => {
    if (!detail) return;
    setSavingMemo(true);
    await fetch(`/admin/api/settlements/${detail.id}/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memo: adminMemo }),
    });
    setSavingMemo(false);
  };

  const saveAdminNote = async (itemId: string) => {
    if (!detail) return;
    const note = adminNotes[itemId] || "";
    await fetch(`/admin/api/settlements/${detail.id}/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: itemId, admin_note: note }] }),
    });
    setEditingNoteId(null);
  };

  const changeStatus = async (id: string, status: string) => {
    await fetch(`/admin/api/settlements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchSettlements();
    if (detail?.id === id) setDetail({ ...detail, status });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 정산서를 삭제하시겠습니까?")) return;
    await fetch("/admin/api/settlements", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchSettlements();
    if (detail?.id === id) setDetail(null);
  };

  // ─── 공급사 정산 핸들러 ───
  const handleSupGenerate = async () => {
    if (
      !confirm(
        `${period} 기간의 공급사 정산을 생성합니다. 판매사 정산 데이터를 기반으로 자동 집계합니다.`
      )
    )
      return;
    setSupCreating(true);
    try {
      const res = await fetch("/admin/api/supplier-settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "공급사 정산 생성 실패");
      } else {
        alert(
          `공급사 정산 생성 완료: ${data.created}건 생성, ${data.skipped}건 스킵`
        );
        fetchSupSettlements();
      }
    } catch {
      alert("공급사 정산 생성 중 오류 발생");
    } finally {
      setSupCreating(false);
    }
  };

  const handleSupStatusChange = async (
    id: string,
    newStatus: string,
    invoiceNo?: string
  ) => {
    const body: Record<string, unknown> = { status: newStatus };
    if (invoiceNo !== undefined) body.invoice_no = invoiceNo;
    await fetch(`/admin/api/supplier-settlements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetchSupSettlements();
    if (supDetail?.id === id) {
      setSupDetail({ ...supDetail, status: newStatus });
    }
  };

  const openSupDetail = async (ss: SupplierSettlement) => {
    const res = await fetch(`/admin/api/supplier-settlements/${ss.id}`);
    const data = await res.json();
    setSupDetail(data.supplierSettlement);
    setSupDetailProducts(data.products || []);
    setSupDetailItems(data.items || []);
  };

  const handleSupDelete = async (id: string) => {
    if (!confirm("이 공급사 정산을 삭제하시겠습니까?")) return;
    await fetch("/admin/api/supplier-settlements", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchSupSettlements();
    if (supDetail?.id === id) setSupDetail(null);
  };

  // ═══ 판매사 상세 뷰 ═══
  if (detail) {
    const s = detail;
    const storeName = s.stores?.name || "판매자";
    const infPct = s.snap_influencer_rate ?? 70;
    const coPct = s.snap_company_rate ?? 30;
    const sType = s.snap_settlement_type || "사업자";

    return (
      <div className="p-8">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setDetail(null)}
            className="text-gray-400 hover:text-gray-600 cursor-pointer text-lg"
          >
            ←
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {storeName} 정산서
              </h1>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full ${SELLER_STATUS[s.status]?.style}`}
              >
                {SELLER_STATUS[s.status]?.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {s.settlement_no} · {s.period} · {sType} · {infPct}:{coPct} 분배
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {s.seller_confirmed ? (
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700" title={s.seller_confirmed_at ? new Date(s.seller_confirmed_at).toLocaleString("ko-KR") : ""}>
                판매자 확정 ✓
              </span>
            ) : (
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">
                판매자 미확인
              </span>
            )}
            {s.share_token && (
              <button
                onClick={() => {
                  const url = `${window.location.origin}/admin/settlement/${s.share_token}`;
                  navigator.clipboard.writeText(url);
                  alert("공유 링크가 복사되었습니다");
                }}
                className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                공유 링크 복사
              </button>
            )}
            <button
              onClick={async () => {
                const res = await fetch(`/admin/api/settlements/${s.id}/excel`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${storeName}_${s.period}_정산서.xlsx`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer"
            >
              Excel 다운로드
            </button>
            {s.status === "draft" && (
              <>
                <button
                  onClick={() => changeStatus(s.id, "confirmed")}
                  className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 cursor-pointer"
                >
                  확정
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="px-3 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 cursor-pointer"
                >
                  삭제
                </button>
              </>
            )}
            {s.status === "confirmed" && (
              <button
                onClick={() => changeStatus(s.id, "paid")}
                className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer"
              >
                지급완료
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          {(["summary", "orders", "products"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setDetailTab(t)}
              className={`px-4 py-2 text-sm rounded-md cursor-pointer transition-colors ${detailTab === t ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
            >
              {t === "summary"
                ? "정산요약"
                : t === "orders"
                  ? `주문상세 (${detailItems.length})`
                  : `상품별 (${productSummary.length})`}
            </button>
          ))}
        </div>

        {detailTab === "summary" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">매출</h3>
              <div className="space-y-3">
                <Row label="자사몰 매출" value={s.cafe24_sales} />
                {s.phone_sales > 0 && (
                  <Row label="전화주문 매출" value={s.phone_sales} />
                )}
                {s.refund_amount !== 0 && (
                  <Row label="환불/반품" value={s.refund_amount} negative />
                )}
                <Row label="순매출" value={s.total_sales} bold highlight />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">비용</h3>
              <div className="space-y-3">
                <Row
                  label={`PG수수료 (${s.snap_pg_fee_rate}%)`}
                  value={s.pg_fee}
                />
                {s.cogs_exempt > 0 ? (
                  <>
                    <Row label="제품원가 (과세)" value={s.cogs_taxable} />
                    <Row label="제품원가 (면세)" value={s.cogs_exempt} />
                    <Row label="  면세 VAT 10%" value={s.cogs_exempt_vat} sub />
                  </>
                ) : (
                  <Row label="제품원가" value={s.total_cogs} />
                )}
                {s.ship_exempt > 0 ? (
                  <>
                    <Row label="배송비 (과세)" value={s.ship_taxable} />
                    <Row label="배송비 (면세)" value={s.ship_exempt} />
                    <Row label="  면세 VAT 10%" value={s.ship_exempt_vat} sub />
                  </>
                ) : (
                  <Row label="배송비" value={s.total_shipping} />
                )}
                {s.tpl_cost > 0 && <Row label="3PL 물류비" value={s.tpl_cost} />}
                {s.other_cost > 0 && (
                  <Row label="기타비용" value={s.other_cost} />
                )}
                {s.vat_amount > 0 && (
                  <Row label="부가세 (10%)" value={s.vat_amount} />
                )}
                <Row label="총비용" value={s.total_cost} bold highlight />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">순익</h3>
              <div className="space-y-3">
                <Row label="순익" value={s.net_profit} bold />
                <Row label="순익률" value={`${s.profit_rate}%`} isText />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">
                수익 분배 ({infPct}:{coPct})
              </h3>
              <div className="space-y-3">
                <Row
                  label={`${storeName} 정산금 (${infPct}%)`}
                  value={s.influencer_amount}
                  bold
                />
                {sType === "프리랜서" && s.withholding_tax > 0 && (
                  <>
                    <Row
                      label="  원천세 (3.3%)"
                      value={-s.withholding_tax}
                      sub
                    />
                    <Row
                      label={`  ${storeName} 실지급액`}
                      value={s.influencer_actual}
                      bold
                      highlight
                    />
                  </>
                )}
                <Row
                  label={`신산애널리틱스 (${coPct}%)`}
                  value={s.company_amount}
                />
              </div>
            </div>
          </div>
        )}

        {detailTab === "orders" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  {[
                    "구분", "판매방식", "주문번호", "주문일", "상품명", "옵션", "수량",
                    "단가", "상품금액", "배송비", "쿠폰할인", "앱할인", "추가할인", "정산매출",
                    "공급가", "공급배송비", "순익", "과세", "공급사", "담당자 비고", "판매사 비고",
                  ].map((h) => (
                    <th
                      key={h}
                      className={`px-3 py-2.5 font-medium text-left whitespace-nowrap ${
                        ["쿠폰할인", "앱할인", "추가할인"].includes(h) ? "text-red-500"
                        : h === "순익" ? "text-blue-600" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detailItems.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-gray-50 ${item.item_type !== "매출" ? "bg-red-50/30" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${item.item_type === "매출" ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-600"}`}
                      >
                        {item.item_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {(() => {
                        const colorMap: Record<string, string> = {
                          cafe24: "bg-green-50 text-green-700", phone: "bg-orange-50 text-orange-700",
                          sms: "bg-purple-50 text-purple-700", group: "bg-blue-50 text-blue-700",
                          sample: "bg-gray-100 text-gray-500", gift: "bg-violet-50 text-violet-700",
                        };
                        const labelMap: Record<string, string> = {
                          cafe24: "자사몰", phone: "전화", sms: "문자",
                          sample: "샘플", group: "공구", gift: "증정",
                        };
                        const ch = item.sales_channel || "etc";
                        return (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${colorMap[ch] || "bg-gray-50 text-gray-500"}`}>
                            {labelMap[ch] || ch}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-gray-600 whitespace-nowrap">
                      {item.cafe24_order_id}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                      {(item.order_date || "").slice(0, 10)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-900 max-w-[200px] truncate">
                      {item.product_name}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 max-w-[120px] truncate">
                      {item.option_text || "-"}
                    </td>
                    <td className="px-3 py-2.5 text-right">{item.quantity}</td>
                    <td className="px-3 py-2.5 text-right">
                      {W(item.product_price)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500">
                      {W(item.product_price * item.quantity)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500">
                      {item.shipping_fee ? W(item.shipping_fee) : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-red-500">
                      {item.coupon_discount ? `-${W(item.coupon_discount)}` : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-red-500">
                      {item.app_discount ? `-${W(item.app_discount)}` : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-red-500">
                      {item.additional_discount ? `-${W(item.additional_discount)}` : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium bg-yellow-50">
                      {W(item.settled_amount)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {W(item.supply_total)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {W(item.supply_shipping)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-medium ${
                      (item.settled_amount - item.supply_total - item.supply_shipping) >= 0
                        ? "text-blue-600" : "text-red-600"
                    }`}>
                      {W(item.settled_amount - item.supply_total - item.supply_shipping)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-xs ${item.tax_type === "면세" ? "text-pink-600" : "text-gray-400"}`}
                      >
                        {item.tax_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500">
                      {item.supplier_name || "-"}
                    </td>
                    {/* 담당자 비고 (편집가능) */}
                    <td className="px-3 py-2.5 min-w-[140px]">
                      {editingNoteId === item.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={adminNotes[item.id] || ""}
                            onChange={e => setAdminNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") saveAdminNote(item.id); if (e.key === "Escape") setEditingNoteId(null); }}
                            className="flex-1 px-2 py-1 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                            autoFocus
                          />
                          <button onClick={() => saveAdminNote(item.id)} className="text-[10px] text-blue-600 hover:text-blue-800 cursor-pointer whitespace-nowrap">저장</button>
                        </div>
                      ) : (
                        <span
                          onClick={() => { setEditingNoteId(item.id); setAdminNotes(prev => ({ ...prev, [item.id]: prev[item.id] || item.admin_note || "" })); }}
                          className={`text-xs cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded ${adminNotes[item.id] || item.admin_note ? "text-gray-700" : "text-gray-300"}`}
                        >
                          {adminNotes[item.id] || item.admin_note || "클릭하여 입력"}
                        </span>
                      )}
                    </td>
                    {/* 판매사 비고 (읽기전용) */}
                    <td className="px-3 py-2.5 text-xs text-gray-500 min-w-[120px]">
                      {item.seller_note || <span className="text-gray-300">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detailTab === "products" && (
          <div className="bg-white rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  {[
                    "상품명", "판매수량", "매출", "매입가합계", "배송비합계",
                    "이익", "마진율",
                  ].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productSummary.map((p) => (
                  <tr
                    key={p.product_name}
                    className="border-b border-gray-50"
                  >
                    <td className="px-4 py-3 text-gray-900 max-w-[300px] truncate">
                      {p.product_name}
                    </td>
                    <td className="px-4 py-3 text-right">{p.quantity}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {W(p.sales)}
                    </td>
                    <td className="px-4 py-3 text-right">{W(p.cogs)}</td>
                    <td className="px-4 py-3 text-right">{W(p.shipping)}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {W(p.profit)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          p.margin >= 30
                            ? "text-green-600"
                            : p.margin >= 15
                              ? "text-gray-700"
                              : "text-red-600"
                        }
                      >
                        {p.margin}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 메모 영역 ── */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 담당자 메모 (편집가능) */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">담당자 메모</h3>
            <textarea
              value={adminMemo}
              onChange={e => setAdminMemo(e.target.value)}
              placeholder="내부 메모를 입력하세요..."
              className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 resize-none"
              rows={3}
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={saveAdminMemo}
                disabled={savingMemo}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {savingMemo ? "저장 중..." : "메모 저장"}
              </button>
            </div>
          </div>

          {/* 판매사 메모 (읽기전용) */}
          {s.seller_memo && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">판매사 메모</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{s.seller_memo}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══ 공급사 상세 뷰 ═══
  if (supDetail) {
    const ss = supDetail;
    const nextStatus = SUP_STATUS_ORDER[SUP_STATUS_ORDER.indexOf(ss.status) + 1];

    return (
      <div className="p-8">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setSupDetail(null)}
            className="text-gray-400 hover:text-gray-600 cursor-pointer text-lg"
          >
            ←
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {ss.supplier_name} 정산서
              </h1>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full ${SUP_STATUS[ss.status]?.style}`}
              >
                {SUP_STATUS[ss.status]?.icon} {SUP_STATUS[ss.status]?.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {ss.period} · {ss.item_count}건 · {ss.total_quantity}개
            </p>
          </div>
          <div className="flex gap-2">
            {ss.status === "draft" && (
              <>
                <button
                  onClick={() => handleSupStatusChange(ss.id, "sent")}
                  className="px-3 py-2 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 cursor-pointer"
                >
                  자료전달
                </button>
                <button
                  onClick={() => handleSupDelete(ss.id)}
                  className="px-3 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 cursor-pointer"
                >
                  삭제
                </button>
              </>
            )}
            {ss.status === "sent" && (
              <button
                onClick={() => handleSupStatusChange(ss.id, "confirmed")}
                className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 cursor-pointer"
              >
                확인완료
              </button>
            )}
            {ss.status === "confirmed" && (
              <button
                onClick={() => {
                  const no = prompt("세금계산서 번호를 입력하세요 (선택사항):");
                  handleSupStatusChange(ss.id, "invoiced", no || undefined);
                }}
                className="px-3 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 cursor-pointer"
              >
                세금계산서 발행
              </button>
            )}
            {ss.status === "invoiced" && (
              <button
                onClick={() => handleSupStatusChange(ss.id, "paid")}
                className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer"
              >
                지급완료
              </button>
            )}
          </div>
        </div>

        {/* 상태 타임라인 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">정산 진행 현황</h3>
          <div className="flex items-center gap-0">
            {SUP_STATUS_ORDER.map((st, idx) => {
              const isActive = SUP_STATUS_ORDER.indexOf(ss.status) >= idx;
              const isCurrent = ss.status === st;
              const timestamps: Record<string, string | null> = {
                draft: ss.created_at,
                sent: ss.sent_at,
                confirmed: ss.confirmed_at,
                invoiced: ss.invoiced_at,
                paid: ss.paid_at,
              };
              const ts = timestamps[st];
              return (
                <Fragment key={st}>
                  {idx > 0 && (
                    <div
                      className={`flex-1 h-0.5 ${isActive ? "bg-[#C41E1E]" : "bg-gray-200"}`}
                    />
                  )}
                  <div className="flex flex-col items-center min-w-[80px]">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                        isCurrent
                          ? "bg-[#C41E1E] text-white ring-4 ring-red-100"
                          : isActive
                            ? "bg-[#C41E1E] text-white"
                            : "bg-gray-200 text-gray-400"
                      }`}
                    >
                      {isActive && !isCurrent ? "✓" : idx + 1}
                    </div>
                    <span
                      className={`text-xs mt-1.5 ${isCurrent ? "font-semibold text-[#C41E1E]" : isActive ? "text-gray-700" : "text-gray-400"}`}
                    >
                      {SUP_STATUS[st]?.label}
                    </span>
                    {ts && (
                      <span className="text-[10px] text-gray-400 mt-0.5">
                        {new Date(ts).toLocaleDateString("ko-KR", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
          {nextStatus && (
            <p className="text-xs text-gray-500 mt-4 text-center">
              다음 단계: <strong>{SUP_STATUS[nextStatus]?.label}</strong>
              {nextStatus === "sent" && " — 공급사에 정산 자료를 전달합니다 (익월 3~4일)"}
              {nextStatus === "confirmed" && " — 공급사가 자료를 확인하면 처리합니다"}
              {nextStatus === "invoiced" && " — 공급사가 세금계산서를 발행합니다"}
              {nextStatus === "paid" && " — 공급사에 대금을 지급합니다 (15일)"}
            </p>
          )}
        </div>

        {/* 금액 요약 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: "공급가 합계", value: W(ss.total_supply) },
            { label: "배송비 합계", value: W(ss.total_shipping) },
            {
              label: "지급 총액",
              value: W(ss.total_amount),
              bold: true,
            },
            { label: "판매금액 (소비자가)", value: W(ss.total_sales) },
          ].map((c) => (
            <div
              key={c.label}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <p className="text-xs text-gray-500">{c.label}</p>
              <p
                className={`text-lg mt-1 text-gray-900 ${c.bold ? "font-bold text-blue-600" : "font-semibold"}`}
              >
                {c.value}
              </p>
            </div>
          ))}
        </div>

        {/* 세금계산서 정보 */}
        {ss.invoice_no && (
          <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 mb-6">
            <p className="text-sm text-purple-800">
              <span className="font-semibold">세금계산서 번호:</span>{" "}
              {ss.invoice_no}
            </p>
          </div>
        )}

        {/* 상품별 상세 */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">
              상품별 내역 ({supDetailProducts.length}건)
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left px-6 py-2.5 font-medium">상품명</th>
                <th className="text-right px-3 py-2.5 font-medium">수량</th>
                <th className="text-right px-3 py-2.5 font-medium">공급가</th>
                <th className="text-right px-3 py-2.5 font-medium">배송비</th>
                <th className="text-right px-3 py-2.5 font-medium">소계</th>
                <th className="text-right px-6 py-2.5 font-medium">
                  판매금액
                </th>
              </tr>
            </thead>
            <tbody>
              {supDetailProducts.map((p) => (
                <tr
                  key={p.name}
                  className="border-b border-gray-50 hover:bg-gray-50/50"
                >
                  <td className="px-6 py-3 text-gray-900 max-w-[300px] truncate">
                    {p.name}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    {p.qty}개
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    {W(p.supply)}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    {W(p.shipping)}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-blue-600">
                    {W(p.supply + p.shipping)}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-500">
                    {W(p.sales)}
                  </td>
                </tr>
              ))}
              {supDetailProducts.length > 0 && (
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-6 py-3 text-gray-900">합계</td>
                  <td className="px-3 py-3 text-right">
                    {supDetailProducts.reduce((a, b) => a + b.qty, 0)}개
                  </td>
                  <td className="px-3 py-3 text-right">
                    {W(supDetailProducts.reduce((a, b) => a + b.supply, 0))}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {W(supDetailProducts.reduce((a, b) => a + b.shipping, 0))}
                  </td>
                  <td className="px-3 py-3 text-right text-blue-600">
                    {W(
                      supDetailProducts.reduce(
                        (a, b) => a + b.supply + b.shipping,
                        0
                      )
                    )}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-500">
                    {W(supDetailProducts.reduce((a, b) => a + b.sales, 0))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {supDetailProducts.length === 0 && (
            <div className="p-12 text-center text-gray-400">
              상품 내역이 없습니다.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── 통계 ───
  const totalSales = settlements.reduce((s, v) => s + v.total_sales, 0);
  const totalProfit = settlements.reduce((s, v) => s + v.net_profit, 0);
  const totalInfluencer = settlements.reduce(
    (s, v) => s + v.influencer_actual,
    0
  );
  const draftCount = settlements.filter((s) => s.status === "draft").length;

  const supTotalAmount = supSettlements.reduce(
    (a, b) => a + b.total_amount,
    0
  );
  const supTotalSales = supSettlements.reduce(
    (a, b) => a + b.total_sales,
    0
  );
  const supNotInvoiced = supSettlements.filter(
    (s) => s.status !== "invoiced" && s.status !== "paid"
  ).length;
  const supNotPaid = supSettlements.filter((s) => s.status !== "paid").length;

  // ═══ 목록 뷰 ═══
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">정산관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            판매자/공급사별 월간 정산을 생성하고 관리합니다.
          </p>
        </div>
      </div>

      {/* 정산 일정 안내 */}
      <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex gap-8 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[#C41E1E] rounded-full" />
            <span>
              <strong>익월 3~4일</strong> 공급사 정산자료 전달
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
            <span>
              <strong>익월 5일~</strong> 판매사 정산자료 전달
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            <span>
              <strong>15일</strong> 공급사/판매사 대금 지급
            </span>
          </div>
        </div>
      </div>

      {/* 메인 탭 */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setMainTab("seller")}
          className={`px-5 py-2.5 text-sm rounded-md cursor-pointer transition-colors ${mainTab === "seller" ? "bg-white shadow-sm font-semibold text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
        >
          판매사 정산
        </button>
        <button
          onClick={() => setMainTab("supplier")}
          className={`px-5 py-2.5 text-sm rounded-md cursor-pointer transition-colors ${mainTab === "supplier" ? "bg-white shadow-sm font-semibold text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
        >
          공급사 정산
        </button>
      </div>

      {/* ═══ 판매사 정산 탭 ═══ */}
      {mainTab === "seller" && (
        <>
          {/* 정산 생성 */}
          <div className="bg-white rounded-xl border border-gray-200 mb-6">
            <div
              className="flex items-center justify-between p-5 border-b border-gray-100 cursor-pointer"
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              <h3 className="text-sm font-semibold text-gray-900">
                정산서 생성
              </h3>
              <span className="text-xs text-gray-400">
                {showCreateForm ? "접기 ▲" : "펼치기 ▼"}
              </span>
            </div>
            {showCreateForm && (
              <div className="p-5 space-y-4">
                <div className="flex gap-4 items-end">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      정산 기간
                    </label>
                    <select
                      value={createPeriod}
                      onChange={(e) => setCreatePeriod(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      {periodOptions().map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      판매자 (개별 생성 시)
                    </label>
                    <select
                      value={createStore}
                      onChange={(e) => setCreateStore(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]"
                    >
                      <option value="">전체</option>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-700 min-w-[100px]">
                      정산 기준:
                    </span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="dateBasis"
                        checked={dateBasis === "order_date"}
                        onChange={() => setDateBasis("order_date")}
                        className="accent-[#C41E1E]"
                      />
                      <span className="text-sm">주문일 기준</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="dateBasis"
                        checked={dateBasis === "shipped_at"}
                        onChange={() => setDateBasis("shipped_at")}
                        className="accent-[#C41E1E]"
                      />
                      <span className="text-sm">송장등록일 기준</span>
                    </label>
                  </div>

                  {dateBasis === "order_date" && (
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-700 min-w-[100px]">
                        송장미등록건:
                      </span>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="noTracking"
                          checked={includeNoTracking}
                          onChange={() => setIncludeNoTracking(true)}
                          className="accent-[#C41E1E]"
                        />
                        <span className="text-sm">포함(기본값)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="noTracking"
                          checked={!includeNoTracking}
                          onChange={() => setIncludeNoTracking(false)}
                          className="accent-[#C41E1E]"
                        />
                        <span className="text-sm">미포함</span>
                      </label>
                    </div>
                  )}
                  {dateBasis === "shipped_at" && (
                    <p className="text-xs text-blue-600 pl-[116px]">
                      송장등록일 기준 시 송장미등록 주문은 자동으로 제외됩니다.
                    </p>
                  )}

                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 min-w-[100px]">
                      정산 기간:
                    </span>
                    <input
                      type="date"
                      value={dateStart}
                      onChange={(e) => setDateStart(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    />
                    <span className="text-gray-400">~</span>
                    <input
                      type="date"
                      value={dateEnd}
                      onChange={(e) => setDateEnd(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    />
                    <span className="text-xs text-gray-400">
                      비워두면 선택한 월의 1일~말일
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 items-center">
                  <button
                    onClick={() => handleCreate()}
                    disabled={creating}
                    className={`px-5 py-2.5 text-sm font-medium rounded-lg cursor-pointer ${!createStore ? "bg-gray-300 text-gray-500" : "bg-[#C41E1E] text-white hover:bg-[#A01818]"} disabled:opacity-50`}
                  >
                    {creating ? "계산 중..." : "정산서 만들기"}
                  </button>
                  <button
                    onClick={handleCreateAll}
                    disabled={creating}
                    className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                  >
                    {creating ? "생성 중..." : "전체 판매사 일괄 생성"}
                  </button>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="px-4 py-2.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    취소
                  </button>
                </div>

                <p className="text-xs text-gray-400">
                  해당 기간의 주문 데이터를 기반으로 자동 계산합니다. 기존 임시
                  정산이 있으면 덮어씁니다.
                </p>

                {createAllResult && (
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-blue-900 mb-2">
                      일괄 생성 완료: {createAllResult.created}건 생성 /{" "}
                      {createAllResult.skipped}건 스킵 /{" "}
                      {createAllResult.errors}건 오류
                    </p>
                    <div className="space-y-1">
                      {createAllResult.results.map((r, i) => (
                        <div key={i} className="text-xs flex gap-2">
                          <span
                            className={
                              r.status === "created"
                                ? "text-green-600"
                                : r.status === "skipped"
                                  ? "text-gray-400"
                                  : "text-red-600"
                            }
                          >
                            {r.status === "created"
                              ? "✓"
                              : r.status === "skipped"
                                ? "−"
                                : "✗"}
                          </span>
                          <span className="text-gray-700">{r.store_name}</span>
                          {r.error && (
                            <span className="text-gray-400">({r.error})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 mb-4">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 기간</option>
              {periodOptions().map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={filterStore}
              onChange={(e) => setFilterStore(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 판매자</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: "총 순매출", value: W(totalSales) },
              { label: "총 순익", value: W(totalProfit) },
              { label: "인플루언서 실지급", value: W(totalInfluencer) },
              { label: "미확정 건수", value: `${draftCount}건` },
            ].map((c) => (
              <div
                key={c.label}
                className="bg-white rounded-xl border border-gray-200 p-4"
              >
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-lg font-bold text-gray-900 mt-1">
                  {c.value}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200">
            {loading ? (
              <div className="p-12 text-center text-gray-400">
                불러오는 중...
              </div>
            ) : settlements.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                해당 기간에 정산서가 없습니다.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-6 py-3 font-medium">
                      정산번호
                    </th>
                    <th className="text-left px-3 py-3 font-medium">판매자</th>
                    <th className="text-left px-3 py-3 font-medium">기간</th>
                    <th className="text-right px-3 py-3 font-medium">
                      순매출
                    </th>
                    <th className="text-right px-3 py-3 font-medium">
                      총비용
                    </th>
                    <th className="text-right px-3 py-3 font-medium">순익</th>
                    <th className="text-right px-3 py-3 font-medium">
                      인플루언서
                    </th>
                    <th className="text-right px-3 py-3 font-medium">회사</th>
                    <th className="text-center px-3 py-3 font-medium">상태</th>
                    <th className="text-center px-6 py-3 font-medium">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                    >
                      <td className="px-6 py-3.5">
                        <code className="text-xs font-mono text-gray-600">
                          {s.settlement_no}
                        </code>
                      </td>
                      <td className="px-3 py-3.5 text-sm font-medium text-gray-900">
                        {s.stores?.name || "-"}
                      </td>
                      <td className="px-3 py-3.5 text-sm text-gray-500">
                        {s.period}
                      </td>
                      <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                        {W(s.total_sales)}
                      </td>
                      <td className="px-3 py-3.5 text-sm text-gray-500 text-right">
                        {W(s.total_cost)}
                      </td>
                      <td
                        className="px-3 py-3.5 text-sm font-medium text-right"
                        style={{
                          color: s.net_profit >= 0 ? "#059669" : "#DC2626",
                        }}
                      >
                        {W(s.net_profit)}
                      </td>
                      <td className="px-3 py-3.5 text-sm text-blue-600 text-right">
                        {W(s.influencer_actual)}
                      </td>
                      <td className="px-3 py-3.5 text-sm text-gray-500 text-right">
                        {W(s.company_amount)}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <span
                          className={`text-xs font-medium px-2 py-1 rounded-full ${SELLER_STATUS[s.status]?.style}`}
                        >
                          {SELLER_STATUS[s.status]?.label}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-center">
                        <button
                          onClick={() => openDetail(s)}
                          className="text-xs text-[#C41E1E] hover:underline cursor-pointer font-medium"
                        >
                          상세
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ═══ 공급사 정산 탭 ═══ */}
      {mainTab === "supplier" && (
        <>
          {/* 상단 액션바 */}
          <div className="flex gap-3 items-center mb-4">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {periodOptions().map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={supFilterStatus}
              onChange={(e) => setSupFilterStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 상태</option>
              {SUP_STATUS_ORDER.map((st) => (
                <option key={st} value={st}>
                  {SUP_STATUS[st]?.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleSupGenerate}
              disabled={supCreating}
              className="px-4 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer"
            >
              {supCreating ? "생성 중..." : "공급사 정산 생성"}
            </button>
            {supSettlements.length > 0 && (
              <button
                onClick={() => downloadSupplierExcel(supSettlements, period)}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer"
              >
                Excel 다운로드
              </button>
            )}
          </div>

          {/* 요약 카드 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              {
                label: "공급사 수",
                value: `${supSettlements.length}개`,
              },
              {
                label: "지급 총액",
                value: W(supTotalAmount),
              },
              {
                label: "세금계산서 미발행",
                value: `${supNotInvoiced}건`,
                warn: supNotInvoiced > 0,
              },
              {
                label: "지급 대기",
                value: `${supNotPaid}건`,
                warn: supNotPaid > 0,
              },
            ].map((c) => (
              <div
                key={c.label}
                className="bg-white rounded-xl border border-gray-200 p-4"
              >
                <p className="text-xs text-gray-500">{c.label}</p>
                <p
                  className={`text-lg font-bold mt-1 ${c.warn ? "text-orange-600" : "text-gray-900"}`}
                >
                  {c.value}
                </p>
              </div>
            ))}
          </div>

          {/* 상태별 진행 현황 바 */}
          {supSettlements.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
              <div className="flex gap-2 items-center">
                {SUP_STATUS_ORDER.map((st) => {
                  const count = supSettlements.filter(
                    (s) => s.status === st
                  ).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={st}
                      onClick={() =>
                        setSupFilterStatus(
                          supFilterStatus === st ? "" : st
                        )
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                        supFilterStatus === st
                          ? SUP_STATUS[st]?.style + " ring-2 ring-offset-1 ring-gray-300"
                          : SUP_STATUS[st]?.style
                      }`}
                    >
                      {SUP_STATUS[st]?.label}
                      <span className="bg-white/60 px-1.5 py-0.5 rounded-full text-[10px]">
                        {count}
                      </span>
                    </button>
                  );
                })}
                {supFilterStatus && (
                  <button
                    onClick={() => setSupFilterStatus("")}
                    className="text-xs text-gray-400 hover:text-gray-600 ml-2 cursor-pointer"
                  >
                    필터 해제
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 공급사 정산 목록 */}
          <div className="bg-white rounded-xl border border-gray-200">
            {supLoading ? (
              <div className="p-12 text-center text-gray-400">
                불러오는 중...
              </div>
            ) : supSettlements.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-400 mb-2">
                  해당 기간에 공급사 정산이 없습니다.
                </p>
                <p className="text-xs text-gray-400">
                  판매사 정산을 먼저 생성한 후, &quot;공급사 정산 생성&quot;
                  버튼을 클릭하세요.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-6 py-3 font-medium">
                      공급사
                    </th>
                    <th className="text-right px-3 py-3 font-medium">건수</th>
                    <th className="text-right px-3 py-3 font-medium">수량</th>
                    <th className="text-right px-3 py-3 font-medium">
                      공급가
                    </th>
                    <th className="text-right px-3 py-3 font-medium">
                      배송비
                    </th>
                    <th className="text-right px-3 py-3 font-medium">
                      지급 총액
                    </th>
                    <th className="text-center px-3 py-3 font-medium">상태</th>
                    <th className="text-center px-3 py-3 font-medium">
                      다음 단계
                    </th>
                    <th className="text-center px-6 py-3 font-medium">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {supSettlements.map((ss) => {
                    const nextIdx =
                      SUP_STATUS_ORDER.indexOf(ss.status) + 1;
                    const nextSt =
                      nextIdx < SUP_STATUS_ORDER.length
                        ? SUP_STATUS_ORDER[nextIdx]
                        : null;

                    return (
                      <tr
                        key={ss.id}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                      >
                        <td className="px-6 py-3.5 text-sm font-medium text-gray-900">
                          {ss.supplier_name}
                        </td>
                        <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                          {ss.item_count}건
                        </td>
                        <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                          {ss.total_quantity}개
                        </td>
                        <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                          {W(ss.total_supply)}
                        </td>
                        <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                          {W(ss.total_shipping)}
                        </td>
                        <td className="px-3 py-3.5 text-sm font-semibold text-right text-blue-600">
                          {W(ss.total_amount)}
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span
                            className={`text-xs font-medium px-2 py-1 rounded-full ${SUP_STATUS[ss.status]?.style}`}
                          >
                            {SUP_STATUS[ss.status]?.label}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          {nextSt && (
                            <button
                              onClick={() => {
                                if (nextSt === "invoiced") {
                                  const no = prompt(
                                    "세금계산서 번호 (선택사항):"
                                  );
                                  handleSupStatusChange(
                                    ss.id,
                                    nextSt,
                                    no || undefined
                                  );
                                } else {
                                  handleSupStatusChange(ss.id, nextSt);
                                }
                              }}
                              className={`text-xs font-medium px-2.5 py-1 rounded-lg cursor-pointer transition-colors ${
                                nextSt === "sent"
                                  ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                                  : nextSt === "confirmed"
                                    ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                                    : nextSt === "invoiced"
                                      ? "bg-purple-100 text-purple-700 hover:bg-purple-200"
                                      : "bg-green-100 text-green-700 hover:bg-green-200"
                              }`}
                            >
                              → {SUP_STATUS[nextSt]?.label}
                            </button>
                          )}
                          {!nextSt && (
                            <span className="text-xs text-green-600 font-medium">
                              완료
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          <button
                            onClick={() => openSupDetail(ss)}
                            className="text-xs text-[#C41E1E] hover:underline cursor-pointer font-medium"
                          >
                            상세
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 공통 Row 컴포넌트 ───
function Row({
  label,
  value,
  bold,
  highlight,
  sub,
  negative,
  isText,
}: {
  label: string;
  value: number | string;
  bold?: boolean;
  highlight?: boolean;
  sub?: boolean;
  negative?: boolean;
  isText?: boolean;
}) {
  const formatted = isText ? String(value) : W(Number(value));
  return (
    <div
      className={`flex justify-between items-center py-1.5 ${highlight ? "bg-blue-50/50 -mx-2 px-2 rounded" : ""}`}
    >
      <span
        className={`text-sm ${sub ? "text-gray-400 pl-2" : bold ? "font-semibold text-gray-900" : "text-gray-600"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${bold ? "font-semibold text-gray-900" : "text-gray-700"} ${negative ? "text-red-600" : ""}`}
      >
        {formatted}
      </span>
    </div>
  );
}
