"use client";

import { Fragment, useEffect, useState } from "react";
import "./shinsan-fin.css";

const fmt = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

interface Item { date: string; desc: string; amount: number; vat: number; total: number }
interface PartnerGroup { partner: string; count: number; total: number; items: Item[] }
interface Matched { invoice: { date: string; partner: string; total: number }; tx: { date: string; desc: string; partner: string; amount: number } }
interface ArAp {
  summary: { year: number; unreceived_total: number; unreceived_count: number; unpaid_total: number; unpaid_count: number; sales_count: number; purchase_count: number; sales_matched: number; purchase_matched: number };
  unreceived: PartnerGroup[]; unpaid: PartnerGroup[]; sales_matched: Matched[]; purchase_matched: Matched[];
}

type Tab = "unreceived" | "unpaid" | "sales_matched" | "purchase_matched";

export default function ShinsanArAp() {
  const [year, setYear] = useState(2026);
  const [data, setData] = useState<ArAp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("unreceived");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setErr(null);
    fetch(`/admin/api/finance/ar-ap?year=${year}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, [year]);

  const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) + "%" : "0%");

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">미수/미지급</h1>
        <p className="text-sm text-gray-500 mt-0.5">세금계산서 ↔ 은행 입출금 매칭</p>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="shinsan-fin">
          <div className="fin-note">⚠️ 미수/미지급 매칭은 원본 홈택스 reconcile(비공개) 로직을 재구현한 것으로, 정확도 검증이 필요합니다. 매출/매입 페이지의 입금·지급 매칭과 동일 알고리즘(거래처명+금액)입니다.</div>

          <div className="filter-bar" style={{ justifyContent: "space-between" }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{year}년 미수금/미지급금</div>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="form-input" style={{ width: 120 }}>
              {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>

          {err && <div className="empty-state">불러오기 실패: {err}</div>}
          {!data && !err && <div className="empty-state">집계 중…</div>}

          {data && (
            <>
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">미수금 (받을 돈)</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--red)" }}>{fmt(data.summary.unreceived_total)}</div><div className="kpi-sub">{data.summary.unreceived_count}건 / 매출 {data.summary.sales_count}건 중</div></div>
                <div className="kpi-card"><div className="kpi-label">미지급금 (줄 돈)</div><div className="kpi-value" style={{ fontSize: 20, color: "#b45309" }}>{fmt(data.summary.unpaid_total)}</div><div className="kpi-sub">{data.summary.unpaid_count}건 / 매입 {data.summary.purchase_count}건 중</div></div>
                <div className="kpi-card"><div className="kpi-label">입금 매칭율</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--green)" }}>{pct(data.summary.sales_matched, data.summary.sales_count)}</div><div className="kpi-sub">{data.summary.sales_matched} / {data.summary.sales_count}건</div></div>
                <div className="kpi-card"><div className="kpi-label">출금 매칭율</div><div className="kpi-value" style={{ fontSize: 20, color: "var(--blue)" }}>{pct(data.summary.purchase_matched, data.summary.purchase_count)}</div><div className="kpi-sub">{data.summary.purchase_matched} / {data.summary.purchase_count}건</div></div>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {([["unreceived", `미수금 거래처 (${data.unreceived.length})`], ["unpaid", `미지급금 거래처 (${data.unpaid.length})`], ["sales_matched", `입금 매칭건 (${data.sales_matched.length})`], ["purchase_matched", `출금 매칭건 (${data.purchase_matched.length})`]] as [Tab, string][]).map(([t, label]) => (
                  <button key={t} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => { setTab(t); setOpen(null); }}>{label}</button>
                ))}
              </div>

              {(tab === "unreceived" || tab === "unpaid") && (() => {
                const list = tab === "unreceived" ? data.unreceived : data.unpaid;
                const label = tab === "unreceived" ? "미수금" : "미지급금";
                const color = tab === "unreceived" ? "var(--red)" : "#b45309";
                const total = list.reduce((t, x) => t + x.total, 0);
                if (!list.length) return <div className="empty-state">{label} 없음</div>;
                return (
                  <div className="panel">
                    <div className="panel-header"><span>{label} 거래처별 상세 (합계 {fmt(total)}원)</span></div>
                    <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                      <table>
                        <thead><tr><th>거래처</th><th className="tar">건수</th><th className="tar">{label} 합계</th><th style={{ width: "30%" }}>비중</th><th>상세</th></tr></thead>
                        <tbody>
                          {list.map((p) => {
                            const ratio = total > 0 ? Math.round((p.total / total) * 100) : 0;
                            const isOpen = open === p.partner;
                            return (
                              <Fragment key={p.partner}>
                                <tr>
                                  <td style={{ fontWeight: 600 }}>{p.partner}</td>
                                  <td className="tar">{p.count}건</td>
                                  <td className="tar" style={{ fontWeight: 700, color }}>{fmt(p.total)}</td>
                                  <td><div style={{ background: "var(--gray-200)", borderRadius: 4, height: 8 }}><div style={{ width: `${ratio}%`, height: "100%", background: color, borderRadius: 4 }} /></div></td>
                                  <td><button className="btn btn-sm" onClick={() => setOpen(isOpen ? null : p.partner)}>{isOpen ? "닫기" : "보기"}</button></td>
                                </tr>
                                {isOpen && (
                                  <tr><td colSpan={5} style={{ padding: 0 }}>
                                    <table>
                                      <thead><tr><th>발행일</th><th>적요</th><th className="tar">공급가</th><th className="tar">부가세</th><th className="tar">총액</th></tr></thead>
                                      <tbody>{p.items.map((it, i) => <tr key={i}><td>{it.date}</td><td style={{ fontSize: 12, color: "var(--text-sub)" }}>{it.desc}</td><td className="tar">{fmt(it.amount)}</td><td className="tar" style={{ color: "var(--text-sub)" }}>{fmt(it.vat)}</td><td className="tar" style={{ fontWeight: 700 }}>{fmt(it.total)}</td></tr>)}</tbody>
                                    </table>
                                  </td></tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {(tab === "sales_matched" || tab === "purchase_matched") && (() => {
                const list = tab === "sales_matched" ? data.sales_matched : data.purchase_matched;
                const label = tab === "sales_matched" ? "입금" : "출금";
                if (!list.length) return <div className="empty-state">매칭 건 없음</div>;
                return (
                  <div className="panel">
                    <div className="panel-header"><span>{label} 매칭 완료 (상위 {list.length}건)</span></div>
                    <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
                      <table>
                        <thead><tr><th>세금계산서 일자</th><th>거래처</th><th className="tar">세금계산서 금액</th><th>은행거래일</th><th>은행 적요</th><th className="tar">은행 금액</th></tr></thead>
                        <tbody>{list.map((m, i) => <tr key={i}><td>{m.invoice.date}</td><td style={{ fontWeight: 600 }}>{m.invoice.partner}</td><td className="tar">{fmt(m.invoice.total)}</td><td>{m.tx.date}</td><td style={{ fontSize: 12, color: "var(--text-sub)" }}>{m.tx.desc || m.tx.partner}</td><td className="tar" style={{ fontWeight: 700 }}>{fmt(m.tx.amount)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
