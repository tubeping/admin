import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import ExcelJS from "exceljs";

const CH_LABEL: Record<string, string> = {
  cafe24: "자사몰", phone: "전화", sms: "문자", sample: "샘플", group: "공구", gift: "증정",
};

// 색상 팔레트
const C = {
  brand: "C41E1E",
  headerBg: "2B3A67",
  headerFont: "FFFFFF",
  sectionBg: "F0F4FF",
  sectionFont: "2B3A67",
  totalBg: "E8EDF5",
  lightGray: "F9FAFB",
  border: "D1D5DB",
  green: "16A34A",
  red: "DC2626",
};

function border(style: "thin" | "medium" = "thin"): Partial<ExcelJS.Borders> {
  const s = { style, color: { argb: C.border } };
  return { top: s, bottom: s, left: s, right: s };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
  const { id } = await params;
  const sb = getServiceClient();

  const { data: settlement } = await sb
    .from("settlements")
    .select("*, stores(name, mall_id, settlement_type, influencer_rate, company_rate)")
    .eq("id", id)
    .single();

  if (!settlement) {
    return NextResponse.json({ error: "정산을 찾을 수 없습니다" }, { status: 404 });
  }

  const { data: items } = await sb
    .from("settlement_items")
    .select("*")
    .eq("settlement_id", id)
    .order("order_date", { ascending: true });

  const s = settlement;
  const store = s.stores as Record<string, unknown>;
  const storeName = (store?.name as string) || "판매자";
  const infPct = s.snap_influencer_rate ?? 70;
  const coPct = s.snap_company_rate ?? 30;
  const sType = s.snap_settlement_type || "사업자";

  // ── Workbook 생성 ──
  const wb = new ExcelJS.Workbook();
  wb.creator = "TubePing Admin";

  // ═══════════════════════════════════════
  // Sheet 1: 정산요약
  // ═══════════════════════════════════════
  const ws1 = wb.addWorksheet("정산요약");
  ws1.getColumn(1).width = 28;
  ws1.getColumn(2).width = 18;

  // 타이틀
  let r = 1;
  ws1.mergeCells(r, 1, r, 2);
  const titleCell = ws1.getCell(r, 1);
  titleCell.value = `${storeName} 정산서`;
  titleCell.font = { size: 18, bold: true, color: { argb: C.brand } };
  titleCell.alignment = { vertical: "middle" };
  ws1.getRow(r).height = 30;

  r++;
  ws1.mergeCells(r, 1, r, 2);
  const subCell = ws1.getCell(r, 1);
  subCell.value = `정산기간: ${s.start_date} ~ ${s.end_date}  |  ${sType}  |  ${infPct}:${coPct} 분배`;
  subCell.font = { size: 10, color: { argb: "6B7280" } };

  // 섹션 헬퍼
  function addSection(label: string) {
    r += 2;
    ws1.mergeCells(r, 1, r, 2);
    const c = ws1.getCell(r, 1);
    c.value = label;
    c.font = { size: 11, bold: true, color: { argb: C.sectionFont } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.sectionBg } };
    c.border = border();
    ws1.getCell(r, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.sectionBg } };
    ws1.getCell(r, 2).border = border();
  }

  function addRow(label: string, value: number | string, opts?: { bold?: boolean; highlight?: boolean; sub?: boolean; negative?: boolean }) {
    r++;
    const cA = ws1.getCell(r, 1);
    const cB = ws1.getCell(r, 2);
    cA.value = label;
    cA.font = { size: 10, bold: opts?.bold, color: { argb: opts?.sub ? "9CA3AF" : "374151" } };
    cA.border = border();

    if (typeof value === "number") {
      cB.value = value;
      cB.numFmt = "#,##0";
      const isNeg = value < 0 || opts?.negative;
      cB.font = { size: 10, bold: opts?.bold, color: { argb: isNeg ? C.red : "374151" } };
    } else {
      cB.value = value;
      cB.font = { size: 10, bold: opts?.bold };
    }
    cB.alignment = { horizontal: "right" };
    cB.border = border();

    if (opts?.highlight) {
      cA.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.totalBg } };
      cB.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.totalBg } };
    }
  }

  // 매출
  addSection("매출");
  addRow("자사몰 매출", s.cafe24_sales);
  if (s.phone_sales > 0) addRow("전화주문 매출", s.phone_sales);
  if (s.refund_amount !== 0) addRow("환불/반품", s.refund_amount, { negative: true });
  addRow("순매출", s.total_sales, { bold: true, highlight: true });

  // 비용
  addSection("비용");
  addRow(`PG수수료 (${s.snap_pg_fee_rate}%)`, s.pg_fee);
  if (s.cogs_exempt > 0) {
    addRow("제품원가 (과세)", s.cogs_taxable);
    addRow("제품원가 (면세)", s.cogs_exempt);
    addRow("  면세 VAT 10%", s.cogs_exempt_vat, { sub: true });
  } else {
    addRow("제품원가", s.total_cogs);
  }
  if (s.ship_exempt > 0) {
    addRow("배송비 (과세)", s.ship_taxable);
    addRow("배송비 (면세)", s.ship_exempt);
    addRow("  면세 VAT 10%", s.ship_exempt_vat, { sub: true });
  } else {
    addRow("배송비", s.total_shipping);
  }
  if (s.tpl_cost > 0) addRow("3PL 물류비", s.tpl_cost);
  if (s.other_cost > 0) addRow("기타비용", s.other_cost);
  if (s.vat_amount > 0) addRow("부가세 (10%)", s.vat_amount);
  addRow("총비용", s.total_cost, { bold: true, highlight: true });

  // 순익
  addSection("순익");
  addRow("순익", s.net_profit, { bold: true });
  addRow("순익률", `${s.profit_rate}%`);

  // 수익분배
  addSection(`수익 분배 (${infPct}:${coPct})`);
  addRow(`${storeName} 정산금 (${infPct}%)`, s.influencer_amount, { bold: true });
  if (sType === "프리랜서" && s.withholding_tax > 0) {
    addRow("원천세 (3.3%)", -s.withholding_tax, { sub: true, negative: true });
    addRow(`${storeName} 실지급액`, s.influencer_actual, { bold: true, highlight: true });
  }
  addRow(`신산애널리틱스 (${coPct}%)`, s.company_amount);

  // ═══════════════════════════════════════
  // Sheet 2: 주문상세
  // ═══════════════════════════════════════
  const ws2 = wb.addWorksheet("주문상세");
  const orderHeaders = [
    "구분", "판매방식", "주문번호", "주문일", "상품명", "옵션", "수량",
    "단가", "상품금액", "배송비", "쿠폰할인", "앱할인", "추가할인", "정산매출",
    "공급가", "공급배송비", "순익", "과세구분", "공급사",
  ];
  const colWidths = [6, 8, 22, 12, 40, 20, 6, 10, 12, 10, 10, 10, 10, 12, 10, 10, 10, 8, 14];

  // 헤더
  const hRow = ws2.addRow(orderHeaders);
  hRow.height = 24;
  hRow.eachCell((cell, colNumber) => {
    cell.font = { size: 10, bold: true, color: { argb: C.headerFont } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headerBg } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border();
    ws2.getColumn(colNumber).width = colWidths[colNumber - 1] || 10;
  });

  // 자동필터
  ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 19 } };

  // 데이터 행
  (items || []).forEach((item: Record<string, unknown>, idx: number) => {
    const qty = (item.quantity as number) || 1;
    const price = (item.product_price as number) || 0;
    const settledAmt = (item.settled_amount as number) || 0;
    const supTotal = (item.supply_total as number) || 0;
    const supShip = (item.supply_shipping as number) || 0;
    const profit = settledAmt - supTotal - supShip;

    const row = ws2.addRow([
      item.item_type,
      CH_LABEL[(item.sales_channel as string)] || (item.sales_channel as string) || "기타",
      item.cafe24_order_id,
      ((item.order_date as string) || "").slice(0, 10),
      item.product_name,
      item.option_text || "",
      qty,
      price,
      price * qty,
      (item.shipping_fee as number) || 0,
      (item.coupon_discount as number) || 0,
      (item.app_discount as number) || 0,
      (item.additional_discount as number) || 0,
      settledAmt,
      supTotal,
      supShip,
      profit,
      item.tax_type,
      item.supplier_name || "",
    ]);

    // 교차행 색상
    const isOdd = idx % 2 === 1;
    row.eachCell((cell, colNumber) => {
      cell.font = { size: 9 };
      cell.border = border();
      if (isOdd) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.lightGray } };
      }
      // 숫자 포맷 (8~17열)
      if (colNumber >= 8 && colNumber <= 17) {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
      }
    });

    // 순익 색상
    const profitCell = row.getCell(17);
    profitCell.font = {
      size: 9,
      color: { argb: profit >= 0 ? C.green : C.red },
      bold: true,
    };
  });

  // 헤더 고정
  ws2.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

  // ═══════════════════════════════════════
  // Sheet 3: 상품별매출
  // ═══════════════════════════════════════
  const ws3 = wb.addWorksheet("상품별매출");
  const prodHeaders = ["상품명", "판매수량", "매출", "매입가합계", "배송비합계", "이익", "마진율"];
  const prodWidths = [50, 10, 14, 14, 14, 14, 10];

  const pH = ws3.addRow(prodHeaders);
  pH.height = 24;
  pH.eachCell((cell, colNumber) => {
    cell.font = { size: 10, bold: true, color: { argb: C.headerFont } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headerBg } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border();
    ws3.getColumn(colNumber).width = prodWidths[colNumber - 1] || 10;
  });

  // 상품별 요약 계산
  const productMap: Record<string, { name: string; qty: number; sales: number; cogs: number; ship: number }> = {};
  for (const item of (items || []) as Record<string, unknown>[]) {
    const key = (item.product_name as string) || "기타";
    if (!productMap[key]) productMap[key] = { name: key, qty: 0, sales: 0, cogs: 0, ship: 0 };
    productMap[key].qty += (item.quantity as number) || 0;
    productMap[key].sales += (item.settled_amount as number) || 0;
    productMap[key].cogs += (item.supply_total as number) || 0;
    productMap[key].ship += (item.supply_shipping as number) || 0;
  }

  const products = Object.values(productMap)
    .filter(p => p.sales > 0 || p.qty > 0)
    .sort((a, b) => b.sales - a.sales);

  products.forEach((p, idx) => {
    const profit = p.sales - p.cogs - p.ship;
    const margin = p.sales > 0 ? Math.round((profit / p.sales) * 1000) / 10 : 0;
    const row = ws3.addRow([p.name, p.qty, p.sales, p.cogs, p.ship, profit, margin / 100 /* 0.0% format needs 0-1 */]);

    const isOdd = idx % 2 === 1;
    row.eachCell((cell, colNumber) => {
      cell.font = { size: 9 };
      cell.border = border();
      if (isOdd) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.lightGray } };
      if (colNumber >= 2 && colNumber <= 6) {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
      }
      if (colNumber === 7) {
        cell.numFmt = "0.0%";
        cell.alignment = { horizontal: "right" };
        cell.font = { size: 9, bold: true, color: { argb: margin >= 30 ? C.green : margin < 15 ? C.red : "374151" } };
      }
    });
  });

  ws3.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

  // ── Buffer 생성 및 응답 ──
  const buffer = await wb.xlsx.writeBuffer();
  const filename = encodeURIComponent(`${storeName}_${s.period}_정산서.xlsx`);

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  } catch (err) {
    console.error("Excel generation error:", err);
    return NextResponse.json({ error: "Excel 생성 실패" }, { status: 500 });
  }
}
