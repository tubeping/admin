import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const keyword = searchParams.get("keyword");

  const sb = getServiceClient();
  let query = sb
    .from("offline_clients")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (keyword) query = query.or(`name.ilike.%${keyword}%,contact_name.ilike.%${keyword}%,phone.ilike.%${keyword}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data, total: count });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, contact_name, phone, address, business_no, memo } = body;
  if (!name) return NextResponse.json({ error: "거래처명은 필수입니다." }, { status: 400 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("offline_clients")
    .insert({ name, contact_name, phone, address, business_no, memo })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const allowed = ["name", "contact_name", "phone", "address", "business_no", "memo", "status"];
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("offline_clients")
    .update(filtered)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
