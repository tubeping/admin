import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/orders/auto-assign — 공급사 자동 배정
 *
 * 3단계 매칭:
 * 1. cafe24_product_no → product_cafe24_mappings → products.supplier (tubeping 매핑)
 * 2. 상품명에 [공급사명] 패턴이 있으면 매칭 (예: [귀빈정]26년전통...)
 * 3. 상품명으로 products 테이블 검색 → supplier 매칭
 */
export async function POST() {
  const sb = getServiceClient();

  // 1. 공급사 미배정 주문
  const { data: orders } = await sb
    .from("orders")
    .select("id, store_id, cafe24_product_no, product_name")
    .is("supplier_id", null)
    .neq("shipping_status", "cancelled");

  if (!orders || orders.length === 0) {
    return NextResponse.json({ message: "배정할 주문이 없습니다", assigned: 0, failed: 0 });
  }

  // 2. 공급사 목록
  const { data: suppliers } = await sb.from("suppliers").select("id, name");
  const nameToSupplierId: Record<string, string> = {};
  for (const s of suppliers || []) {
    nameToSupplierId[s.name] = s.id;
  }

  // 3. 매핑 테이블 (cafe24_product_no → product_id)
  const productNos = [...new Set(orders.map((o) => o.cafe24_product_no).filter((n) => n > 0))];
  let noToProductId: Record<number, string> = {};
  if (productNos.length > 0) {
    const { data: mappings } = await sb
      .from("product_cafe24_mappings")
      .select("cafe24_product_no, product_id")
      .in("cafe24_product_no", productNos);
    for (const m of mappings || []) {
      noToProductId[m.cafe24_product_no] = m.product_id;
    }
  }

  // 4. product_id → supplier name
  const productIds = [...new Set(Object.values(noToProductId))];
  let productToSupplier: Record<string, string> = {};
  if (productIds.length > 0) {
    const { data: products } = await sb
      .from("products")
      .select("id, supplier")
      .in("id", productIds);
    for (const p of products || []) {
      if (p.supplier) productToSupplier[p.id] = p.supplier;
    }
  }

  // 5. 전체 products 상품명 → supplier 맵 (상품명 매칭용)
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

  // 6. 공급사 이름 목록 (상품명에서 [공급사명] 추출용)
  const supplierNames = Object.keys(nameToSupplierId);

  // 7. 배정 실행
  let assigned = 0;
  let failed = 0;

  for (const order of orders) {
    let supplierName: string | null = null;

    // 방법 1: cafe24_product_no → mappings → products.supplier
    if (!supplierName && order.cafe24_product_no > 0) {
      const productId = noToProductId[order.cafe24_product_no];
      if (productId) {
        supplierName = productToSupplier[productId] || null;
      }
    }

    // 방법 2: 상품명에서 [공급사명] 패턴 추출
    if (!supplierName && order.product_name) {
      const bracketMatch = order.product_name.match(/^\[([^\]]+)\]/);
      if (bracketMatch) {
        const name = bracketMatch[1];
        if (nameToSupplierId[name]) {
          supplierName = name;
        }
      }
    }

    // 방법 3: 상품명으로 products 테이블 매칭
    if (!supplierName && order.product_name) {
      const trimmed = order.product_name.trim();
      // 정확히 일치
      if (productNameToSupplier[trimmed]) {
        supplierName = productNameToSupplier[trimmed];
      } else {
        // 부분 일치 (앞 20자)
        const prefix = trimmed.substring(0, 20);
        for (const [pName, pSupplier] of Object.entries(productNameToSupplier)) {
          if (pName.startsWith(prefix)) {
            supplierName = pSupplier;
            break;
          }
        }
      }
    }

    // 배정
    if (supplierName) {
      const supplierId = nameToSupplierId[supplierName];
      if (supplierId) {
        const { error } = await sb.from("orders").update({ supplier_id: supplierId }).eq("id", order.id);
        if (!error) { assigned++; continue; }
      }
    }

    failed++;
  }

  return NextResponse.json({ total: orders.length, assigned, failed });
}
