import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 주문 → 공급사 자동 매칭 (자체코드 기준)
 *
 * 자체코드 형식: [채널 2자][공급사 2자][일련번호]
 *   - 채널: TP(튜핑) / EV(이벤트) / AT(아튜브 PB) / AC(ACTs)
 *   - 공급사 코드: 가운데 2자 (예: DV → 명진푸드시스템)
 *
 * 매칭 흐름:
 *   1. 주문 → products 행 식별
 *      - cafe24_product_no가 있으면 product_cafe24_mappings 사용 (cafe24 동기화)
 *      - 없으면 (Excel) product_name 정확 일치
 *      - 그래도 없으면 학습 캐시: 같은 상품명의 다른 주문이 이미 supplier_id 가지고 있으면 그대로 사용
 *   2. products.tp_code → 가운데 2자 추출 → suppliers.short_code 매칭
 *   3. supplier_id 업데이트
 */
export async function autoAssignSuppliers(
  sb: SupabaseClient,
  opts: { storeId?: string; orderIds?: string[] } = {}
): Promise<{ total: number; assigned: number; failed: number }> {
  let q = sb
    .from("orders")
    .select("id, store_id, cafe24_product_no, product_name")
    .is("supplier_id", null)
    .neq("shipping_status", "cancelled");
  if (opts.storeId) q = q.eq("store_id", opts.storeId);
  if (opts.orderIds && opts.orderIds.length > 0) q = q.in("id", opts.orderIds);

  const { data: orders } = await q;
  if (!orders || orders.length === 0) {
    return { total: 0, assigned: 0, failed: 0 };
  }

  // 공급사 short_code → id 맵
  const { data: suppliers } = await sb.from("suppliers").select("id, short_code");
  const codeToSupplierId: Record<string, string> = {};
  for (const s of suppliers || []) {
    if (s.short_code) codeToSupplierId[s.short_code.toUpperCase()] = s.id;
  }

  // 1) cafe24_product_no → product_id (cafe24 동기화 주문)
  const productNos = [...new Set(orders.map((o) => o.cafe24_product_no).filter((n) => n > 0))];
  const noToProductId: Record<number, string> = {};
  if (productNos.length > 0) {
    const { data: mappings } = await sb
      .from("product_cafe24_mappings")
      .select("cafe24_product_no, product_id")
      .in("cafe24_product_no", productNos);
    for (const m of mappings || []) noToProductId[m.cafe24_product_no] = m.product_id;
  }

  // 2) 상품명 → product_id (Excel 등 정확 일치)
  const targetNames = [...new Set(orders.map((o) => o.product_name?.trim()).filter(Boolean) as string[])];
  const nameToProductId: Record<string, string> = {};
  if (targetNames.length > 0) {
    const { data: products } = await sb
      .from("products")
      .select("id, product_name")
      .in("product_name", targetNames);
    for (const p of products || []) {
      if (p.product_name) nameToProductId[p.product_name.trim()] = p.id;
    }
  }

  // 3) product_id → tp_code 맵 (위 두 경로에서 수집된 모든 product_id)
  const productIds = [...new Set([...Object.values(noToProductId), ...Object.values(nameToProductId)])];
  const productIdToTpCode: Record<string, string> = {};
  if (productIds.length > 0) {
    const { data: products } = await sb
      .from("products")
      .select("id, tp_code")
      .in("id", productIds);
    for (const p of products || []) {
      if (p.tp_code) productIdToTpCode[p.id] = p.tp_code;
    }
  }

  // 4) 학습 캐시: 같은 상품명의 다른 주문이 이미 supplier_id를 가지면 사용
  const learnedNameToSupplierId: Record<string, string> = {};
  if (targetNames.length > 0) {
    const { data: prior } = await sb
      .from("orders")
      .select("product_name, supplier_id")
      .in("product_name", targetNames)
      .not("supplier_id", "is", null);
    for (const p of prior || []) {
      const k = (p.product_name || "").trim();
      if (k && p.supplier_id && !learnedNameToSupplierId[k]) {
        learnedNameToSupplierId[k] = p.supplier_id;
      }
    }
  }

  // tp_code에서 공급사 코드 추출 → suppliers.short_code → supplier_id
  // 엄격 포맷: [채널 2자][공급사 2자][숫자] (예: TPDV00789, EVDV00789)
  // 구형 포맷 (TP-0166 같은 하이픈 포함)은 공급사 코드가 없으므로 매칭 실패 처리
  const TP_CODE_RE = /^([A-Z]{2})([A-Z]{2})\d+$/;
  const supplierIdFromTpCode = (tpCode: string): string | null => {
    if (!tpCode) return null;
    const m = tpCode.toUpperCase().match(TP_CODE_RE);
    if (!m) return null;
    const code = m[2];
    return codeToSupplierId[code] || null;
  };

  let assigned = 0;
  let failed = 0;

  for (const order of orders) {
    let supplierId: string | null = null;

    // 경로 A: cafe24_product_no → tp_code → supplier
    if (order.cafe24_product_no > 0) {
      const productId = noToProductId[order.cafe24_product_no];
      if (productId) {
        const tpCode = productIdToTpCode[productId];
        if (tpCode) supplierId = supplierIdFromTpCode(tpCode);
      }
    }

    // 경로 B: 상품명 정확 일치 → tp_code → supplier
    if (!supplierId && order.product_name) {
      const productId = nameToProductId[order.product_name.trim()];
      if (productId) {
        const tpCode = productIdToTpCode[productId];
        if (tpCode) supplierId = supplierIdFromTpCode(tpCode);
      }
    }

    // 경로 C: 학습 캐시 — 같은 상품명의 다른 주문에 이미 배정된 supplier
    if (!supplierId && order.product_name) {
      supplierId = learnedNameToSupplierId[order.product_name.trim()] || null;
    }

    if (supplierId) {
      const { error } = await sb
        .from("orders")
        .update({ supplier_id: supplierId, auto_assign_status: "auto" })
        .eq("id", order.id);
      if (!error) {
        if (order.product_name) {
          learnedNameToSupplierId[order.product_name.trim()] = supplierId;
        }
        assigned++;
        continue;
      }
    }
    failed++;
  }

  return { total: orders.length, assigned, failed };
}
