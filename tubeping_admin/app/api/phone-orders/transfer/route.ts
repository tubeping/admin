import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";
import { autoVerifyAddresses } from "@/lib/autoVerifyAddresses";

/**
 * POST /api/phone-orders/transfer — 전화주문을 orders 테이블로 이관
 * body: { ids: string[] }
 *
 * - 판매방식(sales_channel): "phone" (전화주문)
 * - 판매사(store_id): phone_order_clients 이름으로 stores 테이블 매칭/생성
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
    return NextResponse.json({ transferred: 0, skipped: phoneOrders.length, errors: [], details: [] });
  }

  // 2. 판매처 이름 → stores 매핑 (없으면 생성)
  const clientNames = [...new Set(notTransferred.map((o) => o.phone_order_clients?.name).filter(Boolean))] as string[];
  const storeIdMap: Record<string, string> = {};

  if (clientNames.length > 0) {
    // 기존 stores에서 이름 매칭
    const { data: existingStores } = await sb
      .from("stores")
      .select("id, name")
      .in("name", clientNames);
    for (const s of existingStores || []) {
      storeIdMap[s.name] = s.id;
    }

    // 매칭 안 된 판매처는 새 store 생성
    for (const name of clientNames) {
      if (!storeIdMap[name]) {
        const { data: created, error: storeErr } = await sb
          .from("stores")
          .insert({ mall_id: `phone_${name}_${Date.now()}`, name, status: "active" })
          .select("id")
          .single();
        if (!storeErr && created) {
          storeIdMap[name] = created.id;
        }
      }
    }
  }

  // fallback: 판매처 이름이 없는 경우 '전화주문' 스토어 사용
  let fallbackStoreId: string | null = null;
  const needsFallback = notTransferred.some((o) => !o.phone_order_clients?.name || !storeIdMap[o.phone_order_clients.name]);
  if (needsFallback) {
    const { data: phoneStore } = await sb.from("stores").select("id").eq("name", "전화주문").maybeSingle();
    if (phoneStore) {
      fallbackStoreId = phoneStore.id;
    } else {
      const { data: created } = await sb
        .from("stores")
        .insert({ mall_id: `manual_phone_${Date.now()}`, name: "전화주문", status: "active" })
        .select("id")
        .single();
      fallbackStoreId = created?.id || null;
    }
  }

  // 3. 이미 이관된 주문번호 체크
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
      transferredPhoneOrderIds.push(po.id);
      details.push({ order_number: po.order_number, status: "이미 이관됨" });
      continue;
    }

    // 판매사(store_id) 결정: 판매처 이름 → stores 매핑
    const clientName = po.phone_order_clients?.name || "";
    const storeId = (clientName && storeIdMap[clientName]) || fallbackStoreId;
    if (!storeId) {
      details.push({ order_number: po.order_number, status: "에러", reason: "판매사(store) 매핑 실패" });
      continue;
    }

    const unitPrice = po.unit_price || productPriceMap[po.product_name.trim()] || 0;
    const qty = po.quantity || 1;
    const orderAmount = unitPrice * qty;
    const isPaid = po.payment_status === "paid";

    const orderDateStr = po.order_date
      ? new Date(po.order_date + "T09:00:00+09:00").toISOString()
      : new Date().toISOString();

    const { data: inserted, error: insertErr } = await sb
      .from("orders")
      .insert({
        store_id: storeId,
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
        memo: `[전화주문] ${clientName} / ${po.order_number}`,
        shipping_status: isPaid ? "ordered" : "pending",
        sales_channel: "phone",
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
    } catch (e) { console.error("[phone-orders/transfer] auto-assign suppliers failed:", e); }
    try {
      await autoVerifyAddresses(sb, { orderIds: insertedIds });
    } catch (e) { console.error("[phone-orders/transfer] auto-verify addresses failed:", e); }
  }

  return NextResponse.json({
    total: ids.length,
    transferred,
    skipped,
    errors: details.filter((d) => d.status === "에러"),
    details,
  });
}
