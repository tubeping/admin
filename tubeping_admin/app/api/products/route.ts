import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/products — 자체 상품 목록
 * params: limit, offset, keyword, category, selling
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Number(searchParams.get("limit") || "50");
  const offset = Number(searchParams.get("offset") || "0");
  const keyword = searchParams.get("keyword") || "";
  const category = searchParams.get("category") || "";
  const selling = searchParams.get("selling") || "";
  const display = searchParams.get("display") || "";

  const sb = getServiceClient();

  // 리스트 뷰는 가벼운 컬럼만 (모달 열릴 때 detail API로 fullload)
  let query = sb
    .from("products")
    .select("id, tp_code, product_name, price, supply_price, retail_price, image_url, selling, display, approval_status, category, supplier, total_stock, fulfillment_warehouse_supplier_id, created_at, updated_at, product_cafe24_mappings(store_id), product_variants(id)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (keyword) {
    // 기본 검색: 상품명 / tp_code / 자유형 supplier 텍스트 (ILIKE는 대소문자 무시)
    const orClauses = [
      `product_name.ilike.%${keyword}%`,
      `tp_code.ilike.%${keyword}%`,
      `supplier.ilike.%${keyword}%`,
    ];

    // 공급사명/short_code 기반 추가 매칭:
    // 키워드로 suppliers를 조회해서 매치된 공급사의 short_code들을 tp_code 패턴으로 확장
    // (tp_code 포맷: [채널2][공급사코드2][숫자] → 패턴은 '__' + short_code + '%')
    const { data: matchedSuppliers } = await sb
      .from("suppliers")
      .select("short_code")
      .or(`name.ilike.%${keyword}%,short_code.ilike.%${keyword}%`)
      .not("short_code", "is", null);

    for (const s of matchedSuppliers || []) {
      if (s.short_code) {
        orClauses.push(`tp_code.ilike.__${s.short_code}%`);
      }
    }

    query = query.or(orClauses.join(","));
  }
  if (category) {
    query = query.eq("category", category);
  }
  if (selling === "T" || selling === "F") {
    query = query.eq("selling", selling);
  }
  if (display === "T" || display === "F") {
    query = query.eq("display", display);
  }

  const { data, error, count } = await query;

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
