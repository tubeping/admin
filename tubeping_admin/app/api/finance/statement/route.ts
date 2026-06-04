import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { ACCOUNTS, classify, rootOf, type Classifiable } from "@/lib/finance/accounts";

/**
 * GET /api/finance/statement?year=2026&month=&exclude_eum=true
 *
 * 재무제표 스타일 손익. fin_bank_in/out/card_tx 를 표준 chart of accounts 로 자동분류해 트리 집계.
 * 매출원가/판매비(PG·3PL·인플루언서) 일부는 settlements/supplier_settlements 에 내장돼 있어
 * 별도로 집계해 트리의 cogs.supplier, selling.pg_fee, selling.tpl, selling.influencer 에 합산한다.
 *
 * 응답:
 *   - tree: Account[] 에 amount/count 가 합산된 형태 (depth 0 의 amount = 자식 합산)
 *   - unclassified: 미분류 거래 (수동분류 대상)
 *   - kpi: 매출/원가/판매비/관리비/세금/이음로직스/영업이익
 */
export const dynamic = "force-dynamic";

interface BankRow extends Classifiable { id: number; date: string; amount: number; _table: "fin_bank_in" | "fin_bank_out" | "fin_card_tx"; _side: "in" | "out" }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const year = sp.get("year") || String(new Date().getFullYear());
  const month = sp.get("month") || "";
  const excludeEum = sp.get("exclude_eum") === "true";

  const from = month ? `${year}-${month}-01` : `${year}-01-01`;
  const to = month ? `${year}-${month}-31` : `${year}-12-31`;

  try {
    const sb = getServiceClient();

    const [inR, outR, cardR, stR, ssR] = await Promise.all([
      sb.from("fin_bank_in").select("id,date,partner,amount,category,descr,memo").gte("date", from).lte("date", to),
      sb.from("fin_bank_out").select("id,date,partner,amount,category,descr,memo").gte("date", from).lte("date", to),
      sb.from("fin_card_tx").select("id,date,partner,amount,category,descr,memo").gte("date", from).lte("date", to),
      sb.from("settlements")
        .select("period,total_sales,total_cogs,pg_fee,tpl_cost,other_cost,influencer_amount,company_amount,net_profit")
        .like("period", `${year}-%`),
      sb.from("supplier_settlements")
        .select("period,supplier_name,total_amount")
        .like("period", `${year}-%`),
    ]);
    for (const r of [inR, outR, cardR, stR, ssR]) if (r.error) throw new Error(r.error.message);

    const bankIn = ((inR.data ?? []) as BankRow[]).map((r) => ({ ...r, _table: "fin_bank_in" as const, _side: "in" as const }));
    const bankOut = ((outR.data ?? []) as BankRow[]).map((r) => ({ ...r, _table: "fin_bank_out" as const, _side: "out" as const }));
    const cardTx = ((cardR.data ?? []) as BankRow[]).map((r) => ({ ...r, _table: "fin_card_tx" as const, _side: "out" as const }));

    // 자동분류
    const classified = [...bankIn, ...bankOut, ...cardTx].map((r) => ({ ...r, _cls: classify(r, r._side) }));

    // 이음로직스 제외 옵션
    const filtered = excludeEum ? classified.filter((r) => rootOf(r._cls.code) !== "eumlogics") : classified;

    // 자동 집계 (account code → amount/count)
    const acc: Record<string, { amount: number; count: number }> = {};
    for (const r of filtered) {
      const code = r._cls.code;
      if (!acc[code]) acc[code] = { amount: 0, count: 0 };
      acc[code].amount += r.amount;
      acc[code].count++;
    }

    // settlements/supplier_settlements 에서 selling.*, cogs.supplier 합산
    // (이건 bank flow 가 아니라 admin DB 의 정산 데이터에서 직접 가져옴)
    let pgFee = 0, tpl = 0, influencer = 0, cogsSupplier = 0;
    const monthMatch = (period: string) => !month || period === `${year}-${month}`;
    for (const s of (stR.data ?? []) as { period: string; pg_fee: number; tpl_cost: number; influencer_amount: number; total_cogs: number }[]) {
      if (!monthMatch(s.period)) continue;
      pgFee += s.pg_fee || 0;
      tpl += s.tpl_cost || 0;
      influencer += s.influencer_amount || 0;
    }
    for (const s of (ssR.data ?? []) as { period: string; total_amount: number }[]) {
      if (!monthMatch(s.period)) continue;
      cogsSupplier += s.total_amount || 0;
    }
    if (pgFee) acc["selling.pg_fee"] = { amount: pgFee, count: (acc["selling.pg_fee"]?.count || 0) + 1 };
    if (tpl) acc["selling.tpl"] = { amount: tpl, count: (acc["selling.tpl"]?.count || 0) + 1 };
    if (influencer) acc["selling.influencer"] = { amount: influencer, count: (acc["selling.influencer"]?.count || 0) + 1 };
    if (cogsSupplier) acc["cogs.supplier"] = { amount: cogsSupplier, count: (acc["cogs.supplier"]?.count || 0) + 1 };

    // 트리 만들기 (depth 0 = depth 1 자식 합 + 자체. depth 1 = depth 2 자식 합 + 자체)
    const tree = ACCOUNTS.map((a) => ({ ...a, amount: acc[a.code]?.amount || 0, count: acc[a.code]?.count || 0, self_amount: acc[a.code]?.amount || 0 }));
    // 합산: depth 2 → depth 1 → depth 0
    const byCode = Object.fromEntries(tree.map((a) => [a.code, a]));
    for (const node of tree) {
      if (node.depth === 2) {
        const parent = node.code.split(".").slice(0, 2).join(".");
        if (byCode[parent]) byCode[parent].amount += node.amount;
      }
    }
    for (const node of tree) {
      if (node.depth === 1) {
        const parent = node.code.split(".")[0];
        if (byCode[parent] && parent !== node.code) byCode[parent].amount += node.amount;
      }
    }

    // KPI
    const get = (code: string) => byCode[code]?.amount || 0;
    const sales = get("sales");
    const cogs = get("cogs");
    const selling = get("selling");
    const ga = get("ga");
    const tax = get("tax");
    const eum = get("eumlogics");
    const nonop = get("nonop");
    const op_profit = sales - cogs - selling - ga - tax;

    // 미분류 거래 (UI 수동 분류용)
    const unclassified = filtered
      .filter((r) => r._cls.code === "unclassified" || r._cls.code === "sales.misc" || r._cls.code === "ga.card")
      .map((r) => ({
        id: r.id, table: r._table, side: r._side,
        date: r.date, partner: r.partner, descr: r.descr, memo: r.memo,
        amount: r.amount, current_code: r._cls.code, auto: r._cls.auto,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 500);

    return NextResponse.json({
      period: { year: Number(year), month: month || null, exclude_eum: excludeEum },
      kpi: { sales, cogs, selling, ga, tax, eumlogics: eum, nonop, op_profit },
      tree,
      unclassified,
      sources: {
        bank_in: bankIn.length, bank_out: bankOut.length, card_tx: cardTx.length,
        settlements: (stR.data ?? []).length, supplier_settlements: (ssR.data ?? []).length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
