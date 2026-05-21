import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";

/**
 * POST /api/phone-orders/transfer — 전화주문을 orders 테이블로 이관
 * body: { ids: string[] }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { ids } = body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 필수 (배열)" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 전화주문 조회
  const { data: phoneOrders, error: fetchErr } = await sb
    .from("phone_orders")
    .select("*, phone_order_clients:client_id(id, name)")
    .in("id", ids);

  if (fetchErr) {
    return NextResponse.json({ error: `전화주문 조회 실패: ${fetchErr.message}` }, { status: 500 });
  }
  if (!phoneOrders || phoneOrders.length === 0) {
    return NextResponse.json({ error: "해당 주문을 찾을 수 없습니다." }, { status: 404 });
  }

  // 이미 이관된 건 제외
  const notTransferred = phoneOrders.filter((o) => o.status !== "transferred");
  if (notTransferred.length === 0) {
    return NextResponse.json({ error: "모두 이미 이관된 주문입니다.", transferred: 0, skipped: phoneOrders.length, details: [] }, { status: 200 });
  }

  // 2. '전화주문' store 찾거나 생성
  let phoneStoreId: string;
  const { data: phoneStore } = await sb
    .from("stores")
    .select("id")
    .eq("name", "전화주문")
    .maybeSingle();

  if (phoneStore) {
    phoneStoreId = phoneStore.id;
  } else {
    const { data: created, error: storeErr } = await sb
      .from("stores")
      .insert({ mall_id: `manual_phone_${Date.now()}`, name: "전화주문", status: "active" })
      .select("id")
      .single();
    if (storeErr || !created) {
      return NextResponse.json({ error: `스토어 생성 실패: ${storeErr?.message}` }, { status: 500 });
    }
    phoneStoreId = created.id;
  }

  // 3. 이미 이관된 주문번호 체크 (PT- 접두사)
  const orderNos = notTransferred.map((o) =>
    o.order_number.startsWith("PT-") ? o.order_number : `PT-${o.order_number}`
  );
  const { data: existing } = await sb
    .from("orders")
    .select("cafe24_order_id")
    .in("cafe24_order_id", orderNos);
  const existingSet = new Set((existing || []).map((e) => e.cafe24_order_id));

  // 4. 상품명 → 가격 매핑
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
  const transferredPhoneOrderIds: string[] = [];
  const details: Array<{ order_number: string; status: string; reason?: string }> = [];

  for (const po of notTransferred) {
    const orderNo = po.order_number.startsWith("PT-") ? po.order_number : `PT-${po.order_number}`;

    if (existingSet.has(orderNo)) {
      skipped++;
      // orders 테이블에 이미 있으면 phone_orders 상태도 transferred로 맞춤
      transferredPhoneOrderIds.push(po.id);
      details.push({ order_number: po.order_number, status: "이미 이관됨" });
      continue;
    }

    const unitPrice = po.unit_price || productPriceMap[po.product_name.trim()] || 0;
    const qty = po.quantity || 1;
    const orderAmount = unitPrice * qty;
    const isPaid = po.payment_status === "paid";

    // order_date를 ISO 타임스탬프로 변환
    const orderDateStr = po.order_date
      ? new Date(po.order_date + "T09:00:00+09:00").toISOString()
      : new Date().toISOString();

    const { data: inserted, error: insertErr } = await sb
      .from("orders")
      .insert({
        store_id: phoneStoreId,
        cafe24_order_id: orderNo,
        cafe24_order_item_code: orderNo,
        order_date: orderDateStr,
        product_name: po.product_name,
        option_text: po.option_text || "",
        quantity: qty,
        product_price: unitPrice,
        order_amount: orderAmount,
        buyer_name: po.depositor_name || po.recipient_name,
        buyer_phone: po.recipient_phone || "",
        receiver_name: po.recipient_name,
        receiver_phone: po.recipient_phone || "",
        receiver_address: po.recipient_address || "",
        receiver_zipcode: po.recipient_zipcode || "",
        memo: `[전화주문] ${po.phone_order_clients?.name || ""} / ${po.order_number}`,
        shipping_status: isPaid ? "ordered" : "pending",
      })
      .select("id")
      .single();

    if (insertErr) {
      details.push({ order_number: po.order_number, status: "에러", reason: insertErr.message });
      continue;
    }

    insertedIds.push(inserted!.id);
    transferredPhoneOrderIds.push(po.id);
    transferred++;
    details.push({ order_number: po.order_number, status: "이관완료" });
  }

  // 6. 전화주문 상태를 'transferred'로 변경
  if (transferredPhoneOrderIds.length > 0) {
    await sb
      .from("phone_orders")
      .update({ status: "transferred" })
      .in("id", transferredPhoneOrderIds);
  }

  // 7. 공급사 자동 배정
  if (insertedIds.length > 0) {
    try {
      await autoAssignSuppliers(sb, { orderIds: insertedIds });
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    total: ids.length,
    transferred,
    skipped,
    errors: details.filter((d) => d.status === "에러"),
    details,
  });
}
