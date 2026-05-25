import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";
import { autoVerifyAddresses } from "@/lib/autoVerifyAddresses";

/**
 * POST /api/orders/manual-register — 수기/OCR 주문 일괄 등록
 *
 * body: {
 *   store_id: string,          // 필수: 판매사
 *   sales_channel?: string,    // 'sample' | 'group' | 'etc' | null
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
  const { orders: items, store_id, sales_channel } = body;

  if (!store_id) {
    return NextResponse.json({ error: "판매사를 선택해주세요" }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "등록할 주문이 없습니다" }, { status: 400 });
  }

  const sb = getServiceClient();

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
    if (!o.receiver_name && !o.buyer_name) {
      errors.push(`${o.product_name}: 주문자/수취인 누락`);
      continue;
    }
    if (!o.receiver_phone && !o.buyer_phone) {
      errors.push(`${o.product_name}: 연락처 누락`);
      continue;
    }
    if (!o.receiver_address) {
      errors.push(`${o.product_name}: 주소 누락`);
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
        store_id,
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
        receiver_name: o.receiver_name || o.buyer_name || "",
        receiver_phone: o.receiver_phone || o.buyer_phone || "",
        receiver_address: o.receiver_address || "",
        receiver_zipcode: o.receiver_zipcode || "",
        memo: o.memo || "OCR 자동등록",
        shipping_status: "ordered",
        sales_channel: sales_channel || null,
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
    } catch (e) { console.error("[manual-register] auto-assign suppliers failed:", e); }
    try {
      await autoVerifyAddresses(sb, { orderIds: insertedIds });
    } catch (e) { console.error("[manual-register] auto-verify addresses failed:", e); }
  }

  return NextResponse.json({
    success: insertedIds.length,
    insertedIds,
    errors: errors.length > 0 ? errors : undefined,
  });
}
