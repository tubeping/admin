import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/supplier-settlements — 공급사 정산 목록
 * ?period=2026-04 &status=draft
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const period = sp.get("period");
  const status = sp.get("status");

  const sb = getServiceClient();
  let q = sb
    .from("supplier_settlements")
    .select("*")
    .order("total_amount", { ascending: false });

  if (period) q = q.eq("period", period);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ supplierSettlements: data });
}

/**
 * POST /api/supplier-settlements — 공급사 정산 일괄 생성 (settlement_items 기반)
 * body: { period }
 */
export async function POST(request: NextRequest) {
  const { period } = await request.json();
  if (!period) {
    return NextResponse.json({ error: "period 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 해당 기간의 모든 settlement_items 가져오기
  const { data: settlements } = await sb
    .from("settlements")
    .select("id")
    .eq("period", period);

  if (!settlements || settlements.length === 0) {
    return NextResponse.json(
      { error: "해당 기간에 판매사 정산이 없습니다. 판매사 정산을 먼저 생성하세요." },
      { status: 400 }
    );
  }

  const sIds = settlements.map((s) => s.id);

  const { data: items, error: itemsError } = await sb
    .from("settlement_items")
    .select("*")
    .in("settlement_id", sIds)
    .eq("item_type", "매출");

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  // 공급사별 집계
  const map: Record<
    string,
    {
      supplier_id: string;
      supplier_name: string;
      item_count: number;
      total_quantity: number;
      total_supply: number;
      total_shipping: number;
      total_amount: number;
      total_sales: number;
    }
  > = {};

  for (const item of items || []) {
    const sid = item.supplier_id || "unassigned";
    const sname = item.supplier_name || "미배정";
    if (!map[sid]) {
      map[sid] = {
        supplier_id: sid,
        supplier_name: sname,
        item_count: 0,
        total_quantity: 0,
        total_supply: 0,
        total_shipping: 0,
        total_amount: 0,
        total_sales: 0,
      };
    }
    const s = map[sid];
    s.item_count++;
    s.total_quantity += item.quantity || 0;
    s.total_supply += item.supply_total || 0;
    s.total_shipping += item.supply_shipping || 0;
    s.total_amount += (item.supply_total || 0) + (item.supply_shipping || 0);
    s.total_sales += item.settled_amount || 0;
  }

  const suppliers = Object.values(map);
  let created = 0;
  let skipped = 0;
  const results: { supplier_name: string; status: string; error?: string }[] = [];

  for (const sup of suppliers) {
    // 이미 존재하는지 확인
    const { data: existing } = await sb
      .from("supplier_settlements")
      .select("id, status")
      .eq("supplier_id", sup.supplier_id)
      .eq("period", period)
      .single();

    if (existing) {
      // draft만 업데이트 가능
      if (existing.status === "draft") {
        await sb
          .from("supplier_settlements")
          .update({
            supplier_name: sup.supplier_name,
            total_supply: sup.total_supply,
            total_shipping: sup.total_shipping,
            total_amount: sup.total_amount,
            total_sales: sup.total_sales,
            item_count: sup.item_count,
            total_quantity: sup.total_quantity,
          })
          .eq("id", existing.id);
        created++;
        results.push({ supplier_name: sup.supplier_name, status: "updated" });
      } else {
        skipped++;
        results.push({
          supplier_name: sup.supplier_name,
          status: "skipped",
          error: `이미 ${existing.status} 상태`,
        });
      }
      continue;
    }

    const { error: insertError } = await sb
      .from("supplier_settlements")
      .insert({
        supplier_id: sup.supplier_id === "unassigned" ? null : sup.supplier_id,
        supplier_name: sup.supplier_name,
        period,
        status: "draft",
        total_supply: sup.total_supply,
        total_shipping: sup.total_shipping,
        total_amount: sup.total_amount,
        total_sales: sup.total_sales,
        item_count: sup.item_count,
        total_quantity: sup.total_quantity,
      });

    if (insertError) {
      results.push({
        supplier_name: sup.supplier_name,
        status: "error",
        error: insertError.message,
      });
    } else {
      created++;
      results.push({ supplier_name: sup.supplier_name, status: "created" });
    }
  }

  return NextResponse.json({
    total: suppliers.length,
    created,
    skipped,
    results,
  });
}

/**
 * DELETE /api/supplier-settlements — 공급사 정산 삭제 (draft만)
 * body: { id }
 */
export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("supplier_settlements")
    .select("status")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "정산을 찾을 수 없습니다" }, { status: 404 });
  }

  if (existing.status !== "draft") {
    return NextResponse.json(
      { error: "자료작성 상태의 정산만 삭제할 수 있습니다" },
      { status: 400 }
    );
  }

  const { error } = await sb.from("supplier_settlements").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
