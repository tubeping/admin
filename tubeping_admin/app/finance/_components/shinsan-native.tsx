"use client";

import { useEffect, useRef, useState } from "react";
import { renderPage } from "./shinsan-engine";
import "./shinsan-fin.css";

// 원본 hub 의 hash → tubeping admin 라우트 매핑 (cross-link 용)
const ROUTE: Record<string, string> = {
  dashboard: "", sales_invoice: "sales", purchase_invoice: "cost",
  ar_ap: "receivables", ar_ap_2026: "receivables", report_pnl: "pnl",
  vat: "vat", issue: "sales", data_import: "",
};

interface FinData { sales: unknown[]; purchases: unknown[]; cardTx: unknown[]; bankIn: unknown[]; bankOut: unknown[]; }

export default function ShinsanNative({ hash, title }: { hash: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<FinData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/admin/api/finance/all")
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!data || !ref.current) return;
    const w = window as unknown as Record<string, unknown>;
    w.navigate = (h: string) => {
      if (h === hash) { if (ref.current) ref.current.innerHTML = renderPage(hash, data); return; }
      if (h in ROUTE) window.location.href = "/admin/finance/" + ROUTE[h];
    };
    w.DataCollector = { run: () => alert("홈택스 수집·동기화는 신산 자체 연동 후 제공됩니다.") };
    ref.current.innerHTML = renderPage(hash, data);
  }, [data, hash]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">신산 Supabase 기반 · 원본 재무허브 로직 이식</p>
      </header>
      <div className="flex-1 overflow-auto">
        {err && <div className="p-6 text-red-600 text-sm">불러오기 실패: {err}</div>}
        {!data && !err && <div className="p-6 text-gray-400 text-sm">불러오는 중…</div>}
        <div className="shinsan-fin" ref={ref} />
      </div>
    </div>
  );
}
