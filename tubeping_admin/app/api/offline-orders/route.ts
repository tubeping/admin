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
    .from("offline_orders")
    .select("*, offline_clients:client_id(id, name, contact_name, phone), products:product_id(tp_code, image_url)", { count: "exact" })
    .order("order_date", { ascending: false })
    .limit(limit);

  if (clientId) query = query.eq("client_id", clientId);
  if (status) query = query.eq("status", status);
  if (paymentStatus) query = query.eq("payment_status", paymentStatus);
  if (startDate) query = query.gte("order_date", startDate);
  if (endDate) query = query.lte("order_date", endDate);
  if (keyword) query = query.or(`product_name.ilike.%${keyword}%,order_number.ilike.%${keyword}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data, total: count });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { client_id, product_id, product_name, option_text, quantity, purchase_price, supply_price, shipping_method, shipping_company, shipping_cost, memo, order_date } = body;

  if (!client_id) return NextResponse.json({ error: "거래처를 선택해주세요." }, { status: 400 });
  if (!product_name) return NextResponse.json({ error: "상품명은 필수입니다." }, { status: 400 });

  const sb = getServiceClient();

  // 납품번호 생성
  const dt = order_date || new Date().toISOString().slice(0, 10);
  const { data: numData } = await sb.rpc("generate_offline_order_number", { order_dt: dt });
  const order_number = numData || `OFF-${dt.replace(/-/g, "")}-001`;

  const total_amount = (supply_price || 0) * (quantity || 1);

  const { data, error } = await sb
    .from("offline_orders")
    .insert({
      order_number,
      client_id,
      order_date: dt,
      product_id: product_id || null,
      product_name,
      option_text,
      quantity: quantity || 1,
      purchase_price: purchase_price || 0,
      supply_price: supply_price || 0,
      total_amount,
      shipping_method: shipping_method || "courier",
      shipping_company,
      shipping_cost: shipping_cost || 0,
      memo,
    })
    .select("*, offline_clients:client_id(id, name, contact_name, phone), products:product_id(tp_code, image_url)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { ids, updates } = body;
  if (!ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const allowed = [
    "client_id", "product_id", "product_name", "option_text", "quantity",
    "purchase_price", "supply_price", "total_amount",
    "shipping_method", "shipping_company", "tracking_number", "shipping_cost", "shipped_at",
    "status", "payment_status", "paid_at", "memo",
  ];
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  // total_amount 자동 계산
  if (updates.supply_price !== undefined && updates.quantity !== undefined) {
    filtered.total_amount = updates.supply_price * updates.quantity;
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("offline_orders")
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
  const { error } = await sb.from("offline_orders").delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: ids.length });
}
