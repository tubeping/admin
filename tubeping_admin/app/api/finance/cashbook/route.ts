import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/finance/cashbook?year=&month=&type=&q=&category=
 * 입출금 통합 원장 — fin_bank_in + fin_bank_out 을 시간순으로 머지.
 * - rows: 날짜순(오름차순) 통합 원장 (잔액은 fin_bank_*.balance 가 있으면 사용, 없으면 누적 계산)
 * - summary / byCategory / byMonth
 */
export const dynamic = "force-dynamic";

type Row = { date: string; partner: string | null; amount: number; balance: number | null; category: string | null; descr: string | null; memo: string | null };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const year = sp.get("year") || String(new Date().getFullYear());
  const month = sp.get("month") || ""; // "01" ~ "12" or ""
  const typeFilter = sp.get("type") || ""; // "in" | "out" | ""
  const q = (sp.get("q") || "").trim().toLowerCase();
  const category = (sp.get("category") || "").trim();

  const from = month ? `${year}-${month}-01` : `${year}-01-01`;
  const to = month ? `${year}-${month}-31` : `${year}-12-31`;

  const sb = getServiceClient();
  try {
    const [inR, outR] = await Promise.all([
      sb.from("fin_bank_in").select("date,partner,amount,balance,category,descr,memo").gte("date", from).lte("date", to),
      sb.from("fin_bank_out").select("date,partner,amount,balance,category,descr,memo").gte("date", from).lte("date", to),
    ]);
    if (inR.error) throw new Error(inR.error.message);
    if (outR.error) throw new Error(outR.error.message);

    const bankIn = (inR.data ?? []) as Row[];
    const bankOut = (outR.data ?? []) as Row[];

    const tagged = [
      ...bankIn.map((r) => ({ ...r, type: "in" as const })),
      ...bankOut.map((r) => ({ ...r, type: "out" as const })),
    ];

    // 필터: type / q / category
    let rows = tagged;
    if (typeFilter === "in" || typeFilter === "out") rows = rows.filter((r) => r.type === typeFilter);
    if (category) rows = rows.filter((r) => (r.category || "") === category);
    if (q) rows = rows.filter((r) => `${r.partner || ""} ${r.descr || ""} ${r.memo || ""}`.toLowerCase().includes(q));

    // 날짜 오름차순 정렬
    rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    // 잔액: balance 가 있는 row 는 그대로, 없는 row 는 직전 balance + 입금/-출금 으로 추정
    let lastBalance: number | null = null;
    const rowsWithBalance = rows.map((r) => {
      let bal = r.balance;
      if (bal === null || bal === undefined) {
        if (lastBalance !== null) bal = lastBalance + (r.type === "in" ? r.amount : -r.amount);
      } else {
        lastBalance = bal;
      }
      if (bal !== null) lastBalance = bal;
      return { ...r, balance: bal };
    });

    // 요약
    const total_in = bankIn.reduce((t, r) => t + (r.amount || 0), 0);
    const total_out = bankOut.reduce((t, r) => t + (r.amount || 0), 0);

    // 카테고리별
    const catMap: Record<string, { category: string; in: number; out: number; count: number }> = {};
    for (const r of tagged) {
      const c = r.category || "(미분류)";
      if (!catMap[c]) catMap[c] = { category: c, in: 0, out: 0, count: 0 };
      catMap[c].count++;
      if (r.type === "in") catMap[c].in += r.amount; else catMap[c].out += r.amount;
    }
    const byCategory = Object.values(catMap)
      .map((c) => ({ ...c, net: c.in - c.out }))
      .sort((a, b) => Math.abs(b.in + b.out) - Math.abs(a.in + a.out));

    // 월별
    const monthMap: Record<string, { month: string; in: number; out: number }> = {};
    for (const r of tagged) {
      const m = r.date?.slice(0, 7) || "";
      if (!monthMap[m]) monthMap[m] = { month: m, in: 0, out: 0 };
      if (r.type === "in") monthMap[m].in += r.amount; else monthMap[m].out += r.amount;
    }
    const byMonth = Object.values(monthMap)
      .map((m) => ({ ...m, net: m.in - m.out }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      summary: {
        year: Number(year),
        month: month || null,
        total_in,
        total_out,
        net: total_in - total_out,
        count: bankIn.length + bankOut.length,
        count_in: bankIn.length,
        count_out: bankOut.length,
        latest_balance: lastBalance,
      },
      rows: rowsWithBalance,
      byCategory,
      byMonth,
      categories: [...new Set(tagged.map((r) => r.category || "").filter(Boolean))].sort(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
