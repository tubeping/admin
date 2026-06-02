import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/finance/ar-ap?year=2026 — 미수금/미지급금 (세금계산서 ↔ 은행 입출금 매칭)
 *
 * ⚠️ 원본은 Vultr 백엔드(/api/shinsan/ar-ap-reconcile, 비공개)가 계산.
 *    여기서는 매출/매입 페이지와 동일한 이름토큰+금액 매칭 로직으로 재구현.
 *    원본 수치와 미세 차이가 있을 수 있어 화면에 '검증 필요' 표기.
 */
export const dynamic = "force-dynamic";

type Row = { date: string; partner: string | null; amount: number; supply: number; tax: number; type: string | null; descr: string | null };
type Tx = { date: string; partner: string | null; amount: number; descr: string | null; _matched?: boolean };

const norm = (s: string | null) => (s || "").replace(/\s/g, "").replace(/\(주\)|㈜|주식회사/g, "").toLowerCase();
const tokens = (name: string | null) => norm(name).split(/[()\[\]{},/.\-]/).filter((p) => p.length >= 2);
const nameMatch = (name: string | null, txText: string) => {
  const toks = tokens(name); const t = norm(txText);
  return !!toks.length && !!t && toks.some((tok) => t.includes(tok));
};

function matchTx(row: Row, pool: Tx[]): Tx | null {
  for (const tx of pool) { if (tx._matched) continue; const txt = (tx.partner || "") + " " + (tx.descr || ""); if (nameMatch(row.partner, txt) && Math.abs(tx.amount - row.amount) < 100) { tx._matched = true; return tx; } }
  for (const tx of pool) { if (tx._matched) continue; if (Math.abs(tx.amount - row.amount) < 100) { tx._matched = true; return tx; } }
  return null;
}

// PG/플랫폼 합산매출·보정 등 — 건별 은행매칭 불가, 미수금 대상 아님 (매출관리 isPlatform 로직과 동일)
const PLATFORM = ["(보정)", "네이버페이", "쿠팡 매출", "카페24", "KCP"];
const isSettled = (r: Row) => r.type === "현영" || PLATFORM.some((k) => (r.partner || "").includes(k));

function reconcile(rows: Row[], pool: Tx[], usePlatformRule: boolean) {
  const unmatchedByPartner: Record<string, { partner: string; count: number; total: number; items: { date: string; desc: string; amount: number; vat: number; total: number }[] }> = {};
  const matched: { invoice: { date: string; partner: string; total: number }; tx: { date: string; desc: string; partner: string; amount: number } }[] = [];
  let matchedCount = 0;
  for (const r of rows) {
    if (usePlatformRule ? isSettled(r) : r.type === "현영") { matchedCount++; continue; } // 현금/PG/플랫폼 = 결제완료 간주
    const tx = matchTx(r, pool);
    if (tx) {
      matchedCount++;
      matched.push({ invoice: { date: r.date, partner: r.partner || "", total: r.amount }, tx: { date: tx.date, desc: tx.descr || "", partner: tx.partner || "", amount: tx.amount } });
    } else {
      const p = r.partner || "(미지정)";
      if (!unmatchedByPartner[p]) unmatchedByPartner[p] = { partner: p, count: 0, total: 0, items: [] };
      unmatchedByPartner[p].count++; unmatchedByPartner[p].total += r.amount;
      unmatchedByPartner[p].items.push({ date: r.date, desc: r.descr || "", amount: r.supply, vat: r.tax, total: r.amount });
    }
  }
  const unmatched = Object.values(unmatchedByPartner).sort((a, b) => b.total - a.total);
  return { unmatched, matched, matchedCount };
}

export async function GET(req: NextRequest) {
  const year = req.nextUrl.searchParams.get("year") || "2026";
  try {
    const sb = getServiceClient();
    const [salesR, purchR, inR, outR] = await Promise.all([
      sb.from("fin_sales").select("date,partner,amount,supply,tax,type,descr").gte("date", `${year}-01-01`).lte("date", `${year}-12-31`),
      sb.from("fin_purchases").select("date,partner,amount,supply,tax,type,descr").gte("date", `${year}-01-01`).lte("date", `${year}-12-31`),
      sb.from("fin_bank_in").select("date,partner,amount,descr"),
      sb.from("fin_bank_out").select("date,partner,amount,descr"),
    ]);
    for (const r of [salesR, purchR, inR, outR]) if (r.error) throw new Error(r.error.message);

    const sales = (salesR.data ?? []) as Row[];
    const purchases = (purchR.data ?? []) as Row[];
    const bankIn = (inR.data ?? []).map((x) => ({ ...x })) as Tx[];
    const bankOut = (outR.data ?? []).map((x) => ({ ...x })) as Tx[];

    const ar = reconcile(sales, bankIn, true);   // 매출: PG/플랫폼/보정 제외
    const ap = reconcile(purchases, bankOut, false); // 매입: 현영만 결제완료

    return NextResponse.json({
      summary: {
        year: Number(year),
        unreceived_total: ar.unmatched.reduce((t, x) => t + x.total, 0),
        unreceived_count: ar.unmatched.reduce((t, x) => t + x.count, 0),
        unpaid_total: ap.unmatched.reduce((t, x) => t + x.total, 0),
        unpaid_count: ap.unmatched.reduce((t, x) => t + x.count, 0),
        sales_count: sales.length,
        purchase_count: purchases.length,
        sales_matched: ar.matchedCount,
        purchase_matched: ap.matchedCount,
      },
      unreceived: ar.unmatched,
      unpaid: ap.unmatched,
      sales_matched: ar.matched.slice(0, 200),
      purchase_matched: ap.matched.slice(0, 200),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
