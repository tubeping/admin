"use client";

import { useEffect, useState } from "react";

// 원본 iframe(ShinsanEmbed → hub.eumlogics.kr/shinsan#vat) 대체 — 신산 Supabase 네이티브.
interface HalfRow {
  period: string;
  salesSupply: number; salesTax: number; salesCount: number;
  purchSupply: number; purchTax: number; purchCount: number;
  net: number;
}
interface MonthRow {
  month: string;
  salesSupply: number; salesTax: number;
  purchSupply: number; purchTax: number;
  net: number;
}

const fmt = (n: number) => n.toLocaleString("ko-KR") + "원";

export default function FinanceVatPage() {
  const [tab, setTab] = useState<"half" | "monthly">("half");
  const [data, setData] = useState<{ half: HalfRow[]; monthly: MonthRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/admin/api/finance/vat")
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">부가세</h1>
        <p className="text-sm text-gray-500 mt-0.5">매출세액 − 매입세액 · 반기/월 단위 집계</p>
      </header>

      <div className="px-6 py-3 flex gap-2">
        {(["half", "monthly"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t ? "bg-[#C41E1E] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {t === "half" ? "반기별" : "월별"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {err && <p className="text-red-600 text-sm">불러오기 실패: {err}</p>}
        {!data && !err && <p className="text-gray-400 text-sm">집계 중…</p>}

        {data && tab === "half" && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-500 border-b">
                <th className="text-left py-2">기간</th>
                <th className="text-right">매출공급가</th><th className="text-right">매출세액</th><th className="text-center">건수</th>
                <th className="text-right">매입공급가</th><th className="text-right">매입세액</th><th className="text-center">건수</th>
                <th className="text-right">납부(환급)세액</th>
              </tr>
            </thead>
            <tbody>
              {data.half.map((v) => (
                <tr key={v.period} className="border-b">
                  <td className="py-2 font-semibold">{v.period}</td>
                  <td className="text-right">{fmt(v.salesSupply)}</td>
                  <td className="text-right text-blue-600">{fmt(v.salesTax)}</td>
                  <td className="text-center">{v.salesCount}</td>
                  <td className="text-right">{fmt(v.purchSupply)}</td>
                  <td className="text-right text-red-500">{fmt(v.purchTax)}</td>
                  <td className="text-center">{v.purchCount}</td>
                  <td className={`text-right font-bold ${v.net >= 0 ? "text-red-600" : "text-green-600"}`}>{fmt(v.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data && tab === "monthly" && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-500 border-b">
                <th className="text-left py-2">월</th>
                <th className="text-right">매출공급가</th><th className="text-right">매출세액</th>
                <th className="text-right">매입공급가</th><th className="text-right">매입세액</th>
                <th className="text-right">납부(환급)</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((v) => (
                <tr key={v.month} className="border-b">
                  <td className="py-2 font-semibold">{v.month}</td>
                  <td className="text-right">{fmt(v.salesSupply)}</td>
                  <td className="text-right text-blue-600">{fmt(v.salesTax)}</td>
                  <td className="text-right">{fmt(v.purchSupply)}</td>
                  <td className="text-right text-red-500">{fmt(v.purchTax)}</td>
                  <td className={`text-right font-bold ${v.net >= 0 ? "text-red-600" : "text-green-600"}`}>{fmt(v.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
