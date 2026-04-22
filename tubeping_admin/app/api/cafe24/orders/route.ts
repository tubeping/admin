import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCafe24Stores, cafe24Fetch } from "@/lib/cafe24";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";

/**
 * GET /api/cafe24/orders — 전체 스토어의 주문 수집 (카페24 → Supabase)
 * ?start_date=2026-04-01&end_date=2026-04-03&store_id=xxx (선택)
 *
 * POST /api/cafe24/orders — 특정 스토어 주문을 수동으로 가져오기
 * body: { store_id, start_date, end_date }
 */

interface Cafe24OrderItem {
  order_id: string;
  order_item_code: string;
  product_no: number;
  product_name: string;
  option_value: string;
  quantity: number;
  product_price: string;
  order_date: string;
  buyer_name: string;
  buyer_email: string;
  buyer_cellphone: string;
  receiver_name: string;
  receiver_cellphone: string;
  receiver_address1: string;
  receiver_address2: string;
  receiver_zipcode: string;
  shipping_company_name: string;
  tracking_no: string;
  order_status: string;
}

function mapCafe24Status(status: string): string {
  // N10(상품준비중)·N20(배송준비중)은 신용카드 PG 결제가 이미 완료된 상태 → admin에서 '입금완료'(ordered)로 반영
  // 수동 입금확인 대상은 N00(입금전) + 전화주문(EXCEL-*)만
  if (!status) return "pending";
  // 모든 C*(취소 계열: C00/C10/C34/C40/C48 등), R*(반품 계열)은 cancelled
  if (status.startsWith("C") || status.startsWith("R")) return "cancelled";
  const map: Record<string, string> = {
    N00: "pending",      // 입금전 — 유일한 pending 대상
    N10: "ordered",      // 상품준비중 (결제완료)
    N20: "ordered",      // 배송준비중
    N21: "ordered",      // 배송대기
    N22: "shipping",     // 배송보류
    N30: "shipping",     // 배송중
    N40: "delivered",    // 배송완료
  };
  return map[status] || "pending";
}

/**
 * 수집된 주문 중 상품준비중(N00/N10) 상태인 것을 배송준비중(N20)으로 자동 전환
 * 올바른 포맷: PUT /admin/orders (벌크) { shop_no: 1, requests: [{ order_id, process_status: "prepare" }] }
 */
async function transitionPendingToReady(
  store: { id: string; mall_id: string; name: string; access_token: string; refresh_token: string; token_expires_at: string | null },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cafe24Orders: any[]
) {
  const orderIds = new Set<string>();
  for (const order of cafe24Orders) {
    const items = order.items || [order];
    const orderId = order.order_id;
    if (!orderId) continue;
    for (const item of items) {
      const st = item.order_status || order.order_status || "";
      if (st === "N00" || st === "N10") {
        orderIds.add(orderId);
        break;
      }
    }
  }

  const transitioned: string[] = [];
  const failed: { order_id: string; error: string }[] = [];

  // 벌크 PUT /orders 는 requests 배열로 여러 주문 한 번에
  // 안전하게 50건씩 나눠서 처리
  const BATCH = 50;
  const orderIdList = Array.from(orderIds);
  for (let i = 0; i < orderIdList.length; i += BATCH) {
    const slice = orderIdList.slice(i, i + BATCH);
    try {
      const res = await cafe24Fetch(store, `/orders`, {
        method: "PUT",
        body: JSON.stringify({
          shop_no: 1,
          requests: slice.map((id) => ({ order_id: id, process_status: "prepare" })),
        }),
      });
      if (res.ok) {
        transitioned.push(...slice);
      } else {
        const txt = await res.text();
        for (const id of slice) failed.push({ order_id: id, error: `${res.status}: ${txt.substring(0, 120)}` });
      }
    } catch (e) {
      for (const id of slice) failed.push({ order_id: id, error: e instanceof Error ? e.message : "unknown" });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { transitioned, failed };
}

/**
 * 카페24에서 주문 목록 조회
 */
async function fetchOrdersFromStore(
  store: { id: string; mall_id: string; name: string; access_token: string; refresh_token: string; token_expires_at: string | null },
  startDate: string,
  endDate: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  const pageLimit = 100;
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      limit: String(pageLimit),
      offset: String(offset),
      embed: "items,receivers",
      date_type: "order_date",
    });
    const res = await cafe24Fetch(store, `/orders?${params}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`주문 조회 실패 [${store.mall_id}]: ${res.status} - ${text}`);
    }
    const data = await res.json();
    const page = data.orders || [];
    if (page.length === 0) break;
    // 입금전(N00)만 제외 — 결제 전 주문은 admin에 저장하지 않음.
    // 취소(C00/C10/C34)·반품(R00)은 포함해서 수집 → 기존 admin 주문의 상태를 'cancelled'로 동기화.
    // (신규 주문이 C* 상태로 들어온 경우는 saveOrdersToDb에서 기존 row 없으면 insert 생략)
    const EXCLUDE_STATUS = new Set(["N00"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = page.filter((o: any) => {
      const items = o.items || [o];
      return items.some((it: { order_status?: string }) => !EXCLUDE_STATUS.has(it.order_status || o.order_status || ""));
    });
    all.push(...valid);
    if (page.length < pageLimit) break;
    offset += pageLimit;
    if (offset > 5000) break; // 안전장치
  }
  return all;
}

/**
 * 카페24 주문 → Supabase 저장 (upsert)
 */
async function saveOrdersToDb(
  storeId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cafe24Orders: any[]
) {
  const sb = getServiceClient();
  const rows: {
    store_id: string;
    cafe24_order_id: string;
    cafe24_order_item_code: string;
    order_date: string;
    buyer_name: string;
    buyer_email: string;
    buyer_phone: string;
    receiver_name: string;
    receiver_phone: string;
    receiver_address: string;
    receiver_zipcode: string;
    cafe24_product_no: number;
    product_name: string;
    option_text: string;
    quantity: number;
    product_price: number;
    order_amount: number;
    memo: string;
    shipping_company: string;
    tracking_number: string;
    shipped_at: string | null;
    shipping_status: string;
  }[] = [];

  for (const order of cafe24Orders) {
    const items = order.items || [order];
    const receiver = order.receivers?.[0] || {};
    for (const item of items) {
      rows.push({
        store_id: storeId,
        cafe24_order_id: order.order_id || item.order_id,
        cafe24_order_item_code: item.order_item_code || "",
        order_date: order.order_date || item.order_date,
        buyer_name: order.buyer_name || "",
        buyer_email: order.buyer_email || "",
        buyer_phone: order.buyer_cellphone || order.buyer_phone || "",
        receiver_name: receiver.name || order.receiver_name || "",
        receiver_phone: receiver.cellphone || receiver.phone || order.receiver_cellphone || order.receiver_phone || "",
        receiver_address: [receiver.address1 || order.receiver_address1, receiver.address2 || order.receiver_address2]
          .filter(Boolean)
          .join(" "),
        receiver_zipcode: receiver.zipcode || order.receiver_zipcode || "",
        cafe24_product_no: item.product_no || 0,
        product_name: item.product_name || "",
        option_text: item.option_value || "",
        quantity: item.quantity || 1,
        product_price: parseInt(item.product_price || "0", 10),
        order_amount:
          (item.quantity || 1) * parseInt(item.product_price || "0", 10),
        memo: receiver.shipping_message || order.shipping_message || order.user_message || "",
        shipping_company: item.shipping_company_name || "",
        tracking_number: item.tracking_no || "",
        shipped_at: item.tracking_no ? (item.shipped_date || new Date().toISOString()) : null,
        // cancel_date가 있으면 order_status와 무관하게 cancelled 강제 (C* 외 코드 커버)
        shipping_status: (item.cancel_date || order.cancel_date)
          ? "cancelled"
          : mapCafe24Status(item.order_status || order.order_status || ""),
      });
    }
  }

  if (rows.length === 0) return { inserted: 0, updated: 0 };

  // 기존 row 조회 — 덮어쓰기 방지용
  // 이미 supplier/admin이 입력한 송장·배송상태는 카페24가 빈 값을 돌려줄 때 보존
  const cafeOrderIds = [...new Set(rows.map((r) => r.cafe24_order_id))];
  const { data: existingRows } = await sb
    .from("orders")
    .select("id, cafe24_order_id, cafe24_order_item_code, tracking_number, shipping_company, shipped_at, shipping_status")
    .eq("store_id", storeId)
    .in("cafe24_order_id", cafeOrderIds);

  const existingMap = new Map<string, { tracking_number: string | null; shipping_company: string | null; shipped_at: string | null; shipping_status: string | null }>();
  for (const e of existingRows || []) {
    existingMap.set(`${e.cafe24_order_id}::${e.cafe24_order_item_code || ""}`, {
      tracking_number: e.tracking_number,
      shipping_company: e.shipping_company,
      shipped_at: e.shipped_at,
      shipping_status: e.shipping_status,
    });
  }

  // 보호 로직:
  //  1) tracking_number: 카페24가 빈 값이면 기존 값 유지
  //  2) shipping_status: ordered/shipping/delivered → pending 다운그레이드 금지
  //     단, cancelled는 항상 override (카페24에서 취소 확정된 경우 admin에도 반영)
  //  3) 신규 insert인데 cancelled면 skip — 취소된 주문을 새로 DB에 넣지 않음
  const NON_DOWNGRADE = new Set(["ordered", "shipping", "delivered"]);
  const filteredRows: typeof rows = [];
  for (const r of rows) {
    const key = `${r.cafe24_order_id}::${r.cafe24_order_item_code || ""}`;
    const existing = existingMap.get(key);
    if (!existing) {
      // 신규인데 cancelled면 insert 스킵
      if (r.shipping_status === "cancelled") continue;
      filteredRows.push(r);
      continue;
    }
    if (!r.tracking_number && existing.tracking_number) {
      r.tracking_number = existing.tracking_number;
      if (!r.shipping_company && existing.shipping_company) r.shipping_company = existing.shipping_company;
      if (!r.shipped_at && existing.shipped_at) r.shipped_at = existing.shipped_at;
    }
    // cancelled는 항상 override (기존 ordered/shipping/delivered여도 cancelled로 바꿈)
    if (r.shipping_status !== "cancelled"
        && existing.shipping_status
        && NON_DOWNGRADE.has(existing.shipping_status)
        && !NON_DOWNGRADE.has(r.shipping_status)) {
      r.shipping_status = existing.shipping_status;
    }
    filteredRows.push(r);
  }

  if (filteredRows.length === 0) return { saved: 0 };

  const { data, error } = await sb
    .from("orders")
    .upsert(filteredRows, {
      onConflict: "store_id,cafe24_order_id,cafe24_order_item_code",
      ignoreDuplicates: false,
    })
    .select("id");

  if (error) throw new Error(`주문 저장 실패: ${error.message}`);
  return { saved: data?.length || 0 };
}

/**
 * GET — 전체 스토어 주문 수집
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const startDate =
    searchParams.get("start_date") ||
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate =
    searchParams.get("end_date") ||
    new Date().toISOString().slice(0, 10);
  const filterStoreId = searchParams.get("store_id");

  try {
    let stores = await getCafe24Stores();
    if (filterStoreId) {
      stores = stores.filter((s) => s.id === filterStoreId);
    }

    // 모든 스토어를 병렬로 호출
    const results = await Promise.all(
      stores.map(async (store) => {
        try {
          const orders = await fetchOrdersFromStore(store, startDate, endDate);
          const saved = await saveOrdersToDb(store.id, orders);
          // 수집 직후 N00/N10 주문을 N20(배송준비중)으로 자동 전환
          const transition = await transitionPendingToReady(store, orders);
          // 우리 DB도 해당 주문의 shipping_status를 ordered로 갱신
          if (transition.transitioned.length > 0) {
            const sb2 = getServiceClient();
            await sb2
              .from("orders")
              .update({ shipping_status: "ordered" })
              .eq("store_id", store.id)
              .in("cafe24_order_id", transition.transitioned)
              .eq("shipping_status", "pending");
          }
          return {
            store: store.name,
            mall_id: store.mall_id,
            fetched: orders.length,
            ...saved,
            transitioned: transition.transitioned.length,
            transition_failed: transition.failed.length,
            transition_errors: transition.failed,
          };
        } catch (err) {
          return {
            store: store.name,
            mall_id: store.mall_id,
            error: err instanceof Error ? err.message : "알 수 없는 오류",
          };
        }
      })
    );

    // last_sync_at 갱신 (성공한 스토어만)
    const sb = getServiceClient();
    await Promise.all(
      stores.map((store) =>
        sb.from("stores").update({ last_sync_at: new Date().toISOString() }).eq("id", store.id)
      )
    );

    // 공급사 자동 배정 (미배정 주문 전체)
    let autoAssign: { total: number; assigned: number; failed: number } | null = null;
    try {
      autoAssign = await autoAssignSuppliers(sb);
    } catch { /* ignore */ }

    return NextResponse.json({
      period: { start_date: startDate, end_date: endDate },
      results,
      auto_assign: autoAssign,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "주문 수집 실패" },
      { status: 500 }
    );
  }
}

/**
 * POST — 수동 주문 수집 (특정 스토어)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { store_id, start_date, end_date } = body;

  if (!store_id || !start_date || !end_date) {
    return NextResponse.json(
      { error: "store_id, start_date, end_date 필수" },
      { status: 400 }
    );
  }

  try {
    const stores = await getCafe24Stores();
    const store = stores.find((s) => s.id === store_id);
    if (!store) {
      return NextResponse.json({ error: "스토어를 찾을 수 없습니다" }, { status: 404 });
    }

    const orders = await fetchOrdersFromStore(store, start_date, end_date);
    const saved = await saveOrdersToDb(store.id, orders);

    return NextResponse.json({
      store: store.name,
      mall_id: store.mall_id,
      fetched: orders.length,
      ...saved,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "주문 수집 실패" },
      { status: 500 }
    );
  }
}
