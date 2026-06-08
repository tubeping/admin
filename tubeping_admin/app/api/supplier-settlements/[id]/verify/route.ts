import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { loadSupplyContext, computeItem, periodToRange } from "@/lib/settlement-engine";
import { parseSupplierFile, verify, type TupingItem } from "@/lib/supplierVerify";

// 대조는 항상 최신 주문/공급가를 읽어 상세 화면과 숫자가 일치해야 한다.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/supplier-settlements/[id]/verify
 * 공급사가 보낸 거래명세서/엑셀(FormData: file)을 업로드해 튜핑 집계와 대조한다.
 *
 * 튜핑 집계는 상세(GET [id])와 동일하게 출고일(shipped_at) 기준, 해당 공급사 매출분만 사용한다.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const sb = getServiceClient();

  // 1) 정산 헤더 (period, supplier_id)
  const { data: ss, error: ssErr } = await sb
    .from("supplier_settlements")
    .select("id, supplier_id, supplier_name, period")
    .eq("id", id)
    .single();
  if (ssErr || !ss) {
    return NextResponse.json({ error: "정산을 찾을 수 없습니다" }, { status: 404 });
  }

  // 2) 업로드 파일
  let file: File | null = null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
  } catch {
    return NextResponse.json({ error: "파일 업로드 형식 오류" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
  }

  // 3) 파싱
  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseSupplierFile(buf);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error || "파일 파싱 실패" }, { status: 400 });
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "파일에서 유효한 데이터 행을 찾지 못했습니다 (상품명/수량 확인)" },
      { status: 400 }
    );
  }

  // 4) 튜핑 집계 (상세 GET 과 동일 로직: 출고일 기준 + 해당 공급사 매출분)
  const range = periodToRange(ss.period);
  if (!range) {
    return NextResponse.json({ error: "period 형식 오류" }, { status: 400 });
  }

  let oq = sb
    .from("orders")
    .select("*, suppliers!supplier_id(id, name)")
    .gte("shipped_at", range.startDate)
    .lte("shipped_at", range.endDate + "T23:59:59");
  if (ss.supplier_id) oq = oq.eq("supplier_id", ss.supplier_id);
  else oq = oq.is("supplier_id", null);

  const { data: orders, error: ordErr } = await oq;
  if (ordErr) {
    return NextResponse.json({ error: ordErr.message }, { status: 500 });
  }

  const tupingItems: TupingItem[] = [];
  if (orders && orders.length > 0) {
    const supplyCtx = await loadSupplyContext(sb, orders);
    for (const o of orders) {
      const it = computeItem(o, supplyCtx);
      if (it.item_type !== "매출") continue;
      tupingItems.push({
        cafe24_order_id: it.cafe24_order_id,
        cafe24_order_item_code: it.cafe24_order_item_code,
        product_name: it.product_name,
        quantity: it.quantity,
        supply_total: it.supply_total,
        supply_shipping: it.supply_shipping,
        tax_type: it.tax_type,
      });
    }
  }

  // 5) 대조
  const result = verify(tupingItems, parsed.rows, parsed.columns || {});

  return NextResponse.json({
    settlement: {
      id: ss.id,
      supplier_name: ss.supplier_name,
      period: ss.period,
    },
    file: {
      name: file.name,
      sheet: parsed.sheetName,
      headerRow: (parsed.headerRow ?? 0) + 1, // 1-based 표시
      columns: parsed.columns,
      dataRows: parsed.totalDataRows,
      skipped: parsed.skippedRows,
      parsedRows: parsed.rows.length,
    },
    result,
  });
}
