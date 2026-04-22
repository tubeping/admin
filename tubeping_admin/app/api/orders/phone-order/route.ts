import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";

/**
 * POST /api/orders/phone-order — 전화주문 1건 등록 + 고유 입금액 자동 부여
 *
 * body: {
 *   store_id?: string,   // 없으면 '전화주문' pseudo store
 *   product_id?: string, // tp_code로 찾은 products.id (우선)
 *   product_name: string,
 *   option_text?: string,
 *   quantity: number,
 *   unit_price: number,  // 1개 단가
 *   buyer_name?: string,
 *   buyer_phone?: string,
 *   receiver_name: string,
 *   receiver_phone: string,
 *   receiver_address: string,
 *   receiver_zipcode?: string,
 *   memo?: string,
 * }
 *
 * 흐름:
 *   1. 전화주문 스토어 확보
 *   2. cafe24_order_id 생성 (P + YYYYMMDD-NNN)
 *   3. 고유 payment_amount 계산 (끝자리 0~9)
 *   4. order_amount = unit_price * quantity (깔끔한 값)
 *   5. 공급사 자동 배정 (tp_code 기반)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    store_id: storeIdInput,
    product_name,
    option_text,
    quantity,
    unit_price,
    buyer_name,
    buyer_phone,
    receiver_name,
    receiver_phone,
    receiver_address,
    receiver_zipcode,
    memo,
  } = body;

  if (!product_name || !receiver_name || !receiver_phone || !receiver_address) {
    return NextResponse.json({ error: "상품명, 수령인, 연락처, 주소 필수" }, { status: 400 });
  }
  if (!quantity || quantity < 1 || !unit_price || unit_price < 0) {
    return NextResponse.json({ error: "수량/단가가 유효하지 않음" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 전화주문 스토어 확보
  let storeId = storeIdInput;
  if (!storeId) {
    const { data: phoneStore } = await sb
      .from("stores")
      .select("id")
      .eq("name", "전화주문")
      .maybeSingle();
    if (phoneStore) storeId = phoneStore.id;
    else {
      const { data: created } = await sb
        .from("stores")
        .insert({ mall_id: `manual_${Date.now()}`, name: "전화주문", status: "active" })
        .select("id")
        .single();
      storeId = created!.id;
    }
  }

  // 2. cafe24_order_id 생성 — PT-YYYYMMDD-NNN 형식 (전화주문 전용)
  const today = new Date();
  const kst = new Date(today.getTime() + 9 * 3600000);
  const ymd = kst.toISOString().slice(0, 10).replace(/-/g, "");
  const { count } = await sb
    .from("orders")
    .select("id", { count: "exact", head: true })
    .like("cafe24_order_id", `PT-${ymd}-%`);
  const seq = String((count || 0) + 1).padStart(3, "0");
  const orderId = `PT-${ymd}-${seq}`;

  // 3. 금액 계산 및 고유 payment_amount 부여
  const baseAmount = unit_price * quantity;
  const { data: sameAmount } = await sb
    .from("orders")
    .select("payment_amount")
    .eq("shipping_status", "pending")
    .gte("payment_amount", baseAmount)
    .lte("payment_amount", baseAmount + 9);
  const usedOffsets = new Set(
    (sameAmount || []).map((o) => (o.payment_amount || 0) - baseAmount)
  );
  let offset = 0;
  for (let n = 0; n <= 9; n++) {
    if (!usedOffsets.has(n)) { offset = n; break; }
  }
  const paymentAmount = baseAmount + offset;

  // 4. insert
  const { data: inserted, error } = await sb
    .from("orders")
    .insert({
      store_id: storeId,
      cafe24_order_id: orderId,
      cafe24_order_item_code: orderId,
      order_date: new Date().toISOString(),
      product_name,
      option_text: option_text || "",
      quantity,
      product_price: unit_price,
      order_amount: baseAmount,
      payment_amount: paymentAmount,
      buyer_name: buyer_name || receiver_name,
      buyer_phone: buyer_phone || receiver_phone,
      receiver_name,
      receiver_phone,
      receiver_address,
      receiver_zipcode: receiver_zipcode || "",
      memo: memo || "",
      shipping_status: "pending",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 5. 공급사 자동 배정
  try {
    await autoAssignSuppliers(sb, { orderIds: [inserted!.id] });
  } catch { /* 매칭 실패해도 주문은 유지 */ }

  return NextResponse.json({
    id: inserted!.id,
    order_id: orderId,
    payment_amount: paymentAmount,
    base_amount: baseAmount,
  });
}
