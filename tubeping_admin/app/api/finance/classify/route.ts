import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { isValidAccountCode } from "@/lib/finance/accounts";

/**
 * POST /api/finance/classify
 * body: { table: "fin_bank_in"|"fin_bank_out"|"fin_card_tx", id: number, code: string }
 *
 * 사용자가 statement 페이지에서 미분류 거래에 표준 account code 를 수동 부여.
 * fin_bank_in/out/card_tx 의 `category` 컬럼에 account code 를 그대로 저장.
 * 다음 statement 조회 시 classify() 가 category 를 우선 사용해 그 분류가 유지됨.
 */
export const dynamic = "force-dynamic";

const ALLOWED_TABLES = ["fin_bank_in", "fin_bank_out", "fin_card_tx"] as const;
type TableName = typeof ALLOWED_TABLES[number];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { table?: string; id?: number; code?: string };
    const table = body.table as TableName;
    const id = body.id;
    const code = body.code;

    if (!ALLOWED_TABLES.includes(table)) return NextResponse.json({ error: "invalid table" }, { status: 400 });
    if (typeof id !== "number") return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!code || !isValidAccountCode(code)) return NextResponse.json({ error: "invalid account code" }, { status: 400 });

    const sb = getServiceClient();
    const { error } = await sb.from(table).update({ category: code }).eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, table, id, code });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
