import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, cafe24Fetch } from "@/lib/cafe24";

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
  const map: Record<string, string> = {
    N00: "pending",      // 입금전
    N10: "pending",      // 상품준비중
    N20: "ordered",      // 배송준비중
    N21: "ordered",      // 배송대기
    N22: "shipping",     // 배송보류
    N30: "shipping",     // 배송중
    N40: "delivered",    // 배송완료
    C00: "cancelled",    // 취소
    C10: "cancelled",    // 취소처리중
    C34: "cancelled",    // 취소완료
    R00: "cancelled",    // 반품
  };
  return map[status] || "pending";
}

/**
 * 카페24에서 주문 목록 조회
 */
async function fetchOrdersFromStore(
  store: { id: string; mall_id: string; name: string; access_token: string; refresh_token: string; token_expires_at: string | null },
  startDate: string,
  endDate: string
) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    limit: "100",
    embed: "items",
  });

  const res = await cafe24Fetch(store, `/orders?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`주문 조회 실패 [${store.mall_id}]: ${res.status} - ${text}`);
  }

  const data = await res.json();
  return data.orders || [];
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
    shipping_company: string;
    tracking_number: string;
    shipped_at: string | null;
    shipping_status: string;
  }[] = [];

  for (const order of cafe24Orders) {
    const items = order.items || [order];
    for (const item of items) {
      rows.push({
        store_id: storeId,
        cafe24_order_id: order.order_id || item.order_id,
        cafe24_order_item_code: item.order_item_code || "",
        order_date: order.order_date || item.order_date,
        buyer_name: order.buyer_name || "",
        buyer_email: order.buyer_email || "",
        buyer_phone: order.buyer_cellphone || order.buyer_phone || "",
        receiver_name: order.receiver_name || "",
        receiver_phone: order.receiver_cellphone || order.receiver_phone || "",
        receiver_address: [order.receiver_address1, order.receiver_address2]
          .filter(Boolean)
          .join(" "),
        receiver_zipcode: order.receiver_zipcode || "",
        cafe24_product_no: item.product_no || 0,
        product_name: item.product_name || "",
        option_text: item.option_value || "",
        quantity: item.quantity || 1,
        product_price: parseInt(item.product_price || "0", 10),
        order_amount:
          (item.quantity || 1) * parseInt(item.product_price || "0", 10),
        shipping_company: item.shipping_company_name || "",
        tracking_number: item.tracking_no || "",
        shipped_at: item.tracking_no ? (item.shipped_date || new Date().toISOString()) : null,
        shipping_status: mapCafe24Status(item.order_status || order.order_status || ""),
      });
    }
  }

  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const { data, error } = await sb
    .from("orders")
    .upsert(rows, {
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
    let stores = await getActiveStores();
    if (filterStoreId) {
      stores = stores.filter((s) => s.id === filterStoreId);
    }

    const results = [];
    for (const store of stores) {
      try {
        const orders = await fetchOrdersFromStore(store, startDate, endDate);
        const saved = await saveOrdersToDb(store.id, orders);
        results.push({
          store: store.name,
          mall_id: store.mall_id,
          fetched: orders.length,
          ...saved,
        });
      } catch (err) {
        results.push({
          store: store.name,
          mall_id: store.mall_id,
          error: err instanceof Error ? err.message : "알 수 없는 오류",
        });
      }
    }

    // last_sync_at 갱신
    const sb = getServiceClient();
    for (const store of stores) {
      await sb
        .from("stores")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", store.id);
    }

    return NextResponse.json({
      period: { start_date: startDate, end_date: endDate },
      results,
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
    const stores = await getActiveStores();
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
