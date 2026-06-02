"use client";

import { useEffect, useMemo, useState } from "react";
import "../_components/shinsan-fin.css";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("ko-KR"));

type AuditStatus = "ok" | "invoiced_only" | "mismatch" | "db_only" | "missing" | "skipped";

interface Row {
  kind: "supplier" | "influencer";
  source_id: string;
  period: string;
  partner_name: string;
  expected_supply: number;
  expected_total: number;
  status_settlement: string;
  invoice_no: string | null;
  invoiced_at: string | null;
  matched_invoice: { date: string; partner: string; supply: number; tax: number; amount: number } | null;
  status: AuditStatus;
  diff_amount: number;
  memo: string | null;
}

interface ApiResp {
  summary: {
    year: number;
    total: number;
    by_status: Record<AuditStatus, number>;
    missing_amount: number;
    mismatch_amount: number;
    supplier_count: number;
    influencer_count: number;
  };
  rows: Row[];
}

const STATUS_LABEL: Record<AuditStatus, { text: string; cls: string }> = {
  ok: { text: "정상 발행", cls: "badge-green" },
  invoiced_only: { text: "발행 표시만", cls: "badge-yellow" },
  mismatch: { text: "금액 불일치", cls: "badge-yellow" },
  db_only: { text: "발행했으나 번호 미입력", cls: "badge-blue" },
  missing: { text: "미발행", cls: "badge-red" },
  skipped: { text: "발행 대상 아님", cls: "badge-gray" },
};

export default function InvoiceAuditPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | "supplier" | "influencer">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AuditStatus>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    setData(null); setErr(null);
    fetch(`/admin/api/finance/invoice-audit?year=${year}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, [year]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (kindFilter !== "all") rows = rows.filter((r) => r.kind === kindFilter);
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (q.trim()) {
      const qq = q.toLowerCase();
      rows = rows.filter((r) => `${r.partner_name} ${r.invoice_no || ""} ${r.memo || ""}`.toLowerCase().includes(qq));
    }
    return rows;
  }, [data, kindFilter, statusFilter, q]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">세금계산서 발행 감사</h1>
        <p className="text-sm text-gray-500 mt-0.5">정산 자료 ↔ 매입 세금계산서(fin_purchases) 매칭 · 공급사 + 인플루언서(사업자)</p>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="shinsan-fin">
          <div className="fin-note">
            ℹ️ 매칭 기준: 거래처명 토큰 + 금액 ±5%. 인플루언서는 <b>사업자</b> 정산만(프리랜서는 원천세 처리라 대상 아님).
            상태 기준 — <b>정상</b>: 정산에 번호 있고 세금계산서 매칭됨 · <b>발행 표시만</b>: 번호는 있는데 신고건 매칭 없음 · <b>번호 미입력</b>: 신고건은 있는데 정산 invoice_no 비어있음 · <b>미발행</b>: 둘 다 없음.
          </div>

          <div className="filter-bar" style={{ flexWrap: "wrap", gap: 8 }}>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="form-input" style={{ width: 110 }}>
              {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="form-input" style={{ width: 150 }}>
              <option value="all">전체 정산</option>
              <option value="supplier">공급사 정산</option>
              <option value="influencer">인플루언서(사업자)</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="form-input" style={{ width: 180 }}>
              <option value="all">전체 상태</option>
              <option value="missing">미발행</option>
              <option value="mismatch">금액 불일치</option>
              <option value="invoiced_only">발행 표시만</option>
              <option value="db_only">번호 미입력</option>
              <option value="ok">정상 발행</option>
              <option value="skipped">대상 아님</option>
            </select>
            <input className="form-input" placeholder="거래처/번호/메모 검색…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          </div>

          {err && <div className="empty-state" style={{ color: "var(--red)" }}>불러오기 실패: {err}</div>}
          {!data && !err && <div className="empty-state">감사 중…</div>}

          {data && (
            <>
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">미발행 (Action 필요)</div><div className="kpi-value" style={{ fontSize: 22, color: "var(--red)" }}>{data.summary.by_status.missing}</div><div className="kpi-sub">예상 합계 {fmt(data.summary.missing_amount)}원</div></div>
                <div className="kpi-card"><div className="kpi-label">금액 불일치</div><div className="kpi-value" style={{ fontSize: 22, color: "#b45309" }}>{data.summary.by_status.mismatch}</div><div className="kpi-sub">차이 합 {fmt(data.summary.mismatch_amount)}원</div></div>
                <div className="kpi-card"><div className="kpi-label">발행 표시만 / 번호 미입력</div><div className="kpi-value" style={{ fontSize: 22, color: "var(--blue)" }}>{data.summary.by_status.invoiced_only + data.summary.by_status.db_only}</div><div className="kpi-sub">표시만 {data.summary.by_status.invoiced_only} · 미입력 {data.summary.by_status.db_only}</div></div>
                <div className="kpi-card"><div className="kpi-label">정상 발행</div><div className="kpi-value" style={{ fontSize: 22, color: "var(--green)" }}>{data.summary.by_status.ok}</div><div className="kpi-sub">전체 대상 {data.summary.total - data.summary.by_status.skipped}건 중</div></div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <span>감사 결과 ({filtered.length}건 / 전체 {data.summary.total})</span>
                  <span style={{ fontSize: 12, color: "var(--text-sub)" }}>공급사 {data.summary.supplier_count} · 인플루언서 {data.summary.influencer_count}</span>
                </div>
                <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>구분</th>
                        <th>기간</th>
                        <th>거래처</th>
                        <th>정산상태</th>
                        <th className="tar">정산 합계</th>
                        <th>발행번호</th>
                        <th>매칭 세계 일자</th>
                        <th className="tar">매칭 세계 합계</th>
                        <th className="tar">차이</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", padding: 30, color: "var(--text-sub)" }}>해당 조건의 감사 항목 없음</td></tr>}
                      {filtered.map((r) => {
                        const label = STATUS_LABEL[r.status];
                        return (
                          <tr key={r.kind + r.source_id}>
                            <td><span className={`badge ${r.kind === "supplier" ? "badge-blue" : "badge-yellow"}`}>{r.kind === "supplier" ? "공급사" : "인플루언서"}</span></td>
                            <td>{r.period}</td>
                            <td style={{ fontWeight: 600 }}>{r.partner_name}</td>
                            <td style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.status_settlement}</td>
                            <td className="tar" style={{ fontWeight: 600 }}>{fmt(r.expected_total)}</td>
                            <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.invoice_no || <span style={{ color: "var(--gray-400)" }}>—</span>}</td>
                            <td>{r.matched_invoice?.date || <span style={{ color: "var(--gray-400)" }}>—</span>}</td>
                            <td className="tar">{r.matched_invoice ? fmt(r.matched_invoice.amount) : <span style={{ color: "var(--gray-400)" }}>—</span>}</td>
                            <td className="tar" style={{ color: Math.abs(r.diff_amount) > 100 ? "var(--red)" : "var(--text-sub)", fontWeight: Math.abs(r.diff_amount) > 100 ? 700 : 400 }}>
                              {r.matched_invoice ? fmt(r.diff_amount) : "-"}
                            </td>
                            <td><span className={`badge ${label.cls}`}>{label.text}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
