import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/finance/invoice-audit?year=2026
 *
 * 정산 자료 ↔ 세금계산서(fin_purchases) 발행 대조.
 *
 * 두 종류의 정산을 검사한다:
 *   1) supplier_settlements (공급사 정산)  — 공급사가 우리에게 세금계산서 발행 → fin_purchases 매입세계 매칭
 *   2) settlements with snap_settlement_type='사업자' (인플루언서 사업자 정산)
 *        — 인플루언서가 우리에게 세금계산서 발행 → fin_purchases 매칭
 *      프리랜서(원천세 3.3%)는 세금계산서 발행 의무 없음 → audit 대상 제외
 *
 * 상태:
 *   ok            정산 invoice_no 있고 fin_purchases 에 금액 매칭 있음
 *   invoiced_only 정산 invoice_no 있으나 fin_purchases 매칭 없음 (홈택스 미반영?)
 *   mismatch      매칭은 있는데 금액 차이 5% 초과
 *   db_only       정산 invoice_no 없는데 fin_purchases 에 매칭 있음 (invoice_no 미입력)
 *   missing       정산 invoice_no 없고 fin_purchases 매칭도 없음 (진짜 미발행)
 *   skipped       정산 status 가 sent 이전 — 발행 대상 아님
 */
export const dynamic = "force-dynamic";

type AuditStatus = "ok" | "invoiced_only" | "mismatch" | "db_only" | "missing" | "skipped";

interface Row {
  kind: "supplier" | "influencer";
  source_id: string;
  period: string;
  partner_name: string;
  expected_supply: number;        // 정산 기준 공급가
  expected_total: number;         // 정산 기준 합계(공급가+VAT 추정치)
  status_settlement: string;      // 정산 자체의 status
  invoice_no: string | null;
  invoiced_at: string | null;
  matched_invoice: { date: string; partner: string; supply: number; tax: number; amount: number } | null;
  status: AuditStatus;
  diff_amount: number;            // 매칭된 인보이스 - 기대 합계
  memo: string | null;
}

const norm = (s: string | null | undefined) =>
  (s || "").replace(/\s/g, "").replace(/\(주\)|㈜|주식회사/g, "").toLowerCase();
const tokens = (name: string | null | undefined) =>
  norm(name).split(/[()\[\]{},/.\-]/).filter((p) => p.length >= 2);

function findInvoice(
  partnerName: string,
  expectedAmount: number,
  pool: { date: string; partner: string | null; supply: number; tax: number; amount: number; _matched?: boolean }[],
  period: string,
): { date: string; partner: string; supply: number; tax: number; amount: number } | null {
  const toks = tokens(partnerName);
  const tol = Math.max(100, Math.round(expectedAmount * 0.05)); // ±5% or 100원

  // 1) 이름토큰 + 금액±5% 동시 매칭
  for (const x of pool) {
    if (x._matched) continue;
    const t = norm(x.partner);
    const nameOk = !!toks.length && toks.some((tk) => t.includes(tk));
    if (nameOk && Math.abs(x.amount - expectedAmount) <= tol) {
      x._matched = true;
      return { date: x.date, partner: x.partner || "", supply: x.supply, tax: x.tax, amount: x.amount };
    }
  }
  // 2) 같은 정산기간 ±1개월 + 이름토큰만 매칭 → mismatch
  const [py, pm] = period.split("-").map(Number);
  const lo = new Date(py, pm - 2, 1).toISOString().slice(0, 7);
  const hi = new Date(py, pm + 0, 31).toISOString().slice(0, 7);
  for (const x of pool) {
    if (x._matched) continue;
    const m = x.date.slice(0, 7);
    if (m < lo || m > hi) continue;
    const t = norm(x.partner);
    if (!!toks.length && toks.some((tk) => t.includes(tk))) {
      x._matched = true;
      return { date: x.date, partner: x.partner || "", supply: x.supply, tax: x.tax, amount: x.amount };
    }
  }
  return null;
}

function decide(invNo: string | null, matched: object | null, diffPct: number): AuditStatus {
  if (matched && invNo) return diffPct <= 5 ? "ok" : "mismatch";
  if (matched && !invNo) return "db_only";
  if (!matched && invNo) return "invoiced_only";
  return "missing";
}

export async function GET(req: NextRequest) {
  const year = req.nextUrl.searchParams.get("year") || String(new Date().getFullYear());
  try {
    const sb = getServiceClient();

    const [ssR, stR, fpR] = await Promise.all([
      sb.from("supplier_settlements")
        .select("id, supplier_name, period, status, total_supply, total_shipping, total_amount, invoice_no, invoiced_at, memo")
        .like("period", `${year}-%`),
      sb.from("settlements")
        .select("id, store_id, period, status, snap_settlement_type, influencer_amount, memo, stores:store_id(name, bank_holder, business_no)")
        .like("period", `${year}-%`)
        .eq("snap_settlement_type", "사업자"),
      sb.from("fin_purchases")
        .select("date, partner, supply, tax, amount")
        .gte("date", `${year}-01-01`)
        .lte("date", `${year}-12-31`),
    ]);
    if (ssR.error) throw new Error(ssR.error.message);
    if (stR.error) throw new Error(stR.error.message);
    if (fpR.error) throw new Error(fpR.error.message);

    const pool = ((fpR.data ?? []) as { date: string; partner: string | null; supply: number; tax: number; amount: number }[])
      .map((x) => ({ ...x, _matched: false }));

    const rows: Row[] = [];

    // 1) 공급사 정산
    for (const s of (ssR.data ?? []) as {
      id: string; supplier_name: string; period: string; status: string;
      total_supply: number; total_shipping: number; total_amount: number;
      invoice_no: string | null; invoiced_at: string | null; memo: string | null;
    }[]) {
      const sendable = ["sent", "confirmed", "invoiced", "paid"].includes(s.status);
      const expSupply = (s.total_supply || 0) + (s.total_shipping || 0);
      const expTotal = s.total_amount || Math.round(expSupply * 1.1);
      if (!sendable) {
        rows.push({
          kind: "supplier", source_id: s.id, period: s.period, partner_name: s.supplier_name,
          expected_supply: expSupply, expected_total: expTotal, status_settlement: s.status,
          invoice_no: s.invoice_no, invoiced_at: s.invoiced_at, matched_invoice: null,
          status: "skipped", diff_amount: 0, memo: s.memo,
        });
        continue;
      }
      const matched = findInvoice(s.supplier_name, expTotal, pool, s.period);
      const diff = matched ? matched.amount - expTotal : 0;
      const diffPct = expTotal > 0 ? Math.abs(diff) / expTotal * 100 : 0;
      rows.push({
        kind: "supplier", source_id: s.id, period: s.period, partner_name: s.supplier_name,
        expected_supply: expSupply, expected_total: expTotal, status_settlement: s.status,
        invoice_no: s.invoice_no, invoiced_at: s.invoiced_at, matched_invoice: matched,
        status: decide(s.invoice_no, matched, diffPct), diff_amount: diff, memo: s.memo,
      });
    }

    // 2) 인플루언서 사업자 정산
    type StoreJoin = { name?: string | null; bank_holder?: string | null; business_no?: string | null };
    for (const s of (stR.data ?? []) as {
      id: string; period: string; status: string; snap_settlement_type: string;
      influencer_amount: number; memo: string | null; stores: StoreJoin | StoreJoin[] | null;
    }[]) {
      const store = Array.isArray(s.stores) ? s.stores[0] : s.stores;
      const partnerName = store?.bank_holder || store?.name || "(미상)";
      const sendable = ["confirmed", "paid"].includes(s.status);
      const expSupply = s.influencer_amount || 0;
      const expTotal = Math.round(expSupply * 1.1); // 사업자: 공급가 + VAT 10%
      if (!sendable || expSupply <= 0) {
        rows.push({
          kind: "influencer", source_id: s.id, period: s.period, partner_name: partnerName,
          expected_supply: expSupply, expected_total: expTotal, status_settlement: s.status,
          invoice_no: null, invoiced_at: null, matched_invoice: null,
          status: "skipped", diff_amount: 0, memo: s.memo,
        });
        continue;
      }
      const matched = findInvoice(partnerName, expTotal, pool, s.period);
      const diff = matched ? matched.amount - expTotal : 0;
      const diffPct = expTotal > 0 ? Math.abs(diff) / expTotal * 100 : 0;
      // settlements 에는 invoice_no 컬럼 없음 → null 고정
      rows.push({
        kind: "influencer", source_id: s.id, period: s.period, partner_name: partnerName,
        expected_supply: expSupply, expected_total: expTotal, status_settlement: s.status,
        invoice_no: null, invoiced_at: null, matched_invoice: matched,
        status: decide(null, matched, diffPct), diff_amount: diff, memo: s.memo,
      });
    }

    // 요약
    const counters: Record<AuditStatus, number> = { ok: 0, invoiced_only: 0, mismatch: 0, db_only: 0, missing: 0, skipped: 0 };
    let missingAmount = 0, mismatchAmount = 0;
    for (const r of rows) {
      counters[r.status]++;
      if (r.status === "missing") missingAmount += r.expected_total;
      if (r.status === "mismatch") mismatchAmount += Math.abs(r.diff_amount);
    }

    return NextResponse.json({
      summary: {
        year: Number(year),
        total: rows.length,
        by_status: counters,
        missing_amount: missingAmount,
        mismatch_amount: mismatchAmount,
        supplier_count: rows.filter((r) => r.kind === "supplier").length,
        influencer_count: rows.filter((r) => r.kind === "influencer").length,
      },
      rows: rows.sort((a, b) => (b.period + a.partner_name).localeCompare(a.period + b.partner_name)),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
