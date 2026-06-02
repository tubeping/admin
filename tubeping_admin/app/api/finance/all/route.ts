import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/finance/all — 재무 5종 데이터 전체 (대시보드/매출/매입/손익 엔진용)
 * DB snake_case → 원본 hub 로직이 기대하는 camelCase 로 매핑.
 */
export const dynamic = "force-dynamic";

async function fetchAll(table: string, cols: string) {
  const sb = getServiceClient();
  // Supabase 기본 1000행 제한 회피 — range 로 전량 수집
  const out: Record<string, unknown>[] = [];
  let from = 0;
  const step = 1000;
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).order("date", { ascending: true }).range(from, from + step - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < step) break;
    from += step;
  }
  return out;
}

type Inv = { date: string; partner: string | null; type: string | null; amount: number; supply: number; tax: number; category: string | null; corp_num: string | null; descr: string | null; memo: string | null };
type Cash = { date: string; partner: string | null; amount: number; category: string | null; corp_num: string | null; descr: string | null; memo: string | null; balance?: number | null };

const mapInv = (r: Inv) => ({ date: r.date, partner: r.partner, type: r.type, amount: r.amount, supply: r.supply, tax: r.tax, category: r.category, corpNum: r.corp_num, desc: r.descr, memo: r.memo });
const mapCash = (r: Cash) => ({ date: r.date, partner: r.partner, amount: r.amount, category: r.category, corpNum: r.corp_num, desc: r.descr, memo: r.memo, balance: r.balance });

export async function GET() {
  try {
    const [sales, purchases, cardTx, bankIn, bankOut] = await Promise.all([
      fetchAll("fin_sales", "date,partner,type,amount,supply,tax,category,corp_num,descr,memo"),
      fetchAll("fin_purchases", "date,partner,type,amount,supply,tax,category,corp_num,descr,memo"),
      fetchAll("fin_card_tx", "date,partner,amount,category,corp_num,descr,memo"),
      fetchAll("fin_bank_in", "date,partner,amount,balance,category,corp_num,descr,memo"),
      fetchAll("fin_bank_out", "date,partner,amount,balance,category,corp_num,descr,memo"),
    ]);
    return NextResponse.json({
      company: "신산애널리틱스",
      business: "인플루언서 쇼핑몰 운영대행",
      sales: (sales as unknown as Inv[]).map(mapInv),
      purchases: (purchases as unknown as Inv[]).map(mapInv),
      cardTx: (cardTx as unknown as Cash[]).map(mapCash),
      bankIn: (bankIn as unknown as Cash[]).map(mapCash),
      bankOut: (bankOut as unknown as Cash[]).map(mapCash),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
