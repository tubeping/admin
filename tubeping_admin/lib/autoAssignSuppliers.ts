import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 주문 → 공급사 자동 매칭
 *
 * 매칭 방법 (위에서부터 시도):
 *  1. cafe24_product_no → product_cafe24_mappings → products.supplier
 *  2. 상품명 앞부분 [공급사명] 패턴
 *  3. products 테이블 상품명과 정확/부분 일치
 *
 * @param sb         supabase service client
 * @param opts.storeId  특정 판매사 주문만 대상으로 제한
 * @param opts.orderIds 특정 주문 ID 목록만 대상으로 제한
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

  const { data: suppliers } = await sb.from("suppliers").select("id, name");
  const nameToSupplierId: Record<string, string> = {};
  for (const s of suppliers || []) nameToSupplierId[s.name] = s.id;

  // 학습 캐시: 같은 상품명으로 이미 supplier_id가 배정된 주문을 찾아 매핑
  // (한 번 매핑된 상품은 이후 자동으로 같은 공급사로 배정됨)
  const targetNames = [...new Set(orders.map((o) => o.product_name?.trim()).filter(Boolean) as string[])];
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

  const productNos = [...new Set(orders.map((o) => o.cafe24_product_no).filter((n) => n > 0))];
  const noToProductId: Record<number, string> = {};
  if (productNos.length > 0) {
    const { data: mappings } = await sb
      .from("product_cafe24_mappings")
      .select("cafe24_product_no, product_id")
      .in("cafe24_product_no", productNos);
    for (const m of mappings || []) noToProductId[m.cafe24_product_no] = m.product_id;
  }

  const productIds = [...new Set(Object.values(noToProductId))];
  const productToSupplier: Record<string, string> = {};
  if (productIds.length > 0) {
    const { data: products } = await sb.from("products").select("id, supplier").in("id", productIds);
    for (const p of products || []) {
      if (p.supplier) productToSupplier[p.id] = p.supplier;
    }
  }

  const { data: allProducts } = await sb
    .from("products")
    .select("product_name, supplier")
    .not("supplier", "is", null)
    .neq("supplier", "");
  const productNameToSupplier: Record<string, string> = {};
  for (const p of allProducts || []) {
    if (p.product_name && p.supplier) {
      productNameToSupplier[p.product_name.trim()] = p.supplier;
    }
  }

  let assigned = 0;
  let failed = 0;

  for (const order of orders) {
    let supplierName: string | null = null;
    let learnedSupplierId: string | null = null;

    // 0) 학습 캐시: 같은 상품명의 다른 주문이 이미 supplier_id를 가지고 있으면 그대로 사용
    if (order.product_name) {
      const k = order.product_name.trim();
      if (learnedNameToSupplierId[k]) {
        learnedSupplierId = learnedNameToSupplierId[k];
      }
    }

    // 1) cafe24_product_no 매핑
    if (!learnedSupplierId && !supplierName && order.cafe24_product_no > 0) {
      const productId = noToProductId[order.cafe24_product_no];
      if (productId) supplierName = productToSupplier[productId] || null;
    }

    // 2) [공급사명] 패턴
    if (!supplierName && order.product_name) {
      const m = order.product_name.match(/^\[([^\]]+)\]/);
      if (m && nameToSupplierId[m[1]]) supplierName = m[1];
    }

    // 3) 상품명 매칭 — 정확 일치만, 또는 충분히 긴 prefix(20자+) 양방향 일치
    // 짧은 이름의 substring 매칭은 오배정 위험이 높아 사용하지 않음
    if (!supplierName && order.product_name) {
      const trimmed = order.product_name.trim();
      if (productNameToSupplier[trimmed]) {
        supplierName = productNameToSupplier[trimmed];
      } else if (trimmed.length >= 20) {
        const prefix = trimmed.substring(0, 20);
        for (const [pName, pSupplier] of Object.entries(productNameToSupplier)) {
          // 양쪽 모두 prefix 20자가 일치할 때만 매칭 (짧은 이름은 제외)
          if (pName.length >= 20 && pName.substring(0, 20) === prefix) {
            supplierName = pSupplier;
            break;
          }
        }
      }
    }

    // 2) [공급사명] 패턴은 위에서 이미 처리, 3) 상품명 매칭도 위에서 이미 처리
    // 학습 캐시가 우선, 그 다음 method 1~3의 결과
    let finalSupplierId: string | null = learnedSupplierId;
    if (!finalSupplierId && supplierName) {
      finalSupplierId = nameToSupplierId[supplierName] || null;
    }

    if (finalSupplierId) {
      const { error } = await sb
        .from("orders")
        .update({ supplier_id: finalSupplierId, auto_assign_status: "auto" })
        .eq("id", order.id);
      if (!error) {
        // 캐시 갱신: 후속 같은 상품명의 주문이 이번 배정을 따라가도록
        if (order.product_name) {
          learnedNameToSupplierId[order.product_name.trim()] = finalSupplierId;
        }
        assigned++;
        continue;
      }
    }
    failed++;
  }

  return { total: orders.length, assigned, failed };
}
