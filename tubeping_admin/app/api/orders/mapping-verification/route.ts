import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/orders/mapping-verification
 *   ?store_id=&start_date=&end_date=&include_verified=true
 *
 * 주문을 상품명 단위로 묶어 매핑 상태를 검증:
 *  - 주문 상품명이 products에 정확 일치로 존재하는가
 *  - 그 상품의 tp_code에서 추출한 공급사 코드가 suppliers에 있는가
 *  - 현재 주문에 배정된 supplier_id와 tp_code 기반 supplier_id가 일치하는가
 *
 * include_verified=false(기본)이면 products.mapping_verified=true 는 제외
 */

const TP_CODE_RE = /^([A-Z]{2})([A-Z]{2})\d+$/;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get("store_id");
  const startDate = sp.get("start_date");
  const endDate = sp.get("end_date");
  const includeVerified = sp.get("include_verified") === "true";

  const sb = getServiceClient();

  // 1. 대상 주문 fetch
  let q = sb
    .from("orders")
    .select("id, product_name, supplier_id, stores:store_id(name), suppliers:supplier_id(id, name, short_code)")
    .neq("shipping_status", "cancelled")
    .limit(2000);
  if (storeId) q = q.eq("store_id", storeId);
  if (startDate) q = q.gte("order_date", startDate);
  if (endDate) q = q.lte("order_date", endDate + "T23:59:59");

  const { data: orders, error: oErr } = await q;
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!orders || orders.length === 0) return NextResponse.json({ groups: [] });

  // 2. 상품명 또는 name_aliases로 products 조회
  const names = [...new Set(orders.map((o) => (o.product_name || "").trim()).filter(Boolean))];
  const nameToProduct: Record<string, { id: string; tp_code: string | null; verified: boolean }> = {};
  if (names.length > 0) {
    // product_name 정확 일치
    const { data: byName } = await sb
      .from("products")
      .select("id, product_name, tp_code, mapping_verified")
      .in("product_name", names);
    for (const p of byName || []) {
      if (p.product_name) {
        nameToProduct[p.product_name.trim()] = {
          id: p.id,
          tp_code: p.tp_code,
          verified: !!p.mapping_verified,
        };
      }
    }
    // name_aliases 배열 포함 검색 — 아직 매칭 안 된 이름에 대해서만
    const unresolved = names.filter((n) => !nameToProduct[n]);
    if (unresolved.length > 0) {
      const { data: byAlias } = await sb
        .from("products")
        .select("id, product_name, tp_code, mapping_verified, name_aliases")
        .overlaps("name_aliases", unresolved);
      for (const p of byAlias || []) {
        const aliases: string[] = p.name_aliases || [];
        for (const alias of aliases) {
          if (unresolved.includes(alias) && !nameToProduct[alias]) {
            nameToProduct[alias] = {
              id: p.id,
              tp_code: p.tp_code,
              verified: !!p.mapping_verified,
            };
          }
        }
      }
    }
  }

  // 3. 공급사 short_code → id, name
  const { data: suppliers } = await sb.from("suppliers").select("id, name, short_code");
  const codeToSupplier: Record<string, { id: string; name: string }> = {};
  for (const s of suppliers || []) {
    if (s.short_code) codeToSupplier[s.short_code.toUpperCase()] = { id: s.id, name: s.name };
  }

  // 4. 주문을 상품명 단위로 group
  type Row = { order_id: string; store_name: string | null; current_supplier_id: string | null; current_supplier_name: string | null };
  const groupMap: Record<string, Row[]> = {};
  for (const o of orders) {
    const key = (o.product_name || "").trim();
    if (!key) continue;
    if (!groupMap[key]) groupMap[key] = [];
    const s = Array.isArray(o.stores) ? o.stores[0] : (o.stores as { name: string } | null);
    const sup = Array.isArray(o.suppliers) ? o.suppliers[0] : (o.suppliers as { id: string; name: string } | null);
    groupMap[key].push({
      order_id: o.id,
      store_name: s?.name || null,
      current_supplier_id: sup?.id || null,
      current_supplier_name: sup?.name || null,
    });
  }

  // 5. 각 group 상태 계산
  const groups = Object.entries(groupMap).map(([productName, rows]) => {
    const prod = nameToProduct[productName];
    let expectedSupplierId: string | null = null;
    let expectedSupplierName: string | null = null;
    let tpCode: string | null = null;
    let status: "match" | "mismatch" | "unmatched_product" | "invalid_tp_code" | "unknown_supplier_code" = "unmatched_product";

    if (prod) {
      tpCode = prod.tp_code;
      if (!tpCode) {
        status = "invalid_tp_code";
      } else {
        const m = tpCode.toUpperCase().match(TP_CODE_RE);
        if (!m) {
          status = "invalid_tp_code";
        } else {
          const code = m[2];
          const s = codeToSupplier[code];
          if (!s) {
            status = "unknown_supplier_code";
          } else {
            expectedSupplierId = s.id;
            expectedSupplierName = s.name;
            // 현재 주문들에 배정된 supplier와 비교
            const currentIds = new Set(rows.map((r) => r.current_supplier_id));
            const allMatch = currentIds.size === 1 && currentIds.has(expectedSupplierId);
            status = allMatch ? "match" : "mismatch";
          }
        }
      }
    }

    return {
      product_name: productName,
      product_id: prod?.id || null,
      tp_code: tpCode,
      mapping_verified: prod?.verified || false,
      expected_supplier_id: expectedSupplierId,
      expected_supplier_name: expectedSupplierName,
      order_count: rows.length,
      current_supplier_names: [...new Set(rows.map((r) => r.current_supplier_name || "(미배정)"))],
      store_names: [...new Set(rows.map((r) => r.store_name).filter(Boolean))] as string[],
      status,
      order_ids: rows.map((r) => r.order_id),
    };
  });

  const filtered = includeVerified ? groups : groups.filter((g) => !g.mapping_verified);
  // 정렬: 문제 있는 것 먼저 (mismatch > unmatched_product > invalid_tp_code > unknown_supplier_code > match)
  const order = { mismatch: 0, unmatched_product: 1, invalid_tp_code: 2, unknown_supplier_code: 3, match: 4 };
  filtered.sort((a, b) => order[a.status] - order[b.status]);

  return NextResponse.json({ groups: filtered });
}

/**
 * POST /api/orders/mapping-verification
 *   body: { action: 'verify', product_id }
 *      → products.mapping_verified = true
 *   body: { action: 'reassign', order_ids, supplier_id, product_id? }
 *      → 주문 공급사 재배정 + 상품 검증 표시
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sb = getServiceClient();

  if (body.action === "verify") {
    if (!body.product_id) return NextResponse.json({ error: "product_id 필요" }, { status: 400 });
    const { error } = await sb
      .from("products")
      .update({ mapping_verified: true, mapping_verified_at: new Date().toISOString() })
      .eq("id", body.product_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reassign") {
    const { order_ids, supplier_id, product_id } = body;
    if (!Array.isArray(order_ids) || order_ids.length === 0 || !supplier_id) {
      return NextResponse.json({ error: "order_ids, supplier_id 필요" }, { status: 400 });
    }
    const { error: e1 } = await sb
      .from("orders")
      .update({ supplier_id, auto_assign_status: "manual" })
      .in("id", order_ids);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    if (product_id) {
      await sb
        .from("products")
        .update({ mapping_verified: true, mapping_verified_at: new Date().toISOString() })
        .eq("id", product_id);
    }
    return NextResponse.json({ ok: true, updated: order_ids.length });
  }

  return NextResponse.json({ error: "알 수 없는 action" }, { status: 400 });
}
