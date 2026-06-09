import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/products — 자체 상품 목록
 * params: limit, offset, keyword, category, selling, with_count
 *   with_count=1 만 exact count 계산 (첫 페이지에서만 사용 권장 — 매 페이지 호출 시 750ms+ 부담)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Number(searchParams.get("limit") || "50");
  const offset = Number(searchParams.get("offset") || "0");
  const keyword = searchParams.get("keyword") || "";
  const category = searchParams.get("category") || "";
  const selling = searchParams.get("selling") || "";
  const display = searchParams.get("display") || "";
  const approval = searchParams.get("approval_status") || "";
  const fulfillment = searchParams.get("fulfillment") || "";   // direct | warehouse
  const stock = searchParams.get("stock") || "";               // out | in
  const supplier = searchParams.get("supplier") || "";
  const withCount = searchParams.get("with_count") === "1";

  const sb = getServiceClient();

  // 키워드 → tp_code 패턴 확장용 OR절 (공급사명/short_code 매칭) 미리 계산
  let orClause: string | null = null;
  if (keyword) {
    // 기본 검색: 상품명 / tp_code / 자유형 supplier 텍스트 (ILIKE는 대소문자 무시)
    const orClauses = [
      `product_name.ilike.%${keyword}%`,
      `tp_code.ilike.%${keyword}%`,
      `supplier.ilike.%${keyword}%`,
    ];
    // 코어 포맷: TP[공급사short_code2][숫자]. tp_code 앞에 '공급사명_' 접두사가 붙어도
    //  코어 부분문자열 '%TP{short_code}%' 로 매칭 — 접두사 한글명은 위 %keyword% 가 커버
    const { data: matchedSuppliers } = await sb
      .from("suppliers")
      .select("short_code")
      .or(`name.ilike.%${keyword}%,short_code.ilike.%${keyword}%`)
      .not("short_code", "is", null);
    for (const s of matchedSuppliers || []) {
      if (s.short_code) orClauses.push(`tp_code.ilike.%TP${s.short_code}%`);
    }
    orClause = orClauses.join(",");
  }

  // 판매사 가격 레이어 컬럼(031 마이그레이션). 아직 컬럼이 없는 환경에서도 동작하도록
  // 1차 시도가 실패하면 seller_* 없는 select 로 폴백한다(배포-마이그레이션 순서 무관).
  const SELLER_COLS = ", seller_price, seller_shipping_fee, seller_product_code, seller_synced_at";
  const mkSelect = (withSeller: boolean) =>
    `id, tp_code, product_name, price, supply_price, retail_price, supply_shipping_fee, image_url, selling, display, approval_status, category, supplier, total_stock, fulfillment_warehouse_supplier_id, created_at, updated_at, product_cafe24_mappings(id, store_id, cafe24_product_no, sync_status${withSeller ? SELLER_COLS : ""}), product_variants(id)`;

  const buildAndRun = (withSeller: boolean) => {
    let query = sb
      .from("products")
      .select(mkSelect(withSeller), withCount ? { count: "exact" } : undefined)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (orClause) query = query.or(orClause);
    if (category) query = query.eq("category", category);
    if (selling === "T" || selling === "F") query = query.eq("selling", selling);
    if (display === "T" || display === "F") query = query.eq("display", display);
    if (approval) query = query.eq("approval_status", approval);
    if (fulfillment === "warehouse") query = query.not("fulfillment_warehouse_supplier_id", "is", null);
    else if (fulfillment === "direct") query = query.is("fulfillment_warehouse_supplier_id", null);
    if (stock === "out") query = query.lte("total_stock", 0);
    else if (stock === "in") query = query.gt("total_stock", 0);
    if (supplier) query = query.eq("supplier", supplier);
    return query;
  };

  let { data, error, count } = await buildAndRun(true);
  if (error && /seller_(price|shipping_fee|product_code|synced_at)/.test(error.message)) {
    ({ data, error, count } = await buildAndRun(false));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: data, total: count });
}

/**
 * POST /api/products — 새 상품 등록
 * body: { product_name, price, supply_price, retail_price, image_url?, selling?, category?, description?, memo?, tp_code? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { product_name, price, supply_price, retail_price, image_url, selling, category, description, memo, tp_code } = body;

  if (!product_name) {
    return NextResponse.json({ error: "상품명은 필수입니다" }, { status: 400 });
  }

  const sb = getServiceClient();

  // tp_code가 없으면 자동 생성
  let code = tp_code;
  if (!code) {
    const { data: codeData, error: codeErr } = await sb.rpc("generate_tp_code");
    if (codeErr || !codeData) {
      // fallback: 수동 생성
      const { data: maxData } = await sb
        .from("products")
        .select("tp_code")
        .order("created_at", { ascending: false })
        .limit(1);

      const maxNum = maxData && maxData.length > 0
        ? parseInt(maxData[0].tp_code.replace("TP-", ""), 10) || 0
        : 0;
      code = `TP-${String(maxNum + 1).padStart(4, "0")}`;
    } else {
      code = codeData;
    }
  }

  const { data, error } = await sb
    .from("products")
    .insert({
      tp_code: code,
      product_name,
      price: Number(price) || 0,
      supply_price: Number(supply_price) || 0,
      retail_price: Number(retail_price) || 0,
      image_url: image_url || null,
      selling: selling || "T",
      category: category || null,
      description: description || null,
      memo: memo || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 존재하는 상품코드입니다" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ product: data });
}
