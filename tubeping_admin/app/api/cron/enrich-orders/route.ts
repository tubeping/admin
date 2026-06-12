import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { env } from "@/lib/env.server";

const CRON_SECRET = env.CRON_SECRET;

/**
 * GET /api/cron/enrich-orders — 주문 product_id 매핑 + 가격 보충
 * Vercel Cron으로 하루 3회 (08:00, 13:00, 17:00) 실행
 *
 * 1) cafe24_product_no → product_cafe24_mappings → product_id
 * 2) product_name 정확/정규화 매칭 → product_id
 * 3) 매칭 불가 상품 → products 신규 등록
 * 4) product_price / order_amount 보충
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const stats = { cafe24Mapped: 0, nameMatched: 0, created: 0, priceFilled: 0 };

  // ── 전체 products 로드 (1000개 이상 대응) ──
  let allProducts: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb
      .from("products")
      .select("id, product_name, supply_price, supply_shipping_fee, price")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allProducts = allProducts.concat(data);
    offset += data.length;
    if (data.length < 1000) break;
  }

  // ── STEP 1: cafe24 매핑으로 product_id 설정 ──
  const { data: noIdWithCafe24 } = await sb
    .from("orders")
    .select("id, store_id, cafe24_product_no")
    .neq("shipping_status", "draft")
    .is("product_id", null)
    .gt("cafe24_product_no", 0)
    .limit(2000);

  if (noIdWithCafe24 && noIdWithCafe24.length > 0) {
    const cafe24Nos = [...new Set(noIdWithCafe24.map((o: any) => o.cafe24_product_no))];
    const { data: mappings } = await sb
      .from("product_cafe24_mappings")
      .select("store_id, cafe24_product_no, product_id")
      .in("cafe24_product_no", cafe24Nos);

    const mappingMap: Record<string, string> = {};
    for (const m of mappings || []) {
      mappingMap[`${m.store_id}::${m.cafe24_product_no}`] = m.product_id;
    }

    for (const o of noIdWithCafe24) {
      const pid = mappingMap[`${o.store_id}::${o.cafe24_product_no}`];
      if (pid) {
        const { error } = await sb.from("orders").update({ product_id: pid }).eq("id", o.id);
        if (!error) stats.cafe24Mapped++;
      }
    }
  }

  // ── STEP 2: 상품명 매칭으로 product_id 설정 ──
  const { data: stillNoId } = await sb
    .from("orders")
    .select("id, product_name")
    .neq("shipping_status", "draft")
    .is("product_id", null)
    .limit(2000);

  if (stillNoId && stillNoId.length > 0) {
    const exactMap: Record<string, any> = {};
    const normalMap: Record<string, any> = {};

    function normalize(s: string) {
      return s
        .trim()
        .replace(/\s+/g, "")
        .replace(/[*xX×]/g, "x")
        .replace(/\/+/g, "/")
        .toLowerCase();
    }

    for (const p of allProducts) {
      if (p.product_name) {
        exactMap[p.product_name.trim()] = p;
        normalMap[normalize(p.product_name)] = p;
      }
    }

    for (const o of stillNoId) {
      const name = o.product_name?.trim();
      if (!name) continue;
      const matched = exactMap[name] || normalMap[normalize(name)];
      if (matched) {
        const { error } = await sb.from("orders").update({ product_id: matched.id }).eq("id", o.id);
        if (!error) stats.nameMatched++;
      }
    }
  }

  // ── STEP 3: 매칭 불가 상품 → products 신규 등록 ──
  const { data: remaining } = await sb
    .from("orders")
    .select("id, product_name, product_price, supplier_id")
    .neq("shipping_status", "draft")
    .is("product_id", null)
    .limit(2000);

  if (remaining && remaining.length > 0) {
    // 기존 max TP 번호 조회
    const { data: maxTp } = await sb
      .from("products")
      .select("tp_code")
      .ilike("tp_code", "TP00%")
      .order("tp_code", { ascending: false })
      .limit(1);
    let nextNum = 2000;
    if (maxTp && maxTp[0]) {
      const m = maxTp[0].tp_code.match(/TP(\d+)/);
      if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1);
    }

    // 공급사 id → name (자동생성 상품의 supplier 컬럼 채우기용)
    const supplierNameById: Record<string, string> = {};
    {
      const { data: sups } = await sb.from("suppliers").select("id, name");
      for (const s of sups || []) if (s.name) supplierNameById[s.id] = s.name;
    }

    const groups: Record<string, { orderIds: string[]; price: number; supplierId: string | null }> = {};
    for (const o of remaining) {
      const name = o.product_name?.trim();
      if (!name) continue;
      if (!groups[name]) groups[name] = { orderIds: [], price: 0, supplierId: null };
      groups[name].orderIds.push(o.id);
      if (o.product_price > 0 && !groups[name].price) groups[name].price = o.product_price;
      if (o.supplier_id && !groups[name].supplierId) groups[name].supplierId = o.supplier_id;
    }

    for (const [productName, info] of Object.entries(groups)) {
      const tpCode = "TP" + String(nextNum++).padStart(7, "0");
      const insertData: any = {
        tp_code: tpCode,
        product_name: productName,
        price: info.price || 0,
        supply_price: 0,
        supply_shipping_fee: 0,
        approval_status: "approved",
      };
      // 공급사명만 채운다. 출고지(fulfillment_warehouse_supplier_id)는 '사입 창고(이음로직스 등)'
      // 전용 필드라 자동 설정하지 않음 — 미설정이면 자체배송. (공급사를 창고로 박던 버그 수정)
      if (info.supplierId && supplierNameById[info.supplierId]) {
        insertData.supplier = supplierNameById[info.supplierId];
      }

      const { data: newProduct, error: insertErr } = await sb
        .from("products")
        .insert(insertData)
        .select("id")
        .single();

      if (insertErr || !newProduct) continue;
      stats.created++;

      await sb.from("orders").update({ product_id: newProduct.id }).in("id", info.orderIds);
    }
  }

  // ── STEP 4: product_price / order_amount 보충 ──
  const { data: needPrice } = await sb
    .from("orders")
    .select("id, product_id, quantity, product_price, order_amount")
    .neq("shipping_status", "draft")
    .not("product_id", "is", null)
    .or("product_price.is.null,product_price.eq.0")
    .limit(2000);

  if (needPrice && needPrice.length > 0) {
    const pids = [...new Set(needPrice.map((o: any) => o.product_id))];
    const pidToPrice: Record<string, number> = {};

    for (let i = 0; i < pids.length; i += 500) {
      const batch = pids.slice(i, i + 500);
      const { data: prods } = await sb.from("products").select("id, price").in("id", batch);
      for (const p of prods || []) {
        if (p.price) pidToPrice[p.id] = p.price;
      }
    }

    for (const o of needPrice) {
      const price = pidToPrice[o.product_id];
      if (!price) continue;
      const updates: any = { product_price: price };
      updates.order_amount = price * (o.quantity || 1);
      const { error } = await sb.from("orders").update(updates).eq("id", o.id);
      if (!error) stats.priceFilled++;
    }
  }

  return NextResponse.json({
    success: true,
    stats,
    timestamp: new Date().toISOString(),
  });
}
