import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const keyword = searchParams.get("keyword");

  const sb = getServiceClient();
  let query = sb
    .from("phone_order_clients")
    .select("*", { count: "exact" })
    .order("name", { ascending: true });

  if (status) query = query.eq("status", status);
  if (keyword) query = query.or(`name.ilike.%${keyword}%,contact_name.ilike.%${keyword}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data, total: count });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, contact_name, phone, memo } = body;

  if (!name) return NextResponse.json({ error: "판매처명은 필수입니다." }, { status: 400 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("phone_order_clients")
    .insert({ name, contact_name, phone, memo })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "이미 등록된 판매처명입니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, updates } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const allowed = ["name", "contact_name", "phone", "memo", "status"];
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("phone_order_clients")
    .update(filtered)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const sb = getServiceClient();

  // 주문이 존재하는 판매처는 삭제 불가 (비활성화만 가능)
  const { count } = await sb
    .from("phone_orders")
    .select("id", { count: "exact", head: true })
    .eq("client_id", id);

  if (count && count > 0) {
    return NextResponse.json({ error: "주문이 존재하는 판매처는 삭제할 수 없습니다. 비활성화를 사용해주세요." }, { status: 409 });
  }

  const { error } = await sb.from("phone_order_clients").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
