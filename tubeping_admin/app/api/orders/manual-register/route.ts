import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";

/**
 * POST /api/orders/manual-register — 수기/OCR 주문 일괄 등록
 *
 * body: {
 *   orders: Array<{
 *     product_name: string,
 *     option_text?: string,
 *     quantity: number,
 *     unit_price?: number,
 *     buyer_name?: string,
 *     buyer_phone?: string,
 *     receiver_name: string,
 *     receiver_phone: string,
 *     receiver_address: string,
 *     receiver_zipcode?: string,
 *     memo?: string,
 *   }>
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { orders: items } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "등록할 주문이 없습니다" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 수기주문 스토어 확보
  let storeId: string;
  const { data: store } = await sb
    .from("stores")
    .select("id")
    .eq("name", "수기주문")
    .maybeSingle();
  if (store) {
    storeId = store.id;
  } else {
    const { data: created } = await sb
      .from("stores")
      .insert({ mall_id: `manual_${Date.now()}`, name: "수기주문", status: "active" })
      .select("id")
      .single();
    storeId = created!.id;
  }

  // 주문번호 prefix: MR-YYYYMMDD-NNN
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600000);
  const ymd = kst.toISOString().slice(0, 10).replace(/-/g, "");
  const { count } = await sb
    .from("orders")
    .select("id", { count: "exact", head: true })
    .like("cafe24_order_id", `MR-${ymd}-%`);
  let seq = (count || 0);

  const insertedIds: string[] = [];
  const errors: string[] = [];

  for (const o of items) {
    if (!o.product_name) {
      errors.push("상품명 누락");
      continue;
    }
    seq++;
    const orderId = `MR-${ymd}-${String(seq).padStart(3, "0")}`;
    const quantity = o.quantity || 1;
    const unitPrice = o.unit_price || o.order_amount || 0;
    const orderAmount = unitPrice * quantity;

    const { data: inserted, error } = await sb
      .from("orders")
      .insert({
        store_id: storeId,
        cafe24_order_id: orderId,
        cafe24_order_item_code: orderId,
        order_date: now.toISOString(),
        product_name: o.product_name,
        option_text: o.option_text || "",
        quantity,
        product_price: unitPrice,
        order_amount: orderAmount,
        buyer_name: o.buyer_name || o.receiver_name || "",
        buyer_phone: o.buyer_phone || o.receiver_phone || "",
        receiver_name: o.receiver_name || o.buyer_name || "미입력",
        receiver_phone: o.receiver_phone || o.buyer_phone || "미입력",
        receiver_address: o.receiver_address || "미입력",
        receiver_zipcode: o.receiver_zipcode || "",
        memo: o.memo || "OCR 자동등록",
        shipping_status: "ordered",
        sales_channel: null,
      })
      .select("id")
      .single();

    if (error) {
      errors.push(`${o.product_name}: ${error.message}`);
    } else {
      insertedIds.push(inserted!.id);
    }
  }

  // 공급사 자동 배정
  if (insertedIds.length > 0) {
    try {
      await autoAssignSuppliers(sb, { orderIds: insertedIds });
    } catch { /* 매칭 실패해도 주문은 유지 */ }
  }

  return NextResponse.json({
    success: insertedIds.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
