import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/orders — 통합 주문 목록 (Supabase)
 * ?status=pending&store_id=xxx&supplier_id=xxx&start_date=&end_date=&limit=50&offset=0
 */

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const storeId = searchParams.get("store_id");
  const supplierId = searchParams.get("supplier_id");
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const limit = parseInt(searchParams.get("limit") || "10000", 10);
  const poId = searchParams.get("purchase_order_id");
  const includeDraft = searchParams.get("include_draft") === "true";

  const sb = getServiceClient();

  // Supabase limits 1000 rows per query — use cursor-based pagination
  const CHUNK = 1000;
  let allData: any[] = [];
  let totalCount: number | null = null;
  let cursorDate: string | null = null;
  let cursorId: string | null = null;

  function applyFilters(query: any) {
    if (status) query = query.eq("shipping_status", status);
    else if (!includeDraft) query = query.neq("shipping_status", "draft");
    if (storeId) query = query.eq("store_id", storeId);
    if (supplierId) query = query.eq("supplier_id", supplierId);
    if (poId) query = query.eq("purchase_order_id", poId);
    if (startDate) query = query.gte("order_date", startDate);
    if (endDate) query = query.lte("order_date", endDate + "T23:59:59");
    return query;
  }

  // Get total count first
  {
    let countQuery = sb
      .from("orders")
      .select("id", { count: "exact", head: true });
    countQuery = applyFilters(countQuery);
    const { count: c } = await countQuery;
    totalCount = c;
  }

  while (allData.length < limit) {
    let query = sb
      .from("orders")
      .select(
        "*, stores:store_id(name, mall_id), suppliers:supplier_id(name, email), purchase_orders:purchase_order_id(id, po_number, status, sent_at, viewed_at, completed_at)"
      )
      .order("order_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(CHUNK);

    query = applyFilters(query);

    // cursor: fetch rows older than last fetched row
    if (cursorDate && cursorId) {
      query = query.or(`order_date.lt.${cursorDate},and(order_date.eq.${cursorDate},id.lt.${cursorId})`);
    }

    const { data: chunk, error: chunkError } = await query;
    if (chunkError) {
      return NextResponse.json({ error: chunkError.message }, { status: 500 });
    }
    if (!chunk || chunk.length === 0) break;

    allData = allData.concat(chunk);
    const lastRow = chunk[chunk.length - 1];
    cursorDate = lastRow.order_date || null;
    cursorId = lastRow.id;
    if (chunk.length < CHUNK || !cursorDate) break;
  }

  const data = allData;
  const count = totalCount;

  // 출고지(창고) + 상품관리 가격 enrichment
  const orders = data || [];
  if (orders.length > 0) {
    // 1) orders.product_id가 이미 설정된 경우 직접 사용
    const directPids = [...new Set(orders.map((o: any) => o.product_id).filter(Boolean))];

    // 2) cafe24_product_no → product_id 매핑
    const productNos = [...new Set(orders.map((o: any) => o.cafe24_product_no).filter((n: any) => n > 0))];
    const storeProductToProductId: Record<string, string> = {};
    if (productNos.length > 0) {
      const { data: mappings } = await sb
        .from("product_cafe24_mappings")
        .select("store_id, cafe24_product_no, product_id")
        .in("cafe24_product_no", productNos);
      for (const m of mappings || []) {
        storeProductToProductId[`${m.store_id}::${m.cafe24_product_no}`] = m.product_id;
      }
    }
    // 3) product_name → product_id 매핑 (cafe24_product_no 없는 경우)
    const productNames = [...new Set(orders.map((o: any) => o.product_name?.trim()).filter(Boolean))];
    const nameToProductId: Record<string, string> = {};
    if (productNames.length > 0) {
      const { data: byName } = await sb.from("products").select("id, product_name").in("product_name", productNames);
      for (const p of byName || []) { if (p.product_name) nameToProductId[p.product_name.trim()] = p.id; }
    }
    // 4) 모든 product_id에서 가격 정보 + 출고지 가져오기 (price 추가)
    const allPids = [...new Set([...directPids, ...Object.values(storeProductToProductId), ...Object.values(nameToProductId)])];
    const pidToWarehouse: Record<string, string> = {};
    const pidToSalePrice: Record<string, number> = {};
    if (allPids.length > 0) {
      for (let i = 0; i < allPids.length; i += 500) {
        const batch = allPids.slice(i, i + 500);
        const { data: products } = await sb.from("products").select("id, fulfillment_warehouse_supplier_id, price").in("id", batch);
        for (const p of products || []) {
          if (p.fulfillment_warehouse_supplier_id) pidToWarehouse[p.id] = p.fulfillment_warehouse_supplier_id;
          if (p.price) pidToSalePrice[p.id] = p.price;
        }
      }
    }
    // 5) supplier_products 조회 — 공급사+상품 조합의 공급가가 있으면 products보다 우선
    const supMap: Record<string, { supply_price: number; supply_shipping_fee: number }> = {};
    const supplierIds = [...new Set(orders.map((o: any) => o.supplier_id).filter(Boolean))];
    if (supplierIds.length > 0 && allPids.length > 0) {
      const { data: supProducts } = await sb
        .from("supplier_products")
        .select("supplier_id, product_id, supply_price, supply_shipping_fee")
        .in("supplier_id", supplierIds)
        .in("product_id", allPids);
      for (const sp of (supProducts || [])) {
        supMap[`${sp.supplier_id}|${sp.product_id}`] = {
          supply_price: sp.supply_price || 0,
          supply_shipping_fee: sp.supply_shipping_fee || 0,
        };
      }
    }

    // 4.5) 옵션별 공급가/판매가 (product_options 매칭)
    // key = `${product_id}|${option_text}` → { supply_price, retail_price, supply_shipping_fee }
    const optKeyToPrice: Record<string, { supply_price: number; retail_price: number; supply_shipping_fee: number }> = {};
    if (allPids.length > 0) {
      const { data: prodOpts } = await sb
        .from("product_options")
        .select("product_id, option_text, supply_price, retail_price, supply_shipping_fee")
        .in("product_id", allPids);
      for (const o of prodOpts || []) {
        optKeyToPrice[`${o.product_id}|${o.option_text}`] = {
          supply_price: o.supply_price || 0,
          retail_price: o.retail_price || 0,
          supply_shipping_fee: o.supply_shipping_fee || 0,
        };
      }
    }
    // warehouse supplier_id → name
    const warehouseIds = [...new Set(Object.values(pidToWarehouse))];
    const warehouseNames: Record<string, string> = {};
    if (warehouseIds.length > 0) {
      const { data: wSuppliers } = await sb.from("suppliers").select("id, name").in("id", warehouseIds);
      for (const s of wSuppliers || []) { warehouseNames[s.id] = s.name; }
    }
    // 각 주문에 warehouse_name, supply_price, supply_shipping_fee + 판매가 보충
    for (const o of orders as any[]) {
      // product_id 결정: DB에 저장된 값 → cafe24 매핑 → 상품명 매칭
      let pid = o.product_id || undefined;
      if (!pid && o.store_id && o.cafe24_product_no > 0) pid = storeProductToProductId[`${o.store_id}::${o.cafe24_product_no}`];
      if (!pid && o.product_name) pid = nameToProductId[o.product_name.trim()];
      const wId = pid ? pidToWarehouse[pid] : undefined;
      o.warehouse_name = wId ? warehouseNames[wId] || null : null;

      // 공급가 결정 우선순위:
      //   1순위: product_options (옵션 매칭) — 가장 구체적
      //   2순위: supplier_products (공급사+상품 조합)
      //   없으면: 0 (products 테이블 fallback 사용하지 않음)
      const optKey = pid && o.option_text ? `${pid}|${(o.option_text as string).trim()}` : null;
      const opt = optKey ? optKeyToPrice[optKey] : null;
      const supKey = o.supplier_id && pid ? `${o.supplier_id}|${pid}` : null;
      const supInfo = supKey ? supMap[supKey] : null;

      if (opt) {
        o.supply_price = opt.supply_price;
        o.supply_shipping_fee = opt.supply_shipping_fee;
      } else if (supInfo) {
        o.supply_price = supInfo.supply_price;
        o.supply_shipping_fee = supInfo.supply_shipping_fee;
      } else {
        o.supply_price = 0;
        o.supply_shipping_fee = 0;
      }

      // 판매가 비어있을 때 fallback: 옵션 retail_price → products.price
      const fallbackPrice = (opt?.retail_price && opt.retail_price > 0)
        ? opt.retail_price
        : (pid ? pidToSalePrice[pid] || 0 : 0);
      if (fallbackPrice > 0) {
        if (!o.product_price) o.product_price = fallbackPrice;
        if (!o.order_amount) o.order_amount = fallbackPrice * (o.quantity || 1);
      }
    }
  }

  return NextResponse.json({ orders, total: count });
}

/**
 * PATCH /api/orders — 주문 일괄 수정 (공급사 배정, 상태 변경 등)
 * body: { ids: string[], updates: { supplier_id?, shipping_status?, memo? } }
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { ids, updates } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 필수 (배열)" }, { status: 400 });
  }

  const allowedFields = [
    "cafe24_order_id",
    "supplier_id", "shipping_status", "memo", "purchase_order_id",
    "is_sample", "auto_assign_status",
    "tracking_number", "shipping_company",
    "buyer_name", "buyer_phone", "receiver_name", "receiver_phone", "receiver_address",
    "store_id", "sales_channel",
  ];
  const filtered: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: "수정할 필드 없음" }, { status: 400 });
  }

  // 사용자가 supplier_id를 명시 변경하면 auto_assign_status를 "manual"로 자동 표시
  // (auto_assign_status를 함께 보냈으면 그 값 유지)
  if ("supplier_id" in filtered && !("auto_assign_status" in filtered)) {
    filtered.auto_assign_status = "manual";
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("orders")
    .update(filtered)
    .in("id", ids)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ updated: data?.length || 0 });
}

/**
 * DELETE /api/orders — 주문 일괄 삭제
 * body: { ids: string[] }
 * settlement_items가 FK로 참조하므로 먼저 정리한 뒤 orders 삭제
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { ids } = body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 필수 (배열)" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 자식 테이블(settlement_items) 먼저 삭제 — FK 위반 방지
  const { error: siErr } = await sb.from("settlement_items").delete().in("order_id", ids);
  if (siErr) {
    return NextResponse.json({ error: `정산항목 삭제 실패: ${siErr.message}` }, { status: 500 });
  }

  const { data, error } = await sb.from("orders").delete().in("id", ids).select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: data?.length || 0 });
}
