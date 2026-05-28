import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * PATCH /api/settlements/[id]/notes
 * 어드민: 정산서 메모(memo) + 주문건별 비고(admin_note) 수정
 *
 * body: { memo?: string, items?: { id: string, admin_note: string }[] }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { memo?: string; items?: { id: string; admin_note: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 정산서 메모 수정
  if (body.memo !== undefined) {
    const { error } = await sb
      .from("settlements")
      .update({ memo: body.memo })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 주문건별 어드민 비고 수정
  if (body.items && body.items.length > 0) {
    for (const item of body.items) {
      await sb
        .from("settlement_items")
        .update({ admin_note: item.admin_note })
        .eq("id", item.id)
        .eq("settlement_id", id);
    }
  }

  return NextResponse.json({ ok: true });
}
