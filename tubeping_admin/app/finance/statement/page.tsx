"use client";

import { useEffect, useMemo, useState } from "react";
import "../_components/shinsan-fin.css";
import { CLASSIFY_OPTIONS } from "@/lib/finance/accounts";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("ko-KR"));

interface TreeNode { code: string; label: string; side: "in" | "out" | "both"; depth: 0 | 1 | 2; amount: number; count: number; self_amount: number }
interface UnclassifiedRow { id: number; table: "fin_bank_in" | "fin_bank_out" | "fin_card_tx"; side: "in" | "out"; date: string; partner: string | null; descr: string | null; memo: string | null; amount: number; current_code: string; auto: boolean }
interface Statement {
  period: { year: number; month: string | null; exclude_eum: boolean };
  kpi: { sales: number; cogs: number; selling: number; ga: number; tax: number; eumlogics: number; nonop: number; op_profit: number };
  tree: TreeNode[];
  unclassified: UnclassifiedRow[];
  sources: { bank_in: number; bank_out: number; card_tx: number; settlements: number; supplier_settlements: number };
}

export default function StatementPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<string>("");
  const [excludeEum, setExcludeEum] = useState(true);
  const [tab, setTab] = useState<"statement" | "unclassified">("statement");
  const [data, setData] = useState<Statement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});

  const load = () => {
    setData(null); setErr(null);
    const qs = new URLSearchParams({ year: String(year), exclude_eum: String(excludeEum) });
    if (month) qs.set("month", month);
    fetch(`/admin/api/finance/statement?${qs}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year, month, excludeEum]);

  const monthOptions = useMemo(() => {
    const arr = [{ v: "", l: "전체" }];
    for (let m = 1; m <= 12; m++) arr.push({ v: String(m).padStart(2, "0"), l: `${m}월` });
    return arr;
  }, []);

  async function classify(row: UnclassifiedRow, code: string) {
    const key = `${row.table}:${row.id}`;
    setSavingIds((s) => ({ ...s, [key]: true }));
    try {
      const res = await fetch("/admin/api/finance/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: row.table, id: row.id, code }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      // 로컬 상태에서 해당 row 제거 (서버 재조회 안 함)
      setData((d) => d ? { ...d, unclassified: d.unclassified.filter((u) => !(u.table === row.table && u.id === row.id)) } : d);
    } catch (e) {
      alert("분류 저장 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingIds((s) => { const n = { ...s }; delete n[key]; return n; });
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">손익계산서 (Statement)</h1>
        <p className="text-sm text-gray-500 mt-0.5">표준 재무제표 항목으로 자동분류 + 미분류는 수동 분류 · 매출원가/PG/3PL/인플루언서는 정산 데이터 합산</p>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="shinsan-fin">
          <div className="filter-bar" style={{ flexWrap: "wrap", gap: 8 }}>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="form-input" style={{ width: 110 }}>
              {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="form-input" style={{ width: 90 }}>
              {monthOptions.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-sub)", padding: "0 10px", cursor: "pointer" }}>
              <input type="checkbox" checked={excludeEum} onChange={(e) => setExcludeEum(e.target.checked)} />
              이음로직스 제외 (운영 자금 흐름만)
            </label>
            <button className="btn" onClick={load}>새로고침</button>
          </div>

          {err && <div className="empty-state" style={{ color: "var(--red)" }}>불러오기 실패: {err}</div>}
          {!data && !err && <div className="empty-state">집계 중…</div>}

          {data && (
            <>
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">매출</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--primary)" }}>{fmt(data.kpi.sales)}</div></div>
                <div className="kpi-card"><div className="kpi-label">매출원가 + 판매비</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--danger)" }}>{fmt(data.kpi.cogs + data.kpi.selling)}</div><div className="kpi-sub">원가 {fmt(data.kpi.cogs)} · 판매비 {fmt(data.kpi.selling)}</div></div>
                <div className="kpi-card"><div className="kpi-label">일반관리비 + 세금</div><div className="kpi-value" style={{ fontSize: 20, color: "#b45309" }}>{fmt(data.kpi.ga + data.kpi.tax)}</div><div className="kpi-sub">관리비 {fmt(data.kpi.ga)} · 세금 {fmt(data.kpi.tax)}</div></div>
                <div className="kpi-card"><div className="kpi-label">영업이익</div><div className="kpi-value" style={{ fontSize: 22, color: data.kpi.op_profit >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(data.kpi.op_profit)}</div><div className="kpi-sub">매출 − 원가 − 판매비 − 관리비 − 세금</div></div>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                <button className={`btn ${tab === "statement" ? "btn-primary" : ""}`} onClick={() => setTab("statement")}>손익계산서</button>
                <button className={`btn ${tab === "unclassified" ? "btn-primary" : ""}`} onClick={() => setTab("unclassified")}>미분류 ({data.unclassified.length})</button>
              </div>

              {tab === "statement" && (
                <div className="panel">
                  <div className="panel-header">
                    <span>{data.period.year}년{data.period.month ? ` ${data.period.month}월` : ""} 손익계산서 {data.period.exclude_eum ? <span style={{ fontSize: 12, color: "var(--text-sub)", marginLeft: 8 }}>· 이음로직스 제외</span> : null}</span>
                    <span style={{ fontSize: 11, color: "var(--text-sub)" }}>출처: bank_in {data.sources.bank_in} · bank_out {data.sources.bank_out} · card {data.sources.card_tx} · 정산 {data.sources.settlements}+{data.sources.supplier_settlements}</span>
                  </div>
                  <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr><th style={{ width: "60%" }}>항목</th><th className="tar" style={{ width: 100 }}>건수</th><th className="tar" style={{ width: 160 }}>금액</th></tr>
                      </thead>
                      <tbody>
                        {data.tree.map((node) => {
                          const indent = node.depth * 20;
                          const isRoot = node.depth === 0;
                          const isSub = node.depth === 1;
                          const rowStyle: React.CSSProperties = isRoot
                            ? { background: "var(--gray-50)", borderTop: "2px solid var(--border)", fontWeight: 800 }
                            : isSub
                            ? { fontWeight: 600 }
                            : {};
                          const sideColor = node.side === "in" ? "var(--primary)" : node.side === "out" ? "var(--danger)" : "var(--text-main)";
                          const amountColor = node.amount === 0 ? "var(--gray-300)" : isRoot ? sideColor : node.side === "in" ? "var(--text-main)" : "var(--text-main)";
                          return (
                            <tr key={node.code} style={rowStyle}>
                              <td style={{ paddingLeft: 12 + indent }}>
                                {node.depth === 2 ? "└ " : ""}{node.label}
                                <span style={{ marginLeft: 8, fontSize: 10, color: "var(--gray-400)", fontFamily: "monospace" }}>{node.code}</span>
                              </td>
                              <td className="tar" style={{ color: node.count ? "var(--text-sub)" : "var(--gray-300)", fontSize: 11 }}>{node.count || "-"}</td>
                              <td className="tar" style={{ color: amountColor, fontWeight: isRoot ? 800 : isSub ? 700 : 500 }}>{node.amount === 0 ? "-" : fmt(node.amount)}</td>
                            </tr>
                          );
                        })}
                        <tr style={{ background: "var(--primary-bg)", fontWeight: 800, borderTop: "3px double var(--border)" }}>
                          <td style={{ padding: "12px 12px", fontSize: 14 }}>영업이익 (매출 − 원가 − 판매비 − 관리비 − 세금)</td>
                          <td></td>
                          <td className="tar" style={{ fontSize: 16, color: data.kpi.op_profit >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(data.kpi.op_profit)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tab === "unclassified" && (
                <div className="panel">
                  <div className="panel-header">
                    <span>미분류 거래 ({data.unclassified.length}건)</span>
                    <span style={{ fontSize: 11, color: "var(--text-sub)" }}>dropdown 으로 표준 항목 선택 → 자동 저장</span>
                  </div>
                  <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr><th>일자</th><th>구분</th><th>거래처/적요</th><th className="tar">금액</th><th>현재 분류</th><th style={{ width: 260 }}>표준 항목 선택</th></tr>
                      </thead>
                      <tbody>
                        {data.unclassified.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 30, color: "var(--text-sub)" }}>미분류 거래 없음</td></tr>}
                        {data.unclassified.map((r) => {
                          const key = `${r.table}:${r.id}`;
                          const saving = savingIds[key];
                          return (
                            <tr key={key}>
                              <td>{r.date}</td>
                              <td><span className={`badge ${r.side === "in" ? "badge-green" : "badge-red"}`}>{r.side === "in" ? "입금" : "출금"}</span></td>
                              <td>
                                <div style={{ fontWeight: 600 }}>{r.partner || "(미지정)"}</div>
                                <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{r.descr || ""}{r.memo ? ` · ${r.memo}` : ""}</div>
                              </td>
                              <td className="tar" style={{ fontWeight: 700, color: r.side === "in" ? "var(--green)" : "var(--red)" }}>{fmt(r.amount)}</td>
                              <td style={{ fontSize: 11, color: "var(--text-sub)", fontFamily: "monospace" }}>{r.current_code}{r.auto ? " (자동)" : ""}</td>
                              <td>
                                <select
                                  className="form-input"
                                  disabled={saving}
                                  defaultValue=""
                                  onChange={(e) => { if (e.target.value) classify(r, e.target.value); }}
                                  style={{ width: "100%" }}
                                >
                                  <option value="">— 선택 —</option>
                                  {CLASSIFY_OPTIONS.filter((o) => o.side === "both" || o.side === r.side).map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
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
