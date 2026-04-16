import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/orders/mapping-verification
 *   ?store_id=&start_date=&end_date=&include_verified=true
 *
 * 원칙: **자체코드(custom_product_code == tp_code) 기반 매핑**.
 * 주문을 (store_id, cafe24_product_no) 단위로 묶어 product_cafe24_mappings 테이블에서
 * TubePing product_id를 찾는다. 이름은 매칭 키로 사용하지 않고 표시용 라벨로만 쓴다.
 *
 * 상태:
 *  - match                : 매핑 존재 + tp_code 유효 + 현재 공급사가 tp_code 기반 공급사와 일치
 *  - mismatch             : 매핑 존재 + tp_code 유효 + 공급사 불일치
 *  - unmatched_product    : 매핑 없음 → 수동으로 상품 연결 필요
 *  - invalid_tp_code      : 매핑은 있지만 tp_code가 비정상 포맷
 *  - unknown_supplier_code: tp_code는 정상이나 공급사 코드가 suppliers에 없음
 */

const TP_CODE_RE = /^([A-Z]{2})([A-Z0-9]{2})\d+$/;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get("store_id");
  const startDate = sp.get("start_date");
  const endDate = sp.get("end_date");
  const includeVerified = sp.get("include_verified") === "true";

  const sb = getServiceClient();

  // 1. 대상 주문 fetch (취소 제외)
  let q = sb
    .from("orders")
    .select("id, store_id, cafe24_product_no, product_name, supplier_id, stores:store_id(name), suppliers:supplier_id(id, name, short_code)")
    .neq("shipping_status", "cancelled")
    .limit(5000);
  if (storeId) q = q.eq("store_id", storeId);
  if (startDate) q = q.gte("order_date", startDate);
  if (endDate) q = q.lte("order_date", endDate + "T23:59:59");

  const { data: orders, error: oErr } = await q;
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!orders || orders.length === 0) return NextResponse.json({ groups: [] });

  // 2. (store_id, cafe24_product_no) unique keys → mappings 조회
  type Order = {
    id: string;
    store_id: string;
    cafe24_product_no: number | null;
    product_name: string;
    supplier_id: string | null;
    stores: { name: string } | { name: string }[] | null;
    suppliers: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const ordersTyped = orders as Order[];

  const keySet = new Set<string>();
  for (const o of ordersTyped) {
    if (o.store_id && o.cafe24_product_no) {
      keySet.add(`${o.store_id}::${o.cafe24_product_no}`);
    }
  }
  const storeIds = [...new Set(ordersTyped.map((o) => o.store_id).filter(Boolean))];
  const cafeProductNos = [...new Set(ordersTyped.map((o) => o.cafe24_product_no).filter((n): n is number => !!n))];

  // mapping: (store_id, cafe24_product_no) → product_id (페이지네이션)
  const keyToProductId = new Map<string, string>();
  if (storeIds.length > 0 && cafeProductNos.length > 0) {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data: mappings } = await sb
        .from("product_cafe24_mappings")
        .select("product_id, store_id, cafe24_product_no")
        .in("store_id", storeIds)
        .in("cafe24_product_no", cafeProductNos)
        .range(from, from + pageSize - 1);
      if (!mappings || mappings.length === 0) break;
      for (const m of mappings) {
        if (m.store_id && m.cafe24_product_no != null) {
          keyToProductId.set(`${m.store_id}::${m.cafe24_product_no}`, m.product_id);
        }
      }
      if (mappings.length < pageSize) break;
      from += pageSize;
      if (from > 20000) break;
    }
  }

  // 3. product_id들로 products fetch
  const productIds = [...new Set([...keyToProductId.values()])];
  const productInfo = new Map<string, { tp_code: string | null; product_name: string; verified: boolean }>();
  if (productIds.length > 0) {
    const { data: prods } = await sb
      .from("products")
      .select("id, tp_code, product_name, mapping_verified")
      .in("id", productIds);
    for (const p of prods || []) {
      productInfo.set(p.id, {
        tp_code: p.tp_code,
        product_name: p.product_name,
        verified: !!p.mapping_verified,
      });
    }
  }

  // 4. 공급사 short_code → {id,name}
  const { data: suppliers } = await sb.from("suppliers").select("id, name, short_code");
  const codeToSupplier: Record<string, { id: string; name: string }> = {};
  for (const s of suppliers || []) {
    if (s.short_code) codeToSupplier[s.short_code.toUpperCase()] = { id: s.id, name: s.name };
  }

  // 5. 주문을 (store_id, cafe24_product_no) 단위로 group
  type Row = {
    order_id: string;
    store_name: string | null;
    current_supplier_id: string | null;
    current_supplier_name: string | null;
    product_name: string;
  };
  type GroupKey = string;
  const groupMap: Record<GroupKey, { store_id: string; cafe24_product_no: number | null; rows: Row[] }> = {};

  for (const o of ordersTyped) {
    const key = o.cafe24_product_no
      ? `${o.store_id}::${o.cafe24_product_no}`
      : `noproduct::${o.store_id}::${(o.product_name || "").trim()}`;
    if (!groupMap[key]) {
      groupMap[key] = {
        store_id: o.store_id,
        cafe24_product_no: o.cafe24_product_no,
        rows: [],
      };
    }
    const s = Array.isArray(o.stores) ? o.stores[0] : o.stores;
    const sup = Array.isArray(o.suppliers) ? o.suppliers[0] : o.suppliers;
    groupMap[key].rows.push({
      order_id: o.id,
      store_name: s?.name || null,
      current_supplier_id: sup?.id || null,
      current_supplier_name: sup?.name || null,
      product_name: (o.product_name || "").trim(),
    });
  }

  // 6. 각 group 상태 계산
  type Status = "match" | "mismatch" | "unmatched_product" | "invalid_tp_code" | "unknown_supplier_code";
  const groups = Object.entries(groupMap).map(([key, g]) => {
    const productId = g.cafe24_product_no ? keyToProductId.get(`${g.store_id}::${g.cafe24_product_no}`) : undefined;
    const prod = productId ? productInfo.get(productId) : undefined;

    let status: Status = "unmatched_product";
    let expectedSupplierId: string | null = null;
    let expectedSupplierName: string | null = null;
    let tpCode: string | null = null;
    let productName = g.rows[0]?.product_name || "";

    if (prod) {
      tpCode = prod.tp_code;
      productName = prod.product_name || productName;
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
            const currentIds = new Set(g.rows.map((r) => r.current_supplier_id));
            const allMatch = currentIds.size === 1 && currentIds.has(expectedSupplierId);
            status = allMatch ? "match" : "mismatch";
          }
        }
      }
    }

    return {
      key,
      product_name: productName,
      cafe24_product_no: g.cafe24_product_no,
      store_id: g.store_id,
      product_id: productId || null,
      tp_code: tpCode,
      mapping_verified: prod?.verified || false,
      expected_supplier_id: expectedSupplierId,
      expected_supplier_name: expectedSupplierName,
      order_count: g.rows.length,
      current_supplier_names: [...new Set(g.rows.map((r) => r.current_supplier_name || "(미배정)"))],
      store_names: [...new Set(g.rows.map((r) => r.store_name).filter(Boolean))] as string[],
      status,
      order_ids: g.rows.map((r) => r.order_id),
    };
  });

  const filtered = includeVerified ? groups : groups.filter((g) => !g.mapping_verified);
  const order = { mismatch: 0, unmatched_product: 1, invalid_tp_code: 2, unknown_supplier_code: 3, match: 4 };
  filtered.sort((a, b) => order[a.status] - order[b.status]);

  return NextResponse.json({ groups: filtered });
}

/**
 * POST /api/orders/mapping-verification
 *   body: { action: 'verify', product_id }
 *   body: { action: 'reassign', order_ids, supplier_id, product_id? }
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
