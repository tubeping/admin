import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/finance/vat — 부가세 반기별/월별 집계
 * 원본: dashboard/public/pages.js PAGES['vat'] 의 localStorage 집계 로직을 Supabase 로 이식.
 * 납부세액 = 매출세액 - 매입세액 (반기/월 단위 합산).
 */
type Row = { date: string; supply: number | null; tax: number | null };

export async function GET() {
  const sb = getServiceClient();
  const [salesRes, purchRes] = await Promise.all([
    sb.from("fin_sales").select("date, supply, tax"),
    sb.from("fin_purchases").select("date, supply, tax"),
  ]);
  if (salesRes.error) return NextResponse.json({ error: salesRes.error.message }, { status: 500 });
  if (purchRes.error) return NextResponse.json({ error: purchRes.error.message }, { status: 500 });

  const sales = (salesRes.data ?? []) as Row[];
  const purchases = (purchRes.data ?? []) as Row[];

  const sum = (rows: Row[], key: "supply" | "tax") => rows.reduce((t, x) => t + (x[key] || 0), 0);
  const months = [...new Set([...sales, ...purchases].map((x) => x.date?.slice(0, 7)).filter(Boolean))].sort();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort();

  // 반기별 (1기 1~6월 / 2기 7~12월)
  const half = [];
  for (const y of years) {
    for (const [label, lo, hi] of [["1기 (1~6월)", 1, 6], ["2기 (7~12월)", 7, 12]] as const) {
      const inHalf = (x: Row) => x.date?.startsWith(y) && +x.date.slice(5, 7) >= lo && +x.date.slice(5, 7) <= hi;
      const hs = sales.filter(inHalf), hp = purchases.filter(inHalf);
      if (!hs.length && !hp.length) continue;
      const salesTax = sum(hs, "tax"), purchTax = sum(hp, "tax");
      half.push({
        period: `${y}년 ${label}`,
        salesSupply: sum(hs, "supply"), salesTax, salesCount: hs.length,
        purchSupply: sum(hp, "supply"), purchTax, purchCount: hp.length,
        net: salesTax - purchTax,
      });
    }
  }

  // 월별
  const monthly = months.map((m) => {
    const ms = sales.filter((x) => x.date?.startsWith(m)), mp = purchases.filter((x) => x.date?.startsWith(m));
    const salesTax = sum(ms, "tax"), purchTax = sum(mp, "tax");
    return {
      month: m,
      salesSupply: sum(ms, "supply"), salesTax,
      purchSupply: sum(mp, "supply"), purchTax,
      net: salesTax - purchTax,
    };
  });

  return NextResponse.json({ half, monthly });
}
