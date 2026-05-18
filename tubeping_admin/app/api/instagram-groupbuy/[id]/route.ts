/**
 * PATCH/DELETE /api/instagram-groupbuy/[id]
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const ALLOWED_FIELDS = [
  "ig_username", "ig_url", "ig_full_name", "followers", "category",
  "product_name", "product_brand", "proposed_margin", "dm_content",
  "proposed_at", "replied_at", "reply_content",
  "status", "campaign_date", "agreed_margin", "sales_amount",
  "assigned_to", "memo", "tags",
];

const ALLOWED_STATUSES = [
  "sent", "no_reply", "interested", "negotiating",
  "accepted", "rejected", "running", "done",
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  if (body.status && !ALLOWED_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ALLOWED_FIELDS) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (typeof updates.ig_username === "string") {
    updates.ig_username = (updates.ig_username as string).replace(/^@/, "").trim();
  }
  if (updates.followers !== undefined && updates.followers !== null) {
    updates.followers = Number(updates.followers);
  }
  if (updates.sales_amount !== undefined && updates.sales_amount !== null) {
    updates.sales_amount = Number(updates.sales_amount);
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("instagram_groupbuy_outreach")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getServiceClient();
  const { error } = await sb
    .from("instagram_groupbuy_outreach")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
