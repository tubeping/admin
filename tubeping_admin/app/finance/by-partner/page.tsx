"use client";

import { useEffect, useMemo, useState } from "react";
import "../_components/shinsan-fin.css";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("ko-KR"));

type StoreMetric = "total_sales" | "total_cost" | "net_profit" | "company_amount" | "influencer_amount";
type SupplierMetric = "total_supply" | "total_shipping" | "total_amount" | "total_sales" | "item_count";

interface StoreRow {
  id: string; name: string; settlement_type: string | null;
  by_month: Record<string, Record<StoreMetric, number>>;
  total: Record<StoreMetric, number>;
}
interface SupplierRow {
  id: string | null; name: string;
  by_month: Record<string, Record<SupplierMetric, number>>;
  total: Record<SupplierMetric, number>;
}
interface ApiResp {
  year: number; months: string[];
  stores: StoreRow[]; suppliers: SupplierRow[];
  summary: { sales_total: number; cost_total: number; net_total: number; company_total: number; influencer_total: number; supplier_amount_total: number; supplier_supply_total: number; store_count: number; supplier_count: number };
  monthly_summary: { month: string; sales: number; cost: number; net: number; company: number; influencer: number; supplier_amount: number }[];
}

const STORE_METRICS: { v: StoreMetric; l: string; color: string }[] = [
  { v: "total_sales", l: "매출", color: "var(--primary)" },
  { v: "total_cost", l: "비용", color: "var(--danger)" },
  { v: "net_profit", l: "순익", color: "var(--success)" },
  { v: "company_amount", l: "회사 정산금", color: "var(--blue)" },
  { v: "influencer_amount", l: "인플루언서 정산금", color: "#b45309" },
];
const SUPPLIER_METRICS: { v: SupplierMetric; l: string; color: string }[] = [
  { v: "total_amount", l: "정산 합계", color: "var(--danger)" },
  { v: "total_supply", l: "공급가", color: "var(--text-main)" },
  { v: "total_shipping", l: "배송비", color: "var(--text-sub)" },
  { v: "total_sales", l: "정산 매출(원가기준)", color: "var(--primary)" },
  { v: "item_count", l: "건수", color: "var(--text-main)" },
];

export default function ByPartnerPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"stores" | "suppliers" | "summary">("stores");
  const [storeMetric, setStoreMetric] = useState<StoreMetric>("net_profit");
  const [supplierMetric, setSupplierMetric] = useState<SupplierMetric>("total_amount");
  const [q, setQ] = useState("");

  useEffect(() => {
    setData(null); setErr(null);
    fetch(`/admin/api/finance/by-partner?year=${year}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, [year]);

  const filteredStores = useMemo(() => {
    if (!data) return [];
    const qq = q.toLowerCase();
    return data.stores.filter((s) => !qq || s.name.toLowerCase().includes(qq));
  }, [data, q]);
  const filteredSuppliers = useMemo(() => {
    if (!data) return [];
    const qq = q.toLowerCase();
    return data.suppliers.filter((s) => !qq || s.name.toLowerCase().includes(qq));
  }, [data, q]);

  const monthTotalsStore = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const m: Record<string, number> = {};
    for (const mo of data.months) m[mo] = filteredStores.reduce((t, s) => t + (s.by_month[mo]?.[storeMetric] || 0), 0);
    return m;
  }, [data, filteredStores, storeMetric]);
  const monthTotalsSupplier = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const m: Record<string, number> = {};
    for (const mo of data.months) m[mo] = filteredSuppliers.reduce((t, s) => t + (s.by_month[mo]?.[supplierMetric] || 0), 0);
    return m;
  }, [data, filteredSuppliers, supplierMetric]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">거래처별 손익 (피벗)</h1>
        <p className="text-sm text-gray-500 mt-0.5">정산 자료 기준 · 판매사(settlements) + 공급사(supplier_settlements)</p>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="shinsan-fin">
          <div className="filter-bar" style={{ flexWrap: "wrap", gap: 8 }}>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="form-input" style={{ width: 110 }}>
              {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <input className="form-input" placeholder="거래처 검색…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          </div>

          {err && <div className="empty-state" style={{ color: "var(--red)" }}>불러오기 실패: {err}</div>}
          {!data && !err && <div className="empty-state">집계 중…</div>}

          {data && (
            <>
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">{year} 총매출 (판매사)</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--primary)" }}>{fmt(data.summary.sales_total)}</div><div className="kpi-sub">판매사 {data.summary.store_count}개</div></div>
                <div className="kpi-card"><div className="kpi-label">{year} 회사 순익</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--success)" }}>{fmt(data.summary.net_total)}</div><div className="kpi-sub">회사 정산금 {fmt(data.summary.company_total)}</div></div>
                <div className="kpi-card"><div className="kpi-label">{year} 인플루언서 정산</div><div className="kpi-value" style={{ fontSize: 20, color: "#b45309" }}>{fmt(data.summary.influencer_total)}</div><div className="kpi-sub">총 비용 {fmt(data.summary.cost_total)}</div></div>
                <div className="kpi-card"><div className="kpi-label">{year} 공급사 매입</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--danger)" }}>{fmt(data.summary.supplier_amount_total)}</div><div className="kpi-sub">공급사 {data.summary.supplier_count}개</div></div>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {([["stores", `판매사 (${data.stores.length})`], ["suppliers", `공급사 (${data.suppliers.length})`], ["summary", "월별 종합"]] as [typeof tab, string][]).map(([t, label]) => (
                  <button key={t} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>{label}</button>
                ))}
              </div>

              {tab === "stores" && (
                <>
                  <div className="filter-bar" style={{ gap: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--text-sub)", marginRight: 8 }}>지표:</span>
                    {STORE_METRICS.map((m) => (
                      <button key={m.v} className={`btn btn-sm ${storeMetric === m.v ? "btn-primary" : ""}`} onClick={() => setStoreMetric(m.v)}>{m.l}</button>
                    ))}
                  </div>
                  <div className="panel">
                    <div className="panel-header"><span>판매사 × 월별 · {STORE_METRICS.find((m) => m.v === storeMetric)!.l}</span></div>
                    <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th style={{ position: "sticky", left: 0, background: "white", zIndex: 1 }}>판매사</th>
                            <th style={{ fontSize: 11 }}>유형</th>
                            {data.months.map((m) => <th key={m} className="tar" style={{ fontSize: 11 }}>{m.slice(5)}월</th>)}
                            <th className="tar">합계</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStores.length === 0 && <tr><td colSpan={data.months.length + 3} style={{ textAlign: "center", padding: 30, color: "var(--text-sub)" }}>데이터 없음</td></tr>}
                          {filteredStores.map((s) => (
                            <tr key={s.id}>
                              <td style={{ position: "sticky", left: 0, background: "white", fontWeight: 600, zIndex: 1 }}>{s.name}</td>
                              <td style={{ fontSize: 11, color: "var(--text-sub)" }}>{s.settlement_type || "-"}</td>
                              {data.months.map((m) => {
                                const v = s.by_month[m]?.[storeMetric] || 0;
                                return <td key={m} className="tar" style={{ color: v ? undefined : "var(--gray-300)" }}>{v ? fmt(v) : "-"}</td>;
                              })}
                              <td className="tar" style={{ fontWeight: 700, color: STORE_METRICS.find((mm) => mm.v === storeMetric)!.color }}>{fmt(s.total[storeMetric])}</td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 700, background: "var(--gray-50)", borderTop: "2px solid var(--border)" }}>
                            <td style={{ position: "sticky", left: 0, background: "var(--gray-50)", zIndex: 1 }}>합계</td>
                            <td></td>
                            {data.months.map((m) => <td key={m} className="tar">{fmt(monthTotalsStore[m])}</td>)}
                            <td className="tar" style={{ color: STORE_METRICS.find((mm) => mm.v === storeMetric)!.color }}>{fmt(filteredStores.reduce((t, s) => t + s.total[storeMetric], 0))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {tab === "suppliers" && (
                <>
                  <div className="filter-bar" style={{ gap: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--text-sub)", marginRight: 8 }}>지표:</span>
                    {SUPPLIER_METRICS.map((m) => (
                      <button key={m.v} className={`btn btn-sm ${supplierMetric === m.v ? "btn-primary" : ""}`} onClick={() => setSupplierMetric(m.v)}>{m.l}</button>
                    ))}
                  </div>
                  <div className="panel">
                    <div className="panel-header"><span>공급사 × 월별 · {SUPPLIER_METRICS.find((m) => m.v === supplierMetric)!.l}</span></div>
                    <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th style={{ position: "sticky", left: 0, background: "white", zIndex: 1 }}>공급사</th>
                            {data.months.map((m) => <th key={m} className="tar" style={{ fontSize: 11 }}>{m.slice(5)}월</th>)}
                            <th className="tar">합계</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSuppliers.length === 0 && <tr><td colSpan={data.months.length + 2} style={{ textAlign: "center", padding: 30, color: "var(--text-sub)" }}>데이터 없음</td></tr>}
                          {filteredSuppliers.map((s) => (
                            <tr key={s.id || s.name}>
                              <td style={{ position: "sticky", left: 0, background: "white", fontWeight: 600, zIndex: 1 }}>{s.name}</td>
                              {data.months.map((m) => {
                                const v = s.by_month[m]?.[supplierMetric] || 0;
                                return <td key={m} className="tar" style={{ color: v ? undefined : "var(--gray-300)" }}>{v ? fmt(v) : "-"}</td>;
                              })}
                              <td className="tar" style={{ fontWeight: 700, color: SUPPLIER_METRICS.find((mm) => mm.v === supplierMetric)!.color }}>{fmt(s.total[supplierMetric])}</td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 700, background: "var(--gray-50)", borderTop: "2px solid var(--border)" }}>
                            <td style={{ position: "sticky", left: 0, background: "var(--gray-50)", zIndex: 1 }}>합계</td>
                            {data.months.map((m) => <td key={m} className="tar">{fmt(monthTotalsSupplier[m])}</td>)}
                            <td className="tar" style={{ color: SUPPLIER_METRICS.find((mm) => mm.v === supplierMetric)!.color }}>{fmt(filteredSuppliers.reduce((t, s) => t + s.total[supplierMetric], 0))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {tab === "summary" && (
                <div className="panel">
                  <div className="panel-header"><span>월별 종합 (판매사 + 공급사)</span></div>
                  <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                    <table>
                      <thead><tr><th>월</th><th className="tar">매출</th><th className="tar">비용</th><th className="tar">순익</th><th className="tar">회사 정산</th><th className="tar">인플루언서 정산</th><th className="tar">공급사 매입</th></tr></thead>
                      <tbody>
                        {data.monthly_summary.map((m) => (
                          <tr key={m.month}>
                            <td style={{ fontWeight: 600 }}>{m.month}</td>
                            <td className="tar" style={{ color: m.sales ? "var(--primary)" : "var(--gray-300)" }}>{m.sales ? fmt(m.sales) : "-"}</td>
                            <td className="tar" style={{ color: m.cost ? "var(--danger)" : "var(--gray-300)" }}>{m.cost ? fmt(m.cost) : "-"}</td>
                            <td className="tar" style={{ fontWeight: 700, color: m.net >= 0 ? "var(--success)" : "var(--danger)" }}>{m.net ? fmt(m.net) : "-"}</td>
                            <td className="tar" style={{ color: m.company ? "var(--blue)" : "var(--gray-300)" }}>{m.company ? fmt(m.company) : "-"}</td>
                            <td className="tar" style={{ color: m.influencer ? "#b45309" : "var(--gray-300)" }}>{m.influencer ? fmt(m.influencer) : "-"}</td>
                            <td className="tar" style={{ color: m.supplier_amount ? "var(--danger)" : "var(--gray-300)" }}>{m.supplier_amount ? fmt(m.supplier_amount) : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
