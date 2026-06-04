"use client";

import { useEffect, useMemo, useState } from "react";
import "../_components/shinsan-fin.css";
import { CLASSIFY_OPTIONS } from "@/lib/finance/accounts";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("ko-KR"));
const pct = (n: number, base: number) => (base > 0 ? Math.round((Math.abs(n) / base) * 1000) / 10 : 0);

interface TreeNode { code: string; label: string; side: "in" | "out" | "both"; depth: 0 | 1 | 2; amount: number; count: number; self_amount: number }
interface UnclassifiedRow { id: number; table: "fin_bank_in" | "fin_bank_out" | "fin_card_tx"; side: "in" | "out"; date: string; partner: string | null; descr: string | null; memo: string | null; amount: number; current_code: string; auto: boolean; via: string }
interface Statement {
  period: { year: number; month: string | null; exclude_eum: boolean };
  kpi: { sales: number; cogs: number; selling: number; ga: number; tax: number; eumlogics: number; nonop: number; op_profit: number };
  tree: TreeNode[];
  unclassified: UnclassifiedRow[];
  classify_stats: Record<string, number | object> & {
    context: { supplier_names: number; store_names: number; bank_holders: number; fp_partners: number; fs_partners: number };
  };
  sources: { bank_in: number; bank_out: number; card_tx: number; settlements: number; supplier_settlements: number };
}

const VIA_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  user: { label: "사용자 분류", color: "#15803d", bg: "#dcfce7" },
  rule: { label: "키워드 룰", color: "#1d4ed8", bg: "#dbeafe" },
  공급사: { label: "공급사 매칭", color: "#9333ea", bg: "#f3e8ff" },
  판매사: { label: "판매사 매칭", color: "#0891b2", bg: "#cffafe" },
  인플루언서: { label: "인플루언서 매칭", color: "#b45309", bg: "#fef3c7" },
  세계매입: { label: "매입 세계 매칭", color: "#7c2d12", bg: "#fed7aa" },
  세계매출: { label: "매출 세계 매칭", color: "#0c4a6e", bg: "#bae6fd" },
  fallback: { label: "미분류 (수동)", color: "#991b1b", bg: "#fee2e2" },
};

// 4개 섹션 정의 (depth 0 그룹들을 비즈니스 의미로 묶음)
const SECTIONS = [
  { key: "sales", label: "매출", icon: "💰", color: "#2563eb", bg: "#eff6ff", roots: ["sales"], showAsRevenue: true },
  { key: "biz_cost", label: "사업원가 (매출원가 + 판매비)", icon: "💸", color: "#ea580c", bg: "#fff7ed", roots: ["cogs", "selling"], showAsRevenue: false },
  { key: "operating", label: "운영비 (일반관리비)", icon: "🏢", color: "#7c3aed", bg: "#f5f3ff", roots: ["ga"], showAsRevenue: false },
  { key: "other", label: "세금·이음·영업외", icon: "📊", color: "#475569", bg: "#f1f5f9", roots: ["tax", "eumlogics", "nonop"], showAsRevenue: false },
] as const;

export default function StatementPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<string>("");
  const [excludeEum, setExcludeEum] = useState(true);
  const [tab, setTab] = useState<"statement" | "unclassified" | "detail">("statement");
  const [data, setData] = useState<Statement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [memoDraft, setMemoDraft] = useState<Record<string, string>>({});
  const [codeDraft, setCodeDraft] = useState<Record<string, string>>({});

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

  async function submitClassify(row: UnclassifiedRow) {
    const key = `${row.table}:${row.id}`;
    const code = codeDraft[key];
    const memo = memoDraft[key];
    if (!code) { alert("표준 항목을 선택해주세요."); return; }
    setSavingIds((s) => ({ ...s, [key]: true }));
    try {
      const res = await fetch("/admin/api/finance/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: row.table, id: row.id, code, memo }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setData((d) => d ? { ...d, unclassified: d.unclassified.filter((u) => !(u.table === row.table && u.id === row.id)) } : d);
      setMemoDraft((m) => { const n = { ...m }; delete n[key]; return n; });
      setCodeDraft((c) => { const n = { ...c }; delete n[key]; return n; });
    } catch (e) {
      alert("분류 저장 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingIds((s) => { const n = { ...s }; delete n[key]; return n; });
    }
  }

  // 섹션별 합계 + 자식 항목 정리
  function getSectionData(section: typeof SECTIONS[number]) {
    if (!data) return { total: 0, items: [] as { code: string; label: string; depth: 0|1|2; amount: number; count: number }[] };
    const total = section.roots.reduce((t, r) => t + (data.tree.find((n) => n.code === r)?.amount || 0), 0);
    const items: { code: string; label: string; depth: 0|1|2; amount: number; count: number }[] = [];
    for (const root of section.roots) {
      for (const node of data.tree) {
        if (node.depth === 0) continue;
        if (node.code.startsWith(root + ".") && node.depth === 1) {
          items.push({ code: node.code, label: node.label, depth: 1, amount: node.amount, count: node.count });
          // depth 2 자식도 같이 (들여쓰기 표시)
          for (const child of data.tree) {
            if (child.depth === 2 && child.code.startsWith(node.code + ".")) {
              items.push({ code: child.code, label: child.label, depth: 2, amount: child.amount, count: child.count });
            }
          }
        }
      }
    }
    // 정렬: depth 1 들은 amount desc, depth 2 는 parent 따라감 → 위 코드에서 이미 parent 아래 child 가 붙음
    return { total, items };
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">손익계산서</h1>
        <p className="text-sm text-gray-500 mt-0.5">표준 재무제표 항목 자동 분류 · 미분류는 수동 분류 + 메모 입력 가능</p>
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
              {/* ─── HERO: 영업이익 큰 카드 + 매출/비용 ─── */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
                <div style={{ background: data.kpi.op_profit >= 0 ? "linear-gradient(135deg,#dcfce7 0%,#f0fdf4 100%)" : "linear-gradient(135deg,#fee2e2 0%,#fef2f2 100%)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 600, marginBottom: 6 }}>영업이익</div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: data.kpi.op_profit >= 0 ? "#15803d" : "#b91c1c", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{fmt(data.kpi.op_profit)}<span style={{ fontSize: 16, marginLeft: 4 }}>원</span></div>
                  <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>매출 대비 <b style={{ color: data.kpi.op_profit >= 0 ? "#15803d" : "#b91c1c" }}>{pct(data.kpi.op_profit, data.kpi.sales)}%</b> · {data.period.year}년{data.period.month ? ` ${data.period.month}월` : " 전체"}</div>
                </div>
                <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 600, marginBottom: 6 }}>💰 매출</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{fmt(data.kpi.sales)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 6 }}>기준 100%</div>
                </div>
                <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 600, marginBottom: 6 }}>💸 총비용</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#ea580c", fontVariantNumeric: "tabular-nums" }}>{fmt(data.kpi.cogs + data.kpi.selling + data.kpi.ga + data.kpi.tax)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 6 }}>매출 대비 {pct(data.kpi.cogs + data.kpi.selling + data.kpi.ga + data.kpi.tax, data.kpi.sales)}%</div>
                </div>
              </div>

              {/* ─── WATERFALL ─── */}
              <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text-main)" }}>매출 → 영업이익 흐름</div>
                {([
                  { label: "매출", amount: data.kpi.sales, color: "var(--primary)", sign: "+" as const },
                  { label: "− 매출원가", amount: data.kpi.cogs, color: "#ea580c", sign: "-" as const },
                  { label: "− 판매비", amount: data.kpi.selling, color: "#f97316", sign: "-" as const },
                  { label: "− 일반관리비", amount: data.kpi.ga, color: "#7c3aed", sign: "-" as const },
                  { label: "− 세금", amount: data.kpi.tax, color: "#475569", sign: "-" as const },
                  { label: "= 영업이익", amount: data.kpi.op_profit, color: data.kpi.op_profit >= 0 ? "#15803d" : "#b91c1c", sign: "=" as const },
                ]).map((row, i) => {
                  const widthPct = data.kpi.sales > 0 ? Math.min(100, Math.abs(row.amount) / data.kpi.sales * 100) : 0;
                  const isTotal = row.sign === "=" || row.sign === "+";
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 1fr 140px 80px", gap: 12, alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: isTotal ? 700 : 500 }}>{row.label}</div>
                      <div style={{ background: "var(--gray-100)", borderRadius: 4, height: isTotal ? 18 : 12, overflow: "hidden" }}>
                        <div style={{ width: `${widthPct}%`, height: "100%", background: row.color, borderRadius: 4, transition: ".2s" }} />
                      </div>
                      <div style={{ fontSize: 13, fontWeight: isTotal ? 800 : 600, color: row.color, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(row.amount)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-sub)", textAlign: "right" }}>{pct(row.amount, data.kpi.sales)}%</div>
                    </div>
                  );
                })}
              </div>

              {/* ─── 자동분류 통계 칩 ─── */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16, padding: 12, background: "var(--gray-50)", borderRadius: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginRight: 8 }}>🤖 자동분류:</span>
                {Object.entries(VIA_LABELS).map(([k, v]) => {
                  const cnt = (data.classify_stats[k] as number) || 0;
                  if (!cnt) return null;
                  return (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", background: v.bg, color: v.color, borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                      {v.label} <b>{cnt}</b>
                    </span>
                  );
                })}
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-sub)" }}>
                  DB 매칭원: 공급사 {data.classify_stats.context.supplier_names} · 판매사 {data.classify_stats.context.store_names} · 인플루언서 {data.classify_stats.context.bank_holders} · 매입세계 {data.classify_stats.context.fp_partners} · 매출세계 {data.classify_stats.context.fs_partners}
                </span>
              </div>

              {/* ─── 탭 전환 ─── */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                <button className={`btn ${tab === "statement" ? "btn-primary" : ""}`} onClick={() => setTab("statement")}>📂 그룹별 (카드)</button>
                <button className={`btn ${tab === "detail" ? "btn-primary" : ""}`} onClick={() => setTab("detail")}>📋 전체 항목 트리</button>
                <button className={`btn ${tab === "unclassified" ? "btn-primary" : ""}`} onClick={() => setTab("unclassified")}>✏️ 미분류 ({data.unclassified.length})</button>
              </div>

              {/* ─── SECTION CARDS (그룹별) ─── */}
              {tab === "statement" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
                  {SECTIONS.map((section) => {
                    const sd = getSectionData(section);
                    const headerPct = section.showAsRevenue ? 100 : pct(sd.total, data.kpi.sales);
                    return (
                      <div key={section.key} style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                        <div style={{ background: section.bg, padding: "14px 18px", borderBottom: `2px solid ${section.color}` }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: section.color }}>{section.icon} {section.label}</div>
                            <div style={{ fontSize: 11, color: section.color, opacity: 0.7 }}>매출 대비 {headerPct}%</div>
                          </div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: section.color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{fmt(sd.total)}</div>
                        </div>
                        <div style={{ padding: "12px 0" }}>
                          {sd.items.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "var(--gray-400)", fontSize: 12 }}>항목 없음</div>}
                          {sd.items.map((it) => {
                            const itemPct = sd.total > 0 ? (Math.abs(it.amount) / Math.abs(sd.total)) * 100 : 0;
                            return (
                              <div key={it.code} style={{ padding: it.depth === 2 ? "4px 18px 4px 36px" : "6px 18px", display: "grid", gridTemplateColumns: "1fr 80px", gap: 8, alignItems: "center" }}>
                                <div>
                                  <div style={{ fontSize: it.depth === 2 ? 11 : 12, color: it.depth === 2 ? "var(--text-sub)" : "var(--text-main)", fontWeight: it.depth === 2 ? 400 : 600, marginBottom: 2 }}>
                                    {it.depth === 2 ? "└ " : ""}{it.label} {it.count > 0 && <span style={{ fontSize: 10, color: "var(--gray-400)", marginLeft: 4 }}>{it.count}건</span>}
                                  </div>
                                  {it.amount > 0 && (
                                    <div style={{ background: "var(--gray-100)", borderRadius: 3, height: it.depth === 2 ? 3 : 5, overflow: "hidden" }}>
                                      <div style={{ width: `${Math.min(100, itemPct)}%`, height: "100%", background: section.color, opacity: it.depth === 2 ? 0.4 : 0.7, borderRadius: 3 }} />
                                    </div>
                                  )}
                                </div>
                                <div style={{ textAlign: "right", fontSize: it.depth === 2 ? 11 : 13, fontWeight: it.depth === 2 ? 500 : 700, color: it.amount === 0 ? "var(--gray-300)" : section.color, fontVariantNumeric: "tabular-nums" }}>{it.amount === 0 ? "-" : fmt(it.amount)}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ─── 전체 트리 (power user) ─── */}
              {tab === "detail" && (
                <div className="panel">
                  <div className="panel-header"><span>전체 항목 트리</span></div>
                  <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                    <table>
                      <thead><tr><th style={{ width: "60%" }}>항목</th><th className="tar" style={{ width: 100 }}>건수</th><th className="tar" style={{ width: 160 }}>금액</th></tr></thead>
                      <tbody>
                        {data.tree.map((node) => {
                          const indent = node.depth * 20;
                          const isRoot = node.depth === 0;
                          const isSub = node.depth === 1;
                          const rowStyle: React.CSSProperties = isRoot
                            ? { background: "var(--gray-50)", borderTop: "2px solid var(--border)", fontWeight: 800 }
                            : isSub ? { fontWeight: 600 } : {};
                          const sideColor = node.side === "in" ? "var(--primary)" : node.side === "out" ? "var(--danger)" : "var(--text-main)";
                          const amountColor = node.amount === 0 ? "var(--gray-300)" : isRoot ? sideColor : "var(--text-main)";
                          return (
                            <tr key={node.code} style={rowStyle}>
                              <td style={{ paddingLeft: 12 + indent }}>
                                {node.depth === 2 ? "└ " : ""}{node.label}
                              </td>
                              <td className="tar" style={{ color: node.count ? "var(--text-sub)" : "var(--gray-300)", fontSize: 11 }}>{node.count || "-"}</td>
                              <td className="tar" style={{ color: amountColor, fontWeight: isRoot ? 800 : isSub ? 700 : 500 }}>{node.amount === 0 ? "-" : fmt(node.amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ─── 미분류 (dropdown + 메모 입력) ─── */}
              {tab === "unclassified" && (
                <div className="panel">
                  <div className="panel-header">
                    <span>미분류 거래 ({data.unclassified.length}건)</span>
                    <span style={{ fontSize: 11, color: "var(--text-sub)" }}>표준 항목 선택 + 메모(선택) → 저장</span>
                  </div>
                  <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr><th>일자</th><th>구분</th><th>거래처/적요</th><th className="tar">금액</th><th style={{ width: 200 }}>표준 항목</th><th style={{ width: 180 }}>메모(직접입력)</th><th></th></tr>
                      </thead>
                      <tbody>
                        {data.unclassified.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 30, color: "var(--text-sub)" }}>미분류 거래 없음</td></tr>}
                        {data.unclassified.map((r) => {
                          const key = `${r.table}:${r.id}`;
                          const saving = savingIds[key];
                          const selectedCode = codeDraft[key] || "";
                          return (
                            <tr key={key}>
                              <td>{r.date}</td>
                              <td><span className={`badge ${r.side === "in" ? "badge-green" : "badge-red"}`}>{r.side === "in" ? "입금" : "출금"}</span></td>
                              <td>
                                <div style={{ fontWeight: 600 }}>{r.partner || "(미지정)"}</div>
                                <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{r.descr || ""}{r.memo ? ` · ${r.memo}` : ""}</div>
                                <div style={{ fontSize: 10, color: "var(--gray-400)", fontFamily: "monospace", marginTop: 2 }}>현재 분류: {r.current_code}{r.auto ? " (자동)" : ""}</div>
                              </td>
                              <td className="tar" style={{ fontWeight: 700, color: r.side === "in" ? "var(--green)" : "var(--red)" }}>{fmt(r.amount)}</td>
                              <td>
                                <select
                                  className="form-input"
                                  value={selectedCode}
                                  disabled={saving}
                                  onChange={(e) => setCodeDraft((c) => ({ ...c, [key]: e.target.value }))}
                                  style={{ width: "100%" }}
                                >
                                  <option value="">— 표준 항목 선택 —</option>
                                  {CLASSIFY_OPTIONS.filter((o) => o.side === "both" || o.side === r.side).map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  className="form-input"
                                  type="text"
                                  placeholder="세부 메모 (예: 가세연 PR)"
                                  value={memoDraft[key] || ""}
                                  disabled={saving}
                                  onChange={(e) => setMemoDraft((m) => ({ ...m, [key]: e.target.value }))}
                                  style={{ width: "100%" }}
                                />
                              </td>
                              <td>
                                <button className="btn btn-primary btn-sm" disabled={saving || !selectedCode} onClick={() => submitClassify(r)}>{saving ? "..." : "저장"}</button>
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
