import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { cafe24Fetch } from "@/lib/cafe24";

export const maxDuration = 120;

/**
 * POST /api/orders/mapping-verification/link
 * body: { order_product_name: string, product_id: string, order_ids: string[] }
 *
 * 1) products.name_aliases 에 order_product_name 추가 (중복 제거)
 * 2) products.tp_code → suppliers.short_code → supplier_id 추출 후 order_ids 공급사 재배정
 * 3) products.mapping_verified = true
 * 4) product_cafe24_mappings 전체 순회하면서 각 cafe24 스토어에 custom_product_code = tp_code PUT
 */

const TP_CODE_RE = /^([A-Z]{2})([A-Z0-9]{2})\d+$/;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { order_product_name, product_id, order_ids } = body as {
    order_product_name?: string;
    product_id?: string;
    order_ids?: string[];
  };

  if (!order_product_name || !product_id) {
    return NextResponse.json({ error: "order_product_name, product_id 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 상품 조회
  const { data: product, error: pErr } = await sb
    .from("products")
    .select("id, tp_code, name_aliases")
    .eq("id", product_id)
    .single();
  if (pErr || !product) {
    return NextResponse.json({ error: "상품을 찾을 수 없습니다" }, { status: 404 });
  }

  // 2. name_aliases 추가
  const existing: string[] = product.name_aliases || [];
  const aliasName = order_product_name.trim();
  const newAliases = existing.includes(aliasName) ? existing : [...existing, aliasName];

  const { error: aErr } = await sb
    .from("products")
    .update({
      name_aliases: newAliases,
      mapping_verified: true,
      mapping_verified_at: new Date().toISOString(),
    })
    .eq("id", product_id);
  if (aErr) return NextResponse.json({ error: `상품 업데이트 실패: ${aErr.message}` }, { status: 500 });

  // 3. tp_code로 공급사 ID 추출
  let supplierId: string | null = null;
  const tpCode = product.tp_code;
  if (tpCode) {
    const m = tpCode.toUpperCase().match(TP_CODE_RE);
    if (m) {
      const { data: supplier } = await sb
        .from("suppliers")
        .select("id")
        .eq("short_code", m[2])
        .maybeSingle();
      supplierId = supplier?.id || null;
    }
  }

  // 4. 주문 재배정 (supplier_id 찾은 경우만)
  let reassigned = 0;
  if (supplierId && Array.isArray(order_ids) && order_ids.length > 0) {
    const { data: updated } = await sb
      .from("orders")
      .update({ supplier_id: supplierId, auto_assign_status: "manual" })
      .in("id", order_ids)
      .select("id");
    reassigned = updated?.length || 0;
  }

  // 5. cafe24 자체상품코드(custom_product_code) 푸시
  const cafe24Result = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [] as string[],
  };
  if (tpCode) {
    const { data: mappings } = await sb
      .from("product_cafe24_mappings")
      .select("cafe24_product_no, store_id, stores:store_id(id, mall_id, name, access_token, refresh_token, token_expires_at)")
      .eq("product_id", product_id);

    for (const mp of mappings || []) {
      const store = Array.isArray(mp.stores) ? mp.stores[0] : (mp.stores as {
        id: string; mall_id: string; name: string;
        access_token: string; refresh_token: string; token_expires_at: string | null;
      } | null);
      if (!store || !mp.cafe24_product_no) continue;
      cafe24Result.attempted++;
      try {
        const putRes = await cafe24Fetch(store, `/products/${mp.cafe24_product_no}`, {
          method: "PUT",
          body: JSON.stringify({ shop_no: 1, request: { custom_product_code: tpCode } }),
        });
        if (putRes.ok) {
          cafe24Result.succeeded++;
        } else {
          cafe24Result.failed++;
          if (cafe24Result.errors.length < 3) {
            const txt = await putRes.text();
            cafe24Result.errors.push(`${store.name}: ${putRes.status} ${txt.substring(0, 120)}`);
          }
        }
      } catch (e) {
        cafe24Result.failed++;
        if (cafe24Result.errors.length < 3) {
          cafe24Result.errors.push(`${store.name}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
      // rate limit 안전 간격
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  return NextResponse.json({
    ok: true,
    alias_added: aliasName,
    reassigned,
    cafe24: cafe24Result,
    supplier_assigned: !!supplierId,
  });
}
