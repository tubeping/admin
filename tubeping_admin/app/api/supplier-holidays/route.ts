import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/supplier-holidays — 공급사 휴무 목록
 * ?month=YYYY-MM or ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const sb = getServiceClient();
  let query = sb.from("supplier_holidays").select("*").order("date_from", { ascending: true });

  if (month) {
    const [y, m] = month.split("-").map(Number);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    query = query.gte("date_to", start).lt("date_from", end);
  } else if (from && to) {
    query = query.gte("date_to", from).lte("date_from", to);
  } else {
    // 기본: 지난 7일 ~ 향후 60일
    const now = new Date();
    const past = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const future = new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    query = query.gte("date_to", past).lte("date_from", future);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ holidays: data });
}

/**
 * POST /api/supplier-holidays — 휴무 등록 (수동)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { supplier_id, date_from, date_to, type, title, detail } = body;

  if (!date_from || !date_to || !title) {
    return NextResponse.json({ error: "date_from, date_to, title 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 공급사명 조회
  let supplierName = body.supplier_name || "";
  if (supplier_id && !supplierName) {
    const { data: sup } = await sb.from("suppliers").select("name").eq("id", supplier_id).single();
    supplierName = sup?.name || "";
  }

  const { data, error } = await sb
    .from("supplier_holidays")
    .insert({
      supplier_id: supplier_id || null,
      supplier_name: supplierName,
      date_from,
      date_to,
      type: type || "holiday",
      title,
      detail: detail || "",
      source: "manual",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ holiday: data });
}

/**
 * DELETE /api/supplier-holidays — 휴무 삭제
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const sb = getServiceClient();
  const { error } = await sb.from("supplier_holidays").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
