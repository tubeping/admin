import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get("client_id");
  const status = searchParams.get("status");
  const paymentStatus = searchParams.get("payment_status");
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const keyword = searchParams.get("keyword");
  const limit = parseInt(searchParams.get("limit") || "500", 10);

  const sb = getServiceClient();
  let query = sb
    .from("phone_orders")
    .select("*, phone_order_clients:client_id(id, name, contact_name, phone)", { count: "exact" })
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (clientId) query = query.eq("client_id", clientId);
  if (status) query = query.eq("status", status);
  if (paymentStatus) query = query.eq("payment_status", paymentStatus);
  if (startDate) query = query.gte("order_date", startDate);
  if (endDate) query = query.lte("order_date", endDate);
  if (keyword) {
    query = query.or(
      `product_name.ilike.%${keyword}%,recipient_name.ilike.%${keyword}%,depositor_name.ilike.%${keyword}%,order_number.ilike.%${keyword}%`
    );
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data, total: count });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    client_id, store_name, product_name, option_text, quantity,
    unit_price, depositor_name, payment_status,
    recipient_name, recipient_phone, recipient_zipcode,
    recipient_address, delivery_message,
    shipping_company, tracking_number,
    memo, order_date,
  } = body;

  if (!client_id && !store_name) return NextResponse.json({ error: "판매처를 선택해주세요." }, { status: 400 });
  if (!product_name) return NextResponse.json({ error: "상품명은 필수입니다." }, { status: 400 });
  if (!recipient_name) return NextResponse.json({ error: "수령인은 필수입니다." }, { status: 400 });

  const sb = getServiceClient();

  // store_name으로 넘어온 경우 phone_order_clients에서 찾거나 자동 생성
  let resolvedClientId = client_id;
  if (!resolvedClientId && store_name) {
    const { data: existing } = await sb
      .from("phone_order_clients")
      .select("id")
      .eq("name", store_name)
      .single();

    if (existing) {
      resolvedClientId = existing.id;
    } else {
      const { data: created, error: createErr } = await sb
        .from("phone_order_clients")
        .insert({ name: store_name })
        .select("id")
        .single();
      if (createErr) return NextResponse.json({ error: `판매처 생성 실패: ${createErr.message}` }, { status: 500 });
      resolvedClientId = created.id;
    }
  }

  const dt = order_date || new Date().toISOString().slice(0, 10);
  const { data: numData } = await sb.rpc("generate_phone_order_number", { order_dt: dt });
  const order_number = numData || `TEL-${dt.replace(/-/g, "")}-001`;

  const qty = quantity || 1;
  const price = unit_price || 0;
  const total_amount = price * qty;

  const { data, error } = await sb
    .from("phone_orders")
    .insert({
      order_number,
      client_id: resolvedClientId,
      order_date: dt,
      product_name,
      option_text,
      quantity: qty,
      unit_price: price,
      total_amount,
      depositor_name,
      payment_status: payment_status || "unpaid",
      recipient_name,
      recipient_phone,
      recipient_zipcode,
      recipient_address,
      delivery_message,
      shipping_company,
      tracking_number,
      memo,
    })
    .select("*, phone_order_clients:client_id(id, name, contact_name, phone)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { ids, updates } = body;
  if (!ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const allowed = [
    "client_id", "product_name", "option_text", "quantity",
    "unit_price", "total_amount",
    "depositor_name", "payment_status", "paid_at",
    "recipient_name", "recipient_phone", "recipient_zipcode",
    "recipient_address", "delivery_message",
    "shipping_company", "tracking_number", "shipped_at",
    "status", "memo", "order_date",
  ];
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  // total_amount 자동 계산
  if (filtered.unit_price !== undefined || filtered.quantity !== undefined) {
    // 개별 주문에서만 자동계산 (bulk은 직접 넘겨야 함)
    if (ids.length === 1) {
      const sb2 = getServiceClient();
      const { data: existing } = await sb2.from("phone_orders").select("unit_price, quantity").eq("id", ids[0]).single();
      if (existing) {
        const newPrice = (filtered.unit_price as number) ?? existing.unit_price;
        const newQty = (filtered.quantity as number) ?? existing.quantity;
        filtered.total_amount = newPrice * newQty;
      }
    }
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("phone_orders")
    .update(filtered)
    .in("id", ids)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: data?.length || 0 });
}

export async function DELETE(request: NextRequest) {
  const { ids } = await request.json();
  if (!ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const sb = getServiceClient();
  const { error } = await sb.from("phone_orders").delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: ids.length });
}
