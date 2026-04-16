import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { generateOrderCsv, enrichWithTpCode } from "@/lib/purchaseOrderCsv";

/**
 * GET /api/supplier-portal/download — 발주서 CSV 다운로드
 * ?po_number=xxx&password=xxx
 *
 * 공급사별 po_config가 있으면 해당 양식으로, 없으면 기본 양식으로 생성.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const poNumber = searchParams.get("po_number");
  const password = searchParams.get("password");

  if (!poNumber || !password) {
    return NextResponse.json({ error: "po_number, password 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 인증
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

  // 주문 목록
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

  // 공급사 po_config 조회
  let poConfig = null;
  try {
    const { data: supplierData } = await sb
      .from("suppliers")
      .select("po_config")
      .eq("id", po.supplier_id)
      .single();
    poConfig = supplierData?.po_config || null;
  } catch { /* po_config 컬럼 미존재 시 무시 */ }

  const enriched = await enrichWithTpCode(sb, orders);
  const csv = generateOrderCsv(enriched, poConfig);
  const filename = `발주서_${poNumber}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
