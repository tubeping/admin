import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { enrichWithTpCode } from "@/lib/purchaseOrderCsv";
import * as XLSX from "xlsx";

/**
 * GET /api/supplier-portal/download — 발주서 xlsx 다운로드
 * ?po_number=xxx&password=xxx
 *
 * 공급사별 po_config가 있으면 해당 양식으로, 없으면 기본 양식으로 생성.
 * xlsx 형식 — 모든 셀 텍스트 서식 (앞자리 0 유지, 수식 불필요)
 */

// 판매사 키워드 제거
const SELLER_KEYWORDS = ["뉴스엔진", "완선", "캡틴", "빵시기", "킬링타임", "shinsan", "comicmart", "뉴스반장"];
function cleanProductName(name: string): string {
  let cleaned = name;
  for (const kw of SELLER_KEYWORDS) {
    cleaned = cleaned.replace(new RegExp(kw, "gi"), "");
  }
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const poNumber = searchParams.get("po_number");
  const password = searchParams.get("password");

  if (!poNumber || !password) {
    return NextResponse.json({ error: "po_number, password 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: po } = await sb
    .from("purchase_orders")
    .select("id, supplier_id, access_password, access_expires_at")
    .eq("po_number", poNumber)
    .single();

  if (!po) {
    return NextResponse.json({ error: "발주서를 찾을 수 없습니다" }, { status: 404 });
  }
  if (po.access_password !== password) {
    return NextResponse.json({ error: "비밀번호 불일치" }, { status: 401 });
  }

  const { data: orders } = await sb
    .from("orders")
    .select(
      "store_id, cafe24_order_id, cafe24_order_item_code, cafe24_product_no, product_name, option_text, quantity, order_date, buyer_name, buyer_phone, receiver_name, receiver_phone, receiver_address, receiver_zipcode, memo, shipping_company, tracking_number"
    )
    .eq("purchase_order_id", po.id)
    .order("cafe24_order_id", { ascending: true });

  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: "주문이 없습니다" }, { status: 404 });
  }

  // po_config 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let poConfig: any = null;
  try {
    const { data: supplierData } = await sb
      .from("suppliers")
      .select("po_config")
      .eq("id", po.supplier_id)
      .single();
    poConfig = supplierData?.po_config || null;
  } catch { /* ignore */ }

  const enriched = await enrichWithTpCode(sb, orders);
  const hideSeller = poConfig?.hide_seller ?? true;

  // 컬럼/매핑 결정
  let columns: string[];
  let columnMap: Record<string, string>;

  if (poConfig?.columns && poConfig?.column_map) {
    columns = poConfig.columns;
    columnMap = poConfig.column_map;
  } else {
    columns = ["주문번호", "주문상품고유번호", "상품코드", "상품명", "옵션", "수량", "수령자", "연락처", "배송지", "우편번호", "배송메시지", "택배사", "배송번호"];
    columnMap = {
      "주문번호": "cafe24_order_id",
      "주문상품고유번호": "cafe24_order_item_code",
      "상품코드": "tp_code",
      "상품명": "product_name",
      "옵션": "option_text",
      "수량": "quantity",
      "수령자": "receiver_name",
      "연락처": "receiver_phone",
      "배송지": "receiver_address",
      "우편번호": "receiver_zipcode",
      "배송메시지": "memo",
      "택배사": "shipping_company",
      "배송번호": "tracking_number",
    };
  }

  // 데이터 행 생성
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = enriched.map((o: any) => {
    const productName = hideSeller ? cleanProductName(o.product_name || "") : (o.product_name || "");
    const fieldMap: Record<string, string> = {
      cafe24_order_id: o.cafe24_order_id || "",
      cafe24_order_item_code: o.cafe24_order_item_code || "",
      cafe24_product_no: String(o.cafe24_product_no || ""),
      tp_code: o.tp_code || "",
      product_name: productName,
      option_text: o.option_text || "",
      quantity: String(o.quantity || 1),
      order_date: o.order_date?.slice(0, 10) || "",
      buyer_name: o.buyer_name || "",
      buyer_phone: o.buyer_phone || "",
      receiver_name: o.receiver_name || "",
      receiver_phone: o.receiver_phone || "",
      receiver_address: o.receiver_address || "",
      receiver_zipcode: o.receiver_zipcode || "",
      memo: o.memo || "",
      shipping_company: o.shipping_company || "",
      tracking_number: o.tracking_number || "",
    };

    const row: Record<string, string> = {};
    for (const col of columns) {
      const mapping = columnMap[col] || "";
      if (mapping.startsWith("_fixed:")) row[col] = mapping.slice(7);
      else if (mapping === "_today") row[col] = new Date().toISOString().slice(0, 10);
      else row[col] = fieldMap[mapping] || "";
    }
    return row;
  });

  // xlsx 생성 — 모든 셀을 문자열로
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns });

  // 셀 서식을 전부 텍스트(@)로 설정
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (cell) {
        cell.t = "s"; // 문자열 타입 강제
        cell.z = "@"; // 텍스트 서식
        if (cell.v === undefined || cell.v === null || cell.v === "None") cell.v = "";
      else cell.v = String(cell.v);
      }
    }
  }

  // 컬럼 너비 자동
  ws["!cols"] = columns.map((col) => {
    const maxLen = Math.max(
      col.length,
      ...rows.map((r) => (r[col] || "").length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "발주서");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const filename = `발주서_${poNumber}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
