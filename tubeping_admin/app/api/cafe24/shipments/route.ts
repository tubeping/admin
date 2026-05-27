import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, cafe24Fetch, isCafe24Mall } from "@/lib/cafe24";

/**
 * POST /api/cafe24/shipments — 송장번호를 카페24에 연동
 * body: { order_ids?: string[] }  (비어있으면 미연동 전체 처리)
 *
 * 로직:
 * 1. orders 테이블에서 tracking_number 있고 cafe24_shipping_synced=false인 건 조회
 * 2. 각 건을 카페24 API로 발송처리
 * 3. 성공 시 cafe24_shipping_synced=true 업데이트
 */

// 택배사 이름 정규화 (공백/특수문자 제거)
function normalizeCarrier(name: string): string {
  return (name || "").replace(/[\s()\-·]/g, "").toLowerCase();
}

// 스토어별 택배사 목록 캐시: { store_id → { normalizedName → shipping_carrier_code } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchStoreCarriers(store: any): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const res = await cafe24Fetch(store, "/carriers?limit=100");
    if (!res.ok) return out;
    const data = await res.json();
    // Cafe24 /admin/carriers 응답: { carriers: [{ shipping_carrier_code, shipping_carrier, ... }] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = data.carriers || [];
    for (const c of list) {
      const code = c.shipping_carrier_code;
      const name = c.shipping_carrier;
      if (code && name) {
        out[normalizeCarrier(name)] = code;
      }
    }
  } catch (e) { console.error("[cafe24/shipments] fetchStoreCarriers failed:", e); }
  return out;
}

// 스토어의 등록된 택배사 목록에서 매칭. fallback: 부분 매칭
function resolveShippingCode(
  companyName: string,
  carriers: Record<string, string>
): string | null {
  if (!companyName) return null;
  const norm = normalizeCarrier(companyName);
  if (carriers[norm]) return carriers[norm];
  // 부분 매칭 (한진 ↔ 한진택배 등)
  for (const [regName, code] of Object.entries(carriers)) {
    if (regName.includes(norm) || norm.includes(regName)) return code;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const orderIds: string[] | undefined = body.order_ids;
  const purchaseOrderId: string | undefined = body.purchase_order_id;

  const sb = getServiceClient();

  // 1. 미연동 송장 조회
  let query = sb
    .from("orders")
    .select("id, store_id, cafe24_order_id, cafe24_order_item_code, shipping_company, tracking_number")
    .eq("cafe24_shipping_synced", false)
    .not("tracking_number", "is", null)
    .neq("tracking_number", "");

  if (orderIds && orderIds.length > 0) {
    query = query.in("id", orderIds);
  }
  if (purchaseOrderId) {
    query = query.eq("purchase_order_id", purchaseOrderId);
  }

  const { data: orders, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ message: "연동할 송장이 없습니다", synced: 0 });
  }

  // 2. 카페24 스토어만 대상 (Acts29 같은 비카페24 플랫폼은 제외)
  const { getCafe24Stores: getCafe24 } = await import("@/lib/cafe24");
  const cafe24Stores = await getCafe24();
  const storeMap = Object.fromEntries(cafe24Stores.map((s) => [s.id, s]));
  // 비카페24 스토어 주문은 cafe24_shipping_synced=true로 마킹 (대상 아님)
  const nonCafe24Orders = orders.filter((o) => !storeMap[o.store_id]);
  if (nonCafe24Orders.length > 0) {
    await sb
      .from("orders")
      .update({ cafe24_shipping_synced: true, cafe24_shipping_synced_at: new Date().toISOString() })
      .in("id", nonCafe24Orders.map((o) => o.id));
  }
  const cafe24Orders = orders.filter((o) => storeMap[o.store_id]);
  if (cafe24Orders.length === 0) {
    return NextResponse.json({ message: "연동할 카페24 송장이 없습니다", synced: 0, skipped_non_cafe24: nonCafe24Orders.length });
  }

  // 스토어별 등록된 택배사 목록을 한 번만 로드해서 캐시
  const carriersByStore: Record<string, Record<string, string>> = {};

  const results: { order_id: string; cafe24_order_id: string; success: boolean; error?: string }[] = [];

  // 스토어 택배사 목록 사전 로드 (중복 방지)
  const uniqueStoreIds = [...new Set(cafe24Orders.map((o) => o.store_id))];
  await Promise.all(
    uniqueStoreIds
      .filter((sid) => storeMap[sid])
      .map(async (sid) => { carriersByStore[sid] = await fetchStoreCarriers(storeMap[sid]); })
  );

  // 개별 주문 처리 함수
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function processOrder(order: any) {
    const store = storeMap[order.store_id];
    if (!store) {
      return { order_id: order.id, cafe24_order_id: order.cafe24_order_id, success: false, error: "스토어 정보 없음" };
    }

    // C24- 접두어 제거 → Cafe24 API용 원본 주문번호
    const rawOrderId = (order.cafe24_order_id || "").replace(/^C24-/, "");
    const isCafe24Order = /^\d{8}-\d{7}$/.test(rawOrderId);
    if (!isCafe24Mall(store.mall_id) || !isCafe24Order) {
      await sb
        .from("orders")
        .update({ cafe24_shipping_synced: true, cafe24_shipping_synced_at: new Date().toISOString() })
        .eq("id", order.id);
      return { order_id: order.id, cafe24_order_id: order.cafe24_order_id, success: true };
    }

    const code = resolveShippingCode(order.shipping_company || "", carriersByStore[order.store_id] || {});
    if (!code) {
      const registered = Object.keys(carriersByStore[order.store_id] || {}).join(", ") || "(조회 실패)";
      return { order_id: order.id, cafe24_order_id: order.cafe24_order_id, success: false, error: `택배사 '${order.shipping_company}' 미등록 — 등록된 택배사: ${registered}` };
    }

    try {
      try {
        await cafe24Fetch(store, `/orders`, {
          method: "PUT",
          body: JSON.stringify({ shop_no: 1, requests: [{ order_id: rawOrderId, process_status: "prepare" }] }),
        });
      } catch (e) { console.error("[cafe24/shipments] set prepare status failed (이미 N20 이상일 수 있음):", e); }

      const res = await cafe24Fetch(store, `/orders/${rawOrderId}/shipments`, {
        method: "POST",
        body: JSON.stringify({
          shop_no: 1,
          request: {
            shipping_company_code: code,
            tracking_no: order.tracking_number,
            order_item_code: [order.cafe24_order_item_code],
            status: "shipping",
          },
        }),
      });

      if (res.ok) {
        await sb.from("orders").update({
          cafe24_shipping_synced: true, cafe24_shipping_synced_at: new Date().toISOString(),
          shipping_status: "shipping", shipped_at: new Date().toISOString(),
        }).eq("id", order.id);
        return { order_id: order.id, cafe24_order_id: order.cafe24_order_id, success: true };
      } else {
        const errText = await res.text();
        if (res.status === 422 && errText.includes("cannot change")) {
          try {
            const checkRes = await cafe24Fetch(store, `/orders/${rawOrderId}?embed=items`);
            if (checkRes.ok) {
              const detailData = await checkRes.json();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const items: any[] = detailData?.order?.items || [];
              const it = items.find((i: { order_item_code: string }) => i.order_item_code === order.cafe24_order_item_code);
              if (it && it.tracking_no && ["N21", "N22", "N30", "N40"].includes(it.order_status || "")) {
                await sb.from("orders").update({
                  cafe24_shipping_synced: true, cafe24_shipping_synced_at: new Date().toISOString(),
                  shipping_status: "shipping", tracking_number: it.tracking_no,
                  shipping_company: it.shipping_company_name || order.shipping_company, shipped_at: new Date().toISOString(),
                }).eq("id", order.id);
                return { order_id: order.id, cafe24_order_id: order.cafe24_order_id, success: true };
              }
            }
          } catch (e) { console.error("[cafe24/shipments] shipment retry/fallback failed:", e); }
        }
        return { order_id: order.id, cafe24_order_id: order.cafe24_order_id, success: false, error: `${res.status}: ${errText}` };
      }
    } catch (err) {
      return { order_id: order.id, cafe24_order_id: order.cafe24_order_id, success: false, error: err instanceof Error ? err.message : "알 수 없는 오류" };
    }
  }

  // 5개씩 배치로 병렬 처리 (카페24 API rate limit 고려)
  const BATCH_SIZE = 5;
  for (let i = 0; i < cafe24Orders.length; i += BATCH_SIZE) {
    const batch = cafe24Orders.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(processOrder));
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
      else results.push({ order_id: "", cafe24_order_id: "", success: false, error: String(r.reason) });
    }
  }

  const synced = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({
    total: results.length,
    synced,
    failed,
    results,
  });
}
