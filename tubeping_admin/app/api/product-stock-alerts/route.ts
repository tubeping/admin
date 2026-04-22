import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/product-stock-alerts — 품절/재입고/판매종료 알림 목록
 * ?status=pending / applied / ignored
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");

  const sb = getServiceClient();
  let query = sb.from("product_stock_alerts").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data: alerts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 매칭된 상품 정보 join
  const allProductIds = [...new Set((alerts || []).flatMap((a) => a.matched_product_ids || []))];
  const productMap: Record<string, { id: string; tp_code: string; product_name: string; selling: string }> = {};
  if (allProductIds.length > 0) {
    const { data: products } = await sb
      .from("products")
      .select("id, tp_code, product_name, selling")
      .in("id", allProductIds);
    for (const p of products || []) productMap[p.id] = p;
  }

  const enriched = (alerts || []).map((a) => ({
    ...a,
    matched_products: (a.matched_product_ids || []).map((id: string) => productMap[id]).filter(Boolean),
  }));

  return NextResponse.json({ alerts: enriched });
}

/**
 * POST /api/product-stock-alerts — 알림 등록 (수동 또는 gmail 스크립트)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    supplier_id,
    supplier_name,
    alert_type,
    product_names,
    option_info,
    effective_from,
    effective_to,
    title,
    detail,
    source,
    source_ref,
  } = body;

  if (!title || !supplier_name) {
    return NextResponse.json({ error: "title, supplier_name 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 상품명으로 매칭 시도 (부분 일치)
  const matchedIds: string[] = [];
  if (product_names && Array.isArray(product_names) && product_names.length > 0) {
    for (const name of product_names) {
      if (!name || typeof name !== "string") continue;
      const cleaned = name.trim().slice(0, 60);
      if (!cleaned) continue;
      const { data: matches } = await sb
        .from("products")
        .select("id")
        .ilike("product_name", `%${cleaned}%`)
        .limit(5);
      for (const m of matches || []) {
        if (!matchedIds.includes(m.id)) matchedIds.push(m.id);
      }
    }
  }

  const { data, error } = await sb
    .from("product_stock_alerts")
    .insert({
      supplier_id: supplier_id || null,
      supplier_name,
      alert_type: alert_type || "out_of_stock",
      product_names: product_names || [],
      option_info: option_info || null,
      effective_from: effective_from || null,
      effective_to: effective_to || null,
      title,
      detail: detail || "",
      matched_product_ids: matchedIds,
      source: source || "manual",
      source_ref: source_ref || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alert: data });
}

/**
 * PATCH /api/product-stock-alerts — 알림 처리 (적용/무시)
 * body: { id, action: 'apply' | 'ignore', product_ids?: string[] }
 *
 * apply: 선택한 products의 selling='F' 로 설정 (품절/판매종료) 또는 'T' (재입고)
 * ignore: status='ignored'
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, action, product_ids } = body;

  if (!id || !action) {
    return NextResponse.json({ error: "id, action 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: alert } = await sb
    .from("product_stock_alerts")
    .select("*")
    .eq("id", id)
    .single();

  if (!alert) return NextResponse.json({ error: "알림 없음" }, { status: 404 });

  if (action === "apply") {
    const targetIds: string[] = product_ids || alert.matched_product_ids || [];
    if (targetIds.length === 0) {
      return NextResponse.json({ error: "매칭된 상품 없음" }, { status: 400 });
    }

    // 재입고 → selling=T, 그 외(out_of_stock, discontinued) → selling=F
    const newSelling = alert.alert_type === "restock" ? "T" : "F";
    await sb
      .from("products")
      .update({ selling: newSelling })
      .in("id", targetIds);

    await sb
      .from("product_stock_alerts")
      .update({
        status: "applied",
        matched_product_ids: targetIds,
        applied_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ applied: targetIds.length, selling: newSelling });
  }

  if (action === "ignore") {
    await sb
      .from("product_stock_alerts")
      .update({ status: "ignored" })
      .eq("id", id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "잘못된 action" }, { status: 400 });
}

/**
 * DELETE /api/product-stock-alerts — 알림 삭제
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const sb = getServiceClient();
  const { error } = await sb.from("product_stock_alerts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
