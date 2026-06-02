"use client";

import { useEffect, useMemo, useState } from "react";
import "../_components/shinsan-fin.css";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("ko-KR"));

interface Row { date: string; type: "in" | "out"; partner: string | null; amount: number; balance: number | null; category: string | null; descr: string | null; memo: string | null }
interface CatRow { category: string; in: number; out: number; net: number; count: number }
interface MonthRow { month: string; in: number; out: number; net: number }
interface ApiResp {
  summary: { year: number; month: string | null; total_in: number; total_out: number; net: number; count: number; count_in: number; count_out: number; latest_balance: number | null };
  rows: Row[]; byCategory: CatRow[]; byMonth: MonthRow[]; categories: string[];
}

type Tab = "ledger" | "byCategory" | "byMonth";

export default function CashbookPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<string>(""); // "" = 전체
  const [typeF, setTypeF] = useState<"" | "in" | "out">("");
  const [category, setCategory] = useState<string>("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ledger");

  useEffect(() => {
    setData(null); setErr(null);
    const qs = new URLSearchParams({ year: String(year) });
    if (month) qs.set("month", month);
    if (typeF) qs.set("type", typeF);
    if (category) qs.set("category", category);
    if (q) qs.set("q", q);
    const t = setTimeout(() => {
      fetch(`/admin/api/finance/cashbook?${qs}`)
        .then((r) => r.json())
        .then((d) => (d.error ? setErr(d.error) : setData(d)))
        .catch((e) => setErr(String(e)));
    }, q ? 250 : 0); // 검색어 입력 시 디바운스
    return () => clearTimeout(t);
  }, [year, month, typeF, category, q]);

  const monthOptions = useMemo(() => {
    const arr = [{ v: "", l: "전체" }];
    for (let m = 1; m <= 12; m++) arr.push({ v: String(m).padStart(2, "0"), l: `${m}월` });
    return arr;
  }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">입출금 원장</h1>
        <p className="text-sm text-gray-500 mt-0.5">은행 입금/출금 통합 원장 · 카테고리·월별 집계</p>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="shinsan-fin">
          {/* 필터 바 */}
          <div className="filter-bar" style={{ flexWrap: "wrap", gap: 8 }}>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="form-input" style={{ width: 110 }}>
              {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="form-input" style={{ width: 90 }}>
              {monthOptions.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
            <select value={typeF} onChange={(e) => setTypeF(e.target.value as "" | "in" | "out")} className="form-input" style={{ width: 110 }}>
              <option value="">입금+출금</option>
              <option value="in">입금만</option>
              <option value="out">출금만</option>
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="form-input" style={{ width: 160 }}>
              <option value="">전체 카테고리</option>
              {(data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="form-input" placeholder="거래처/적요/메모 검색…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          </div>

          {err && <div className="empty-state" style={{ color: "var(--red)" }}>불러오기 실패: {err}</div>}
          {!data && !err && <div className="empty-state">집계 중…</div>}

          {data && (
            <>
              {/* KPI */}
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">총 입금</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--green)" }}>{fmt(data.summary.total_in)}</div><div className="kpi-sub">{data.summary.count_in}건</div></div>
                <div className="kpi-card"><div className="kpi-label">총 출금</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--red)" }}>{fmt(data.summary.total_out)}</div><div className="kpi-sub">{data.summary.count_out}건</div></div>
                <div className="kpi-card"><div className="kpi-label">순 현금흐름</div><div className="kpi-value" style={{ fontSize: 20, color: data.summary.net >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(data.summary.net)}</div><div className="kpi-sub">{data.summary.count}건</div></div>
                <div className="kpi-card"><div className="kpi-label">최근 통장 잔액</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--blue)" }}>{fmt(data.summary.latest_balance)}</div><div className="kpi-sub">필터 범위 내 마지막 거래 기준</div></div>
              </div>

              {/* 탭 */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {([["ledger", `원장 (${data.rows.length})`], ["byCategory", `카테고리별 (${data.byCategory.length})`], ["byMonth", `월별 (${data.byMonth.length})`]] as [Tab, string][]).map(([t, label]) => (
                  <button key={t} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>{label}</button>
                ))}
              </div>

              {tab === "ledger" && (
                <div className="panel">
                  <div className="panel-header"><span>거래 원장 (오름차순 · 최대 1,000건 표시)</span></div>
                  <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                    <table>
                      <thead><tr><th>일자</th><th>구분</th><th>거래처</th><th>적요 / 카테고리</th><th className="tar">입금</th><th className="tar">출금</th><th className="tar">잔액</th></tr></thead>
                      <tbody>
                        {data.rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 30, color: "var(--text-sub)" }}>해당 조건의 거래 없음</td></tr>}
                        {data.rows.slice(0, 1000).map((r, i) => (
                          <tr key={i}>
                            <td>{r.date}</td>
                            <td><span className={`badge ${r.type === "in" ? "badge-green" : "badge-red"}`}>{r.type === "in" ? "입금" : "출금"}</span></td>
                            <td style={{ fontWeight: 600 }}>{r.partner || "(미지정)"}</td>
                            <td style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.descr || ""}{r.category ? <span style={{ marginLeft: 6, padding: "1px 6px", background: "var(--gray-100)", borderRadius: 3 }}>{r.category}</span> : null}</td>
                            <td className="tar" style={{ color: r.type === "in" ? "var(--green)" : "var(--text-sub)", fontWeight: r.type === "in" ? 700 : 400 }}>{r.type === "in" ? fmt(r.amount) : "-"}</td>
                            <td className="tar" style={{ color: r.type === "out" ? "var(--red)" : "var(--text-sub)", fontWeight: r.type === "out" ? 700 : 400 }}>{r.type === "out" ? fmt(r.amount) : "-"}</td>
                            <td className="tar" style={{ fontWeight: 600, color: "var(--blue)" }}>{fmt(r.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.rows.length > 1000 && (
                      <div style={{ padding: 12, textAlign: "center", color: "var(--text-sub)", fontSize: 12 }}>
                        … 총 {data.rows.length}건 중 1,000건 표시. 필터를 좁혀주세요.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === "byCategory" && (
                <div className="panel">
                  <div className="panel-header"><span>카테고리별 집계</span></div>
                  <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                    <table>
                      <thead><tr><th>카테고리</th><th className="tar">건수</th><th className="tar">입금</th><th className="tar">출금</th><th className="tar">순</th></tr></thead>
                      <tbody>
                        {data.byCategory.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--text-sub)" }}>데이터 없음</td></tr>}
                        {data.byCategory.map((c) => (
                          <tr key={c.category}>
                            <td style={{ fontWeight: 600 }}>{c.category}</td>
                            <td className="tar">{c.count}건</td>
                            <td className="tar" style={{ color: "var(--green)" }}>{fmt(c.in)}</td>
                            <td className="tar" style={{ color: "var(--red)" }}>{fmt(c.out)}</td>
                            <td className="tar" style={{ fontWeight: 700, color: c.net >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(c.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tab === "byMonth" && (
                <div className="panel">
                  <div className="panel-header"><span>월별 집계</span></div>
                  <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                    <table>
                      <thead><tr><th>월</th><th className="tar">입금</th><th className="tar">출금</th><th className="tar">순</th></tr></thead>
                      <tbody>
                        {data.byMonth.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 30, color: "var(--text-sub)" }}>데이터 없음</td></tr>}
                        {data.byMonth.map((m) => (
                          <tr key={m.month}>
                            <td style={{ fontWeight: 600 }}>{m.month}</td>
                            <td className="tar" style={{ color: "var(--green)" }}>{fmt(m.in)}</td>
                            <td className="tar" style={{ color: "var(--red)" }}>{fmt(m.out)}</td>
                            <td className="tar" style={{ fontWeight: 700, color: m.net >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(m.net)}</td>
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
