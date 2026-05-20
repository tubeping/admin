import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";

/**
 * POST /api/phone-orders/transfer — 전화주문을 orders 테이블로 이관
 * body: { ids: string[] }
 *
 * 선택된 전화주문(confirmed 상태)을 orders 테이블에 insert하여
 * 주문수집 및 조회에서 발주 처리 가능하게 함.
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
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!phoneOrders || phoneOrders.length === 0) {
    return NextResponse.json({ error: "해당 주문을 찾을 수 없습니다." }, { status: 404 });
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
    const { data: created } = await sb
      .from("stores")
      .insert({ mall_id: `manual_${Date.now()}`, name: "전화주문", status: "active" })
      .select("id")
      .single();
    phoneStoreId = created!.id;
  }

  // 3. 이미 이관된 주문번호 체크 (PT- 접두사)
  const orderNos = phoneOrders.map((o) =>
    o.order_number.startsWith("PT-") ? o.order_number : `PT-${o.order_number}`
  );
  const { data: existing } = await sb
    .from("orders")
    .select("cafe24_order_id")
    .in("cafe24_order_id", orderNos);
  const existingSet = new Set((existing || []).map((e) => e.cafe24_order_id));

  // 4. 상품명 → 가격 매핑
  const productNames = [...new Set(phoneOrders.map((o) => o.product_name.trim()).filter(Boolean))];
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
  const details: Array<{ order_number: string; status: string; reason?: string }> = [];

  for (const po of phoneOrders) {
    const orderNo = po.order_number.startsWith("PT-") ? po.order_number : `PT-${po.order_number}`;

    if (existingSet.has(orderNo)) {
      skipped++;
      details.push({ order_number: po.order_number, status: "이미 이관됨" });
      continue;
    }

    const unitPrice = po.unit_price || productPriceMap[po.product_name.trim()] || 0;
    const qty = po.quantity || 1;
    const orderAmount = unitPrice * qty;
    const isPaid = po.payment_status === "paid";

    const { data: inserted, error: insertErr } = await sb
      .from("orders")
      .insert({
        store_id: phoneStoreId,
        cafe24_order_id: orderNo,
        cafe24_order_item_code: orderNo,
        order_date: po.order_date || new Date().toISOString(),
        product_name: po.product_name,
        option_text: po.option_text || "",
        quantity: qty,
        product_price: unitPrice,
        order_amount: orderAmount,
        buyer_name: po.recipient_name,
        buyer_phone: po.recipient_phone || "",
        receiver_name: po.recipient_name,
        receiver_phone: po.recipient_phone || "",
        receiver_address: po.recipient_address || "",
        receiver_zipcode: po.recipient_zipcode || "",
        memo: po.memo || "",
        shipping_status: isPaid ? "ordered" : "pending",
        shipping_company: po.shipping_company || "",
        tracking_number: po.tracking_number || "",
      })
      .select("id")
      .single();

    if (insertErr) {
      details.push({ order_number: po.order_number, status: "에러", reason: insertErr.message });
      continue;
    }

    insertedIds.push(inserted!.id);
    transferred++;
    details.push({ order_number: po.order_number, status: "이관완료" });

    // 전화주문 상태를 'transferred'로 변경하지 않고 그대로 유지 (참조용)
  }

  // 6. 공급사 자동 배정
  if (insertedIds.length > 0) {
    try {
      await autoAssignSuppliers(sb, { orderIds: insertedIds });
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    total: ids.length,
    transferred,
    skipped,
    details,
  });
}
