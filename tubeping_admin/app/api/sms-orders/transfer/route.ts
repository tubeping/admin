import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";
import { autoVerifyAddresses } from "@/lib/autoVerifyAddresses";

/**
 * POST /api/sms-orders/transfer - 문자주문을 orders 테이블로 이관
 * body: { ids: string[] }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { ids } = body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 필수 (배열)" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 문자주문 조회
  const { data: smsOrders, error: fetchErr } = await sb
    .from("sms_orders")
    .select("*")
    .in("id", ids);

  if (fetchErr) {
    return NextResponse.json({ error: `문자주문 조회 실패: ${fetchErr.message}` }, { status: 500 });
  }
  if (!smsOrders || smsOrders.length === 0) {
    return NextResponse.json({ error: "해당 주문을 찾을 수 없습니다." }, { status: 404 });
  }

  const notTransferred = smsOrders.filter((o) => o.status !== "transferred");
  if (notTransferred.length === 0) {
    return NextResponse.json({ transferred: 0, skipped: smsOrders.length, errors: [], details: [] });
  }

  // 2. '문자주문' 스토어 매핑
  let smsStoreId: string | null = null;
  const { data: smsStore } = await sb.from("stores").select("id").eq("name", "문자주문").maybeSingle();
  if (smsStore) {
    smsStoreId = smsStore.id;
  } else {
    const { data: created } = await sb
      .from("stores")
      .insert({ mall_id: `manual_sms_${Date.now()}`, name: "문자주문", status: "active" })
      .select("id")
      .single();
    smsStoreId = created?.id || null;
  }

  if (!smsStoreId) {
    return NextResponse.json({ error: "문자주문 판매처 생성 실패" }, { status: 500 });
  }

  // 3. 이미 이관된 주문번호 체크
  const orderNos = notTransferred.map((o) =>
    o.order_number.startsWith("PS-") ? o.order_number : `PS-${o.order_number}`
  );
  const { data: existing } = await sb
    .from("orders")
    .select("cafe24_order_id")
    .in("cafe24_order_id", orderNos);
  const existingSet = new Set((existing || []).map((e) => e.cafe24_order_id));

  // 4. 상품명 -> 가격 매핑
  const productNames = [...new Set(notTransferred.map((o) => o.product_name.trim()).filter(Boolean))];
  const productPriceMap: Record<string, number> = {};
  if (productNames.length > 0) {
    const { data: products } = await sb
      .from("products")
      .select("product_name, price")
      .in("product_name", productNames);
    for (const p of products || []) {
      if (p.product_name && p.price) productPriceMap[p.product_name.trim()] = p.price;
    }
  }

  // 5. 이관 실행
  let transferred = 0;
  let skipped = 0;
  const insertedIds: string[] = [];
  const transferredSmsOrderIds: string[] = [];
  const details: Array<{ order_number: string; status: string; reason?: string }> = [];

  for (const so of notTransferred) {
    const orderNo = so.order_number.startsWith("PS-") ? so.order_number : `PS-${so.order_number}`;

    if (existingSet.has(orderNo)) {
      skipped++;
      transferredSmsOrderIds.push(so.id);
      details.push({ order_number: so.order_number, status: "이미 이관됨" });
      continue;
    }

    const unitPrice = so.unit_price || productPriceMap[so.product_name.trim()] || 0;
    const qty = so.quantity || 1;
    const orderAmount = unitPrice * qty;
    const isPaid = so.payment_status === "paid";

    const orderDateStr = so.order_date
      ? new Date(so.order_date + "T09:00:00+09:00").toISOString()
      : new Date().toISOString();

    const { data: inserted, error: insertErr } = await sb
      .from("orders")
      .insert({
        store_id: smsStoreId,
        cafe24_order_id: orderNo,
        cafe24_order_item_code: orderNo,
        order_date: orderDateStr,
        product_name: so.product_name,
        option_text: so.option_text || "",
        quantity: qty,
        product_price: unitPrice,
        order_amount: orderAmount,
        buyer_name: so.depositor_name || so.orderer_name || so.recipient_name,
        buyer_phone: so.orderer_phone || so.recipient_phone || "",
        receiver_name: so.recipient_name,
        receiver_phone: so.recipient_phone || so.orderer_phone || "",
        receiver_address: so.recipient_address || "",
        receiver_zipcode: so.recipient_zipcode || "",
        memo: `[문자주문] ${so.order_number}`,
        shipping_status: isPaid ? "ordered" : "pending",
        sales_channel: "sms",
      })
      .select("id")
      .single();

    if (insertErr) {
      details.push({ order_number: so.order_number, status: "에러", reason: insertErr.message });
      continue;
    }

    insertedIds.push(inserted!.id);
    transferredSmsOrderIds.push(so.id);
    transferred++;
    details.push({ order_number: so.order_number, status: "이관완료" });
  }

  // 6. 문자주문 상태를 'transferred'로 변경
  if (transferredSmsOrderIds.length > 0) {
    await sb
      .from("sms_orders")
      .update({ status: "transferred" })
      .in("id", transferredSmsOrderIds);
  }

  // 7. 공급사 자동 배정 + 주소 자동 검증
  if (insertedIds.length > 0) {
    try {
      await autoAssignSuppliers(sb, { orderIds: insertedIds });
    } catch (e) { console.error("[sms-orders/transfer] auto-assign suppliers failed:", e); }
    try {
      await autoVerifyAddresses(sb, { orderIds: insertedIds });
    } catch (e) { console.error("[sms-orders/transfer] auto-verify addresses failed:", e); }
  }

  return NextResponse.json({
    total: ids.length,
    transferred,
    skipped,
    errors: details.filter((d) => d.status === "에러"),
    details,
  });
}
