"use client";

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

// ─── Types ───
interface Store { id: string; name: string; mall_id: string; settlement_type: string; influencer_rate: number; company_rate: number; }
interface Settlement {
  id: string; settlement_no: string; store_id: string; period: string;
  start_date: string; end_date: string;
  cafe24_sales: number; phone_sales: number; refund_amount: number; total_sales: number;
  pg_fee: number; cogs_taxable: number; cogs_exempt: number; cogs_exempt_vat: number; total_cogs: number;
  ship_taxable: number; ship_exempt: number; ship_exempt_vat: number; total_shipping: number;
  tpl_cost: number; other_cost: number; vat_amount: number; total_cost: number;
  net_profit: number; profit_rate: number;
  influencer_amount: number; withholding_tax: number; influencer_actual: number; company_amount: number;
  snap_influencer_rate: number; snap_company_rate: number; snap_settlement_type: string; snap_pg_fee_rate: number;
  status: string; confirmed_at: string | null; paid_at: string | null;
  total_orders: number; total_items: number; memo: string | null;
  created_at: string;
  stores?: Store;
}
interface SettlementItem {
  id: string; order_id: string; cafe24_order_id: string; cafe24_order_item_code: string;
  order_date: string; product_name: string; option_text: string; quantity: number;
  product_price: number; order_amount: number; shipping_fee: number; discount_amount: number; settled_amount: number;
  supply_price: number; supply_total: number; supply_shipping: number; tax_type: string;
  item_type: string; supplier_name: string; store_name: string;
}
interface ProductSummary {
  product_name: string; quantity: number; sales: number; cogs: number; shipping: number; profit: number; margin: number;
}
interface SupplierSummary {
  supplier_id: string; supplier_name: string;
  item_count: number; total_quantity: number;
  total_supply: number; total_shipping: number; total_amount: number; total_sales: number;
  products: { name: string; qty: number; supply: number; shipping: number }[];
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  confirmed: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
};
const STATUS_LABEL: Record<string, string> = { draft: "임시", confirmed: "확정", paid: "지급완료" };
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

// ─── Excel 다운로드 유틸 ───
function downloadSellerExcel(s: Settlement, items: SettlementItem[], products: ProductSummary[]) {
  const wb = XLSX.utils.book_new();
  const storeName = s.stores?.name || "판매자";
  const infPct = s.snap_influencer_rate ?? 70;
  const coPct = s.snap_company_rate ?? 30;
  const sType = s.snap_settlement_type || "사업자";

  // 시트1: 정산요약
  const summaryRows = [
    [`${storeName} 정산서`],
    [`정산기간: ${s.start_date} ~ ${s.end_date}  |  ${sType}  |  ${infPct}:${coPct} 분배`],
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
    ...(sType === "프리랜서" && s.withholding_tax > 0 ? [
      ["원천세 (3.3%)", s.withholding_tax],
      [`${storeName} 실지급액`, s.influencer_actual],
    ] : []),
    [`신산애널리틱스 (${coPct}%)`, s.company_amount],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1["!cols"] = [{ wch: 30 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, "정산요약");

  // 시트2: 주문상세
  const orderHeaders = ["구분", "주문번호", "주문일", "상품명", "옵션", "수량", "단가", "정산매출", "공급가", "공급배송비", "과세구분", "공급사"];
  const orderRows = items.map((i) => [
    i.item_type, i.cafe24_order_id, (i.order_date || "").slice(0, 10),
    i.product_name, i.option_text || "", i.quantity, i.product_price,
    i.settled_amount, i.supply_total, i.supply_shipping, i.tax_type, i.supplier_name || "",
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([orderHeaders, ...orderRows]);
  ws2["!cols"] = [{ wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, "주문상세");

  // 시트3: 상품별매출
  const prodHeaders = ["상품명", "판매수량", "매출", "매입가합계", "배송비합계", "이익", "마진율"];
  const prodRows = products.map((p) => [p.product_name, p.quantity, p.sales, p.cogs, p.shipping, p.profit, `${p.margin}%`]);
  const ws3 = XLSX.utils.aoa_to_sheet([prodHeaders, ...prodRows]);
  ws3["!cols"] = [{ wch: 50 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws3, "상품별매출");

  XLSX.writeFile(wb, `${storeName}_${s.period}_정산서.xlsx`);
}

function downloadSupplierExcel(suppliers: SupplierSummary[], period: string) {
  const wb = XLSX.utils.book_new();

  // 시트1: 공급사별 요약
  const headers = ["공급사", "건수", "수량", "공급가 합계", "배송비 합계", "지급 총액", "판매금액"];
  const rows = suppliers.map((s) => [s.supplier_name, s.item_count, s.total_quantity, s.total_supply, s.total_shipping, s.total_amount, s.total_sales]);
  const totalRow = ["합계", suppliers.reduce((a, b) => a + b.item_count, 0), suppliers.reduce((a, b) => a + b.total_quantity, 0),
    suppliers.reduce((a, b) => a + b.total_supply, 0), suppliers.reduce((a, b) => a + b.total_shipping, 0),
    suppliers.reduce((a, b) => a + b.total_amount, 0), suppliers.reduce((a, b) => a + b.total_sales, 0)];
  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows, [], totalRow]);
  ws1["!cols"] = [{ wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, "공급사별 요약");

  // 공급사별 상세 시트
  for (const sup of suppliers) {
    if (sup.supplier_name === "미배정") continue;
    const ph = ["상품명", "수량", "공급가", "배송비"];
    const pr = sup.products.map((p) => [p.name, p.qty, p.supply, p.shipping]);
    const ws = XLSX.utils.aoa_to_sheet([ph, ...pr]);
    ws["!cols"] = [{ wch: 50 }, { wch: 8 }, { wch: 14 }, { wch: 14 }];
    const sheetName = sup.supplier_name.slice(0, 28);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

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
  const [detailTab, setDetailTab] = useState<"summary" | "orders" | "products">("summary");

  // 정산 생성
  const [creating, setCreating] = useState(false);
  const [createStore, setCreateStore] = useState("");
  const [createPeriod, setCreatePeriod] = useState(periodOptions()[0]);
  const [includeNoTracking, setIncludeNoTracking] = useState(true);
  const [cutoffDate, setCutoffDate] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createAllResult, setCreateAllResult] = useState<{ total: number; created: number; skipped: number; errors: number; results: { store_name: string; status: string; error?: string }[] } | null>(null);

  // 공급사 정산
  const [supplierData, setSupplierData] = useState<SupplierSummary[]>([]);
  const [supLoading, setSupLoading] = useState(false);
  const [expandedSup, setExpandedSup] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    const res = await fetch("/admin/api/stores");
    const data = await res.json();
    setStores(data.stores || []);
  }, []);

  const fetchSettlements = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    if (filterStore) params.set("store_id", filterStore);
    const res = await fetch(`/admin/api/settlements?${params}`);
    const data = await res.json();
    setSettlements(data.settlements || []);
    setLoading(false);
  }, [period, filterStore]);

  const fetchSupplierSummary = useCallback(async () => {
    if (!period) return;
    setSupLoading(true);
    const res = await fetch(`/admin/api/settlements/supplier-summary?period=${period}`);
    const data = await res.json();
    setSupplierData(data.suppliers || []);
    setSupLoading(false);
  }, [period]);

  useEffect(() => { fetchStores(); }, [fetchStores]);
  useEffect(() => { fetchSettlements(); }, [fetchSettlements]);
  useEffect(() => { if (mainTab === "supplier") fetchSupplierSummary(); }, [mainTab, fetchSupplierSummary]);

  const handleCreate = async (storeId?: string) => {
    const targetStore = storeId || createStore;
    if (!targetStore) return alert("판매자를 선택하세요");
    setCreating(true);
    const payload: Record<string, unknown> = { store_id: targetStore, period: createPeriod, include_no_tracking: includeNoTracking };
    if (cutoffDate) payload.cutoff_date = cutoffDate;
    const res = await fetch("/admin/api/settlements/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) return alert(data.error || "정산 생성 실패");
    setPeriod(createPeriod);
    setFilterStore("");
    setShowCreateForm(false);
    fetchSettlements();
  };

  const handleCreateAll = async () => {
    if (!confirm("모든 활성 판매사의 정산서를 일괄 생성합니다. 진행하시겠습니까?")) return;
    setCreating(true);
    setCreateAllResult(null);
    const payload: Record<string, unknown> = { period: createPeriod, include_no_tracking: includeNoTracking };
    if (cutoffDate) payload.cutoff_date = cutoffDate;
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

  // ─── 판매사 정산 상세 뷰 ───
  if (detail) {
    const s = detail;
    const storeName = s.stores?.name || "판매자";
    const infPct = s.snap_influencer_rate ?? 70;
    const coPct = s.snap_company_rate ?? 30;
    const sType = s.snap_settlement_type || "사업자";

    return (
      <div className="p-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer text-lg">←</button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{storeName} 정산서</h1>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{s.settlement_no} · {s.period} · {sType} · {infPct}:{coPct} 분배</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => downloadSellerExcel(s, detailItems, productSummary)} className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer">Excel 다운로드</button>
            {s.status === "draft" && (
              <>
                <button onClick={() => changeStatus(s.id, "confirmed")} className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 cursor-pointer">확정</button>
                <button onClick={() => handleDelete(s.id)} className="px-3 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 cursor-pointer">삭제</button>
              </>
            )}
            {s.status === "confirmed" && (
              <button onClick={() => changeStatus(s.id, "paid")} className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer">지급완료</button>
            )}
          </div>
        </div>

        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          {(["summary", "orders", "products"] as const).map((t) => (
            <button key={t} onClick={() => setDetailTab(t)}
              className={`px-4 py-2 text-sm rounded-md cursor-pointer transition-colors ${detailTab === t ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
              {t === "summary" ? "정산요약" : t === "orders" ? `주문상세 (${detailItems.length})` : `상품별 (${productSummary.length})`}
            </button>
          ))}
        </div>

        {detailTab === "summary" && (
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">매출</h3>
              <div className="space-y-3">
                <Row label="자사몰 매출" value={s.cafe24_sales} />
                {s.phone_sales > 0 && <Row label="전화주문 매출" value={s.phone_sales} />}
                {s.refund_amount !== 0 && <Row label="환불/반품" value={s.refund_amount} negative />}
                <Row label="순매출" value={s.total_sales} bold highlight />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">비용</h3>
              <div className="space-y-3">
                <Row label={`PG수수료 (${s.snap_pg_fee_rate}%)`} value={s.pg_fee} />
                {s.cogs_exempt > 0 ? (<><Row label="제품원가 (과세)" value={s.cogs_taxable} /><Row label="제품원가 (면세)" value={s.cogs_exempt} /><Row label="  면세 VAT 10%" value={s.cogs_exempt_vat} sub /></>) : (<Row label="제품원가" value={s.total_cogs} />)}
                {s.ship_exempt > 0 ? (<><Row label="배송비 (과세)" value={s.ship_taxable} /><Row label="배송비 (면세)" value={s.ship_exempt} /><Row label="  면세 VAT 10%" value={s.ship_exempt_vat} sub /></>) : (<Row label="배송비" value={s.total_shipping} />)}
                {s.tpl_cost > 0 && <Row label="3PL 물류비" value={s.tpl_cost} />}
                {s.other_cost > 0 && <Row label="기타비용" value={s.other_cost} />}
                {s.vat_amount > 0 && <Row label="부가세 (10%)" value={s.vat_amount} />}
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
              <h3 className="text-sm font-semibold text-gray-900 mb-4">수익 분배 ({infPct}:{coPct})</h3>
              <div className="space-y-3">
                <Row label={`${storeName} 정산금 (${infPct}%)`} value={s.influencer_amount} bold />
                {sType === "프리랜서" && s.withholding_tax > 0 && (<><Row label="  원천세 (3.3%)" value={-s.withholding_tax} sub /><Row label={`  ${storeName} 실지급액`} value={s.influencer_actual} bold highlight /></>)}
                <Row label={`신산애널리틱스 (${coPct}%)`} value={s.company_amount} />
              </div>
            </div>
          </div>
        )}

        {detailTab === "orders" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  {["구분", "주문번호", "주문일", "상품명", "옵션", "수량", "단가", "정산매출", "공급가", "공급배송비", "과세", "공급사"].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-medium text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detailItems.map((item) => (
                  <tr key={item.id} className={`border-b border-gray-50 ${item.item_type !== "매출" ? "bg-red-50/30" : ""}`}>
                    <td className="px-3 py-2.5"><span className={`text-xs font-medium px-1.5 py-0.5 rounded ${item.item_type === "매출" ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-600"}`}>{item.item_type}</span></td>
                    <td className="px-3 py-2.5 text-xs font-mono text-gray-600 whitespace-nowrap">{item.cafe24_order_id}</td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{(item.order_date || "").slice(0, 10)}</td>
                    <td className="px-3 py-2.5 text-gray-900 max-w-[200px] truncate">{item.product_name}</td>
                    <td className="px-3 py-2.5 text-gray-500 max-w-[120px] truncate">{item.option_text || "-"}</td>
                    <td className="px-3 py-2.5 text-right">{item.quantity}</td>
                    <td className="px-3 py-2.5 text-right">{W(item.product_price)}</td>
                    <td className="px-3 py-2.5 text-right font-medium bg-yellow-50">{W(item.settled_amount)}</td>
                    <td className="px-3 py-2.5 text-right">{W(item.supply_total)}</td>
                    <td className="px-3 py-2.5 text-right">{W(item.supply_shipping)}</td>
                    <td className="px-3 py-2.5"><span className={`text-xs ${item.tax_type === "면세" ? "text-pink-600" : "text-gray-400"}`}>{item.tax_type}</span></td>
                    <td className="px-3 py-2.5 text-gray-500">{item.supplier_name || "-"}</td>
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
                  {["상품명", "판매수량", "매출", "매입가합계", "배송비합계", "이익", "마진율"].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productSummary.map((p) => (
                  <tr key={p.product_name} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-gray-900 max-w-[300px] truncate">{p.product_name}</td>
                    <td className="px-4 py-3 text-right">{p.quantity}</td>
                    <td className="px-4 py-3 text-right font-medium">{W(p.sales)}</td>
                    <td className="px-4 py-3 text-right">{W(p.cogs)}</td>
                    <td className="px-4 py-3 text-right">{W(p.shipping)}</td>
                    <td className="px-4 py-3 text-right font-medium">{W(p.profit)}</td>
                    <td className="px-4 py-3 text-right"><span className={p.margin >= 30 ? "text-green-600" : p.margin >= 15 ? "text-gray-700" : "text-red-600"}>{p.margin}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ─── 통계 ───
  const totalSales = settlements.reduce((s, v) => s + v.total_sales, 0);
  const totalProfit = settlements.reduce((s, v) => s + v.net_profit, 0);
  const totalInfluencer = settlements.reduce((s, v) => s + v.influencer_actual, 0);
  const draftCount = settlements.filter((s) => s.status === "draft").length;
  const supTotalAmount = supplierData.reduce((a, b) => a + b.total_amount, 0);
  const supTotalSales = supplierData.reduce((a, b) => a + b.total_sales, 0);

  // ─── 목록 뷰 ───
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">정산관리</h1>
          <p className="text-sm text-gray-500 mt-1">판매자/공급사별 월간 정산을 생성하고 관리합니다.</p>
        </div>
      </div>

      {/* ─── 메인 탭: 판매사 정산 / 공급사 정산 ─── */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => setMainTab("seller")}
          className={`px-5 py-2.5 text-sm rounded-md cursor-pointer transition-colors ${mainTab === "seller" ? "bg-white shadow-sm font-semibold text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
          판매사 정산
        </button>
        <button onClick={() => setMainTab("supplier")}
          className={`px-5 py-2.5 text-sm rounded-md cursor-pointer transition-colors ${mainTab === "supplier" ? "bg-white shadow-sm font-semibold text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
          공급사 정산
        </button>
      </div>

      {/* ═══ 판매사 정산 탭 ═══ */}
      {mainTab === "seller" && (
        <>
          {/* 정산 생성 */}
          <div className="bg-white rounded-xl border border-gray-200 mb-6">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 cursor-pointer" onClick={() => setShowCreateForm(!showCreateForm)}>
              <h3 className="text-sm font-semibold text-gray-900">정산서 생성</h3>
              <span className="text-xs text-gray-400">{showCreateForm ? "접기 ▲" : "펼치기 ▼"}</span>
            </div>
            {showCreateForm && (
              <div className="p-5 space-y-4">
                {/* 기간 */}
                <div className="flex gap-4 items-end">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">정산 기간</label>
                    <select value={createPeriod} onChange={(e) => setCreatePeriod(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      {periodOptions().map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">판매자 (개별 생성 시)</label>
                    <select value={createStore} onChange={(e) => setCreateStore(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]">
                      <option value="">전체</option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* 옵션 */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-700">송장미등록건 (주문+CS) 정산포함 여부:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="noTracking" checked={includeNoTracking} onChange={() => setIncludeNoTracking(true)} className="accent-[#C41E1E]" />
                      <span className="text-sm">포함(기본값)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="noTracking" checked={!includeNoTracking} onChange={() => setIncludeNoTracking(false)} className="accent-[#C41E1E]" />
                      <span className="text-sm">미포함</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-700">정산 기준일:</span>
                    <input type="date" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="YYYY-MM-DD" />
                    <span className="text-xs text-gray-400">비워두면 기간 말일까지 전체 포함</span>
                  </div>
                  {cutoffDate && (
                    <p className="text-xs text-orange-600">기준일 {cutoffDate} 이전 주문만 정산에 포함됩니다.</p>
                  )}
                </div>

                {/* 버튼 */}
                <div className="flex gap-3 items-center">
                  <button onClick={() => handleCreate()} disabled={creating || !createStore} className="px-5 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer">
                    {creating ? "계산 중..." : "정산서 만들기"}
                  </button>
                  <button onClick={handleCreateAll} disabled={creating} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                    {creating ? "생성 중..." : "전체 판매사 일괄 생성"}
                  </button>
                  <button onClick={() => setShowCreateForm(false)} className="px-4 py-2.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
                </div>

                <p className="text-xs text-gray-400">해당 기간의 주문 데이터를 기반으로 자동 계산합니다. 기존 임시 정산이 있으면 덮어씁니다.</p>

                {/* 전체 생성 결과 */}
                {createAllResult && (
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-blue-900 mb-2">
                      일괄 생성 완료: {createAllResult.created}건 생성 / {createAllResult.skipped}건 스킵 / {createAllResult.errors}건 오류
                    </p>
                    <div className="space-y-1">
                      {createAllResult.results.map((r, i) => (
                        <div key={i} className="text-xs flex gap-2">
                          <span className={r.status === "created" ? "text-green-600" : r.status === "skipped" ? "text-gray-400" : "text-red-600"}>
                            {r.status === "created" ? "✓" : r.status === "skipped" ? "−" : "✗"}
                          </span>
                          <span className="text-gray-700">{r.store_name}</span>
                          {r.error && <span className="text-gray-400">({r.error})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 mb-4">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">전체 기간</option>
              {periodOptions().map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">전체 판매자</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: "총 순매출", value: W(totalSales) },
              { label: "총 순익", value: W(totalProfit) },
              { label: "인플루언서 실지급", value: W(totalInfluencer) },
              { label: "미확정 건수", value: `${draftCount}건` },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{c.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200">
            {loading ? (
              <div className="p-12 text-center text-gray-400">불러오는 중...</div>
            ) : settlements.length === 0 ? (
              <div className="p-12 text-center text-gray-400">해당 기간에 정산서가 없습니다.</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-6 py-3 font-medium">정산번호</th>
                    <th className="text-left px-3 py-3 font-medium">판매자</th>
                    <th className="text-left px-3 py-3 font-medium">기간</th>
                    <th className="text-right px-3 py-3 font-medium">순매출</th>
                    <th className="text-right px-3 py-3 font-medium">총비용</th>
                    <th className="text-right px-3 py-3 font-medium">순익</th>
                    <th className="text-right px-3 py-3 font-medium">인플루언서</th>
                    <th className="text-right px-3 py-3 font-medium">회사</th>
                    <th className="text-center px-3 py-3 font-medium">상태</th>
                    <th className="text-center px-6 py-3 font-medium">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-6 py-3.5"><code className="text-xs font-mono text-gray-600">{s.settlement_no}</code></td>
                      <td className="px-3 py-3.5 text-sm font-medium text-gray-900">{s.stores?.name || "-"}</td>
                      <td className="px-3 py-3.5 text-sm text-gray-500">{s.period}</td>
                      <td className="px-3 py-3.5 text-sm text-gray-700 text-right">{W(s.total_sales)}</td>
                      <td className="px-3 py-3.5 text-sm text-gray-500 text-right">{W(s.total_cost)}</td>
                      <td className="px-3 py-3.5 text-sm font-medium text-right" style={{ color: s.net_profit >= 0 ? "#059669" : "#DC2626" }}>{W(s.net_profit)}</td>
                      <td className="px-3 py-3.5 text-sm text-blue-600 text-right">{W(s.influencer_actual)}</td>
                      <td className="px-3 py-3.5 text-sm text-gray-500 text-right">{W(s.company_amount)}</td>
                      <td className="px-3 py-3.5 text-center"><span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span></td>
                      <td className="px-6 py-3.5 text-center"><button onClick={() => openDetail(s)} className="text-xs text-[#C41E1E] hover:underline cursor-pointer font-medium">상세</button></td>
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
          <div className="flex gap-3 items-center mb-4">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              {periodOptions().map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {supplierData.length > 0 && (
              <button onClick={() => downloadSupplierExcel(supplierData, period)} className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer">
                Excel 다운로드
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: "공급사 수", value: `${supplierData.length}개` },
              { label: "공급가+배송비 합계", value: W(supTotalAmount) },
              { label: "판매금액 합계", value: W(supTotalSales) },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{c.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200">
            {supLoading ? (
              <div className="p-12 text-center text-gray-400">불러오는 중...</div>
            ) : supplierData.length === 0 ? (
              <div className="p-12 text-center text-gray-400">해당 기간에 공급사 정산 데이터가 없습니다. 판매사 정산을 먼저 생성하세요.</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-6 py-3 font-medium">공급사</th>
                    <th className="text-right px-3 py-3 font-medium">건수</th>
                    <th className="text-right px-3 py-3 font-medium">수량</th>
                    <th className="text-right px-3 py-3 font-medium">공급가 합계</th>
                    <th className="text-right px-3 py-3 font-medium">배송비 합계</th>
                    <th className="text-right px-3 py-3 font-medium">지급 총액</th>
                    <th className="text-right px-3 py-3 font-medium">판매금액</th>
                    <th className="text-center px-6 py-3 font-medium">상세</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierData.map((sup) => (
                    <>
                      <tr key={sup.supplier_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-6 py-3.5 text-sm font-medium text-gray-900">{sup.supplier_name}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-700 text-right">{sup.item_count}건</td>
                        <td className="px-3 py-3.5 text-sm text-gray-700 text-right">{sup.total_quantity}개</td>
                        <td className="px-3 py-3.5 text-sm text-gray-700 text-right">{W(sup.total_supply)}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-700 text-right">{W(sup.total_shipping)}</td>
                        <td className="px-3 py-3.5 text-sm font-semibold text-right text-blue-600">{W(sup.total_amount)}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-500 text-right">{W(sup.total_sales)}</td>
                        <td className="px-6 py-3.5 text-center">
                          <button onClick={() => setExpandedSup(expandedSup === sup.supplier_id ? null : sup.supplier_id)} className="text-xs text-[#C41E1E] hover:underline cursor-pointer font-medium">
                            {expandedSup === sup.supplier_id ? "접기" : "펼치기"}
                          </button>
                        </td>
                      </tr>
                      {expandedSup === sup.supplier_id && sup.products.map((p) => (
                        <tr key={`${sup.supplier_id}-${p.name}`} className="bg-gray-50/50 border-b border-gray-50">
                          <td className="px-6 py-2.5 pl-12 text-xs text-gray-600">{p.name}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 text-right"></td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 text-right">{p.qty}개</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 text-right">{W(p.supply)}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 text-right">{W(p.shipping)}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 text-right">{W(p.supply + p.shipping)}</td>
                          <td className="px-3 py-2.5"></td>
                          <td className="px-6 py-2.5"></td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, bold, highlight, sub, negative, isText }: {
  label: string; value: number | string; bold?: boolean; highlight?: boolean; sub?: boolean; negative?: boolean; isText?: boolean;
}) {
  const formatted = isText ? String(value) : W(Number(value));
  return (
    <div className={`flex justify-between items-center py-1.5 ${highlight ? "bg-blue-50/50 -mx-2 px-2 rounded" : ""}`}>
      <span className={`text-sm ${sub ? "text-gray-400 pl-2" : bold ? "font-semibold text-gray-900" : "text-gray-600"}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? "font-semibold text-gray-900" : "text-gray-700"} ${negative ? "text-red-600" : ""}`}>{formatted}</span>
    </div>
  );
}
