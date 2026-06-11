import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * PUT /api/suppliers/[id] — 공급사 수정 (po_config 포함)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const allowedFields = [
    "name", "email", "contact_name", "phone",
    "business_no", "memo", "status", "po_config",
    "cafe24_supplier_code", "short_code", "order_email", "settlement_email",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "수정할 필드 없음" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("suppliers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ supplier: data });
}

/**
 * DELETE /api/suppliers/[id] — 공급사 삭제
 * 주문 등 참조가 없으면 완전 삭제, 참조가 있으면(FK 위반) 이력 보존을 위해 '비활성' 처리(soft delete).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();
  const { error } = await sb.from("suppliers").delete().eq("id", id);

  if (error) {
    // 23503 = foreign_key_violation → 주문 이력이 있어 삭제 불가 → 비활성 처리로 대체
    if (error.code === "23503") {
      const { error: softError } = await sb
        .from("suppliers")
        .update({ status: "inactive" })
        .eq("id", id);
      if (softError) {
        return NextResponse.json({ error: softError.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, soft: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, deleted: true });
}
