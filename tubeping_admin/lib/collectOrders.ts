import { getServiceClient } from "@/lib/supabase";
import { cafe24Fetch, type StoreInfo } from "@/lib/cafe24";

/**
 * 카페24 주문 수집 공용 로직.
 * 자동 크론(cron/collect-orders)과 수동 수집(cafe24/orders)이 동일한 저장 규칙을
 * 쓰도록 한 곳에 모았다. 두 경로가 갈라지면 C24- 접두사 유무로 동일 주문이
 * 2건씩 생기는 중복 버그가 재발하므로 반드시 이 모듈만 사용할 것.
 */

export function mapCafe24Status(status: string): string {
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
export async function transitionPendingToReady(
  store: StoreInfo,
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
export async function fetchOrdersFromStore(
  store: StoreInfo,
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

  // embed=items가 누락된 주문은 개별 조회로 items 보충 (5건 병렬)
  const missingItems = all.filter((o) => !o.items || o.items.length === 0);
  if (missingItems.length > 0) {
    console.log(`[collectOrders] ${missingItems.length}건 items 누락 → 개별 조회 시도`);
    const CONCURRENT = 5;
    for (let i = 0; i < missingItems.length; i += CONCURRENT) {
      const batch = missingItems.slice(i, i + CONCURRENT);
      await Promise.allSettled(batch.map(async (order) => {
        const res = await cafe24Fetch(store, `/orders/${order.order_id}?embed=items,receivers`);
        if (res.ok) {
          const data = await res.json();
          const detail = data.order;
          if (detail?.items?.length > 0) {
            order.items = detail.items;
            if (detail.receivers) order.receivers = detail.receivers;
          }
        }
      }));
      if (i + CONCURRENT < missingItems.length) await new Promise((r) => setTimeout(r, 200));
    }
  }

  return all;
}

/**
 * 카페24 주문 → Supabase 저장 (upsert)
 * cafe24_order_id 는 항상 `C24-` 접두사 + 원본 주문번호로 저장한다.
 */
export async function saveOrdersToDb(
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
    shipping_fee: number;
    discount_amount: number;
    coupon_discount: number;
    app_discount: number;
    additional_discount: number;
    sales_channel: string;
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
      // 품목별 주문번호(order_item_code)가 없거나 주문번호와 동일하면 skip
      // → embed=items 실패 시 order-level fallback에서 bare code가 저장되는 것을 방지
      const itemCode = item.order_item_code || "";
      const orderId = order.order_id || item.order_id || "";
      if (!itemCode || itemCode === orderId) {
        console.log(`[collectOrders] skip bare item_code: order=${orderId} item_code=${itemCode}`);
        continue;
      }
      const qty = item.quantity || 1;
      const unitPrice = parseInt(item.product_price || "0", 10);
      const itemTotal = qty * unitPrice;
      // 아이템별 할인 유형별 분리
      const couponDiscount = Math.round(parseFloat(item.coupon_discount_price || "0"));
      const appDiscount = Math.round(parseFloat(item.app_item_discount_amount || "0"));
      const additionalDiscount = Math.round(parseFloat(item.additional_discount_price || "0"));
      const itemDiscount = couponDiscount + appDiscount + additionalDiscount;
      const shippingFee = Math.round(parseFloat(item.individual_shipping_fee || "0"));
      rows.push({
        store_id: storeId,
        cafe24_order_id: `C24-${orderId}`,
        cafe24_order_item_code: itemCode,
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
        quantity: qty,
        product_price: unitPrice,
        order_amount: itemTotal - itemDiscount + shippingFee,
        shipping_fee: shippingFee,
        discount_amount: itemDiscount,
        coupon_discount: couponDiscount,
        app_discount: appDiscount,
        additional_discount: additionalDiscount,
        memo: receiver.shipping_message || order.shipping_message || order.user_message || "",
        shipping_company: item.shipping_company_name || "",
        tracking_number: item.tracking_no || "",
        shipped_at: item.tracking_no ? (item.shipped_date || new Date().toISOString()) : null,
        sales_channel: "cafe24",
        // cancel_date가 있으면 order_status와 무관하게 cancelled 강제 (C* 외 코드 커버)
        shipping_status: (item.cancel_date || order.cancel_date)
          ? "cancelled"
          : mapCafe24Status(item.order_status || order.order_status || ""),
      });
    }
  }

  // C24- 접두어 + YYYYMMDD-NNNNNNN 형식만 허용
  const validRows = rows.filter((r) => /^C24-\d{8}-\d+$/.test(r.cafe24_order_id));
  if (validRows.length < rows.length) {
    console.log(`[collectOrders] ${rows.length - validRows.length}건 비정상 주문번호 형식 제외`);
  }

  if (validRows.length === 0) return { saved: 0 };

  // 기존 row 조회 — 덮어쓰기 방지용
  // 이미 supplier/admin이 입력한 송장·배송상태는 카페24가 빈 값을 돌려줄 때 보존
  const cafeOrderIds = [...new Set(validRows.map((r) => r.cafe24_order_id))];
  // C24- 접두사 없는 버전도 함께 조회 (엑셀 수동등록·과거 bare 수집분과의 중복 방지)
  const rawOrderIds = cafeOrderIds.map((id) => id.replace(/^C24-/, ""));
  const allLookupIds = [...new Set([...cafeOrderIds, ...rawOrderIds])];
  const { data: existingRows } = await sb
    .from("orders")
    .select("id, cafe24_order_id, cafe24_order_item_code, tracking_number, shipping_company, shipped_at, shipping_status")
    .eq("store_id", storeId)
    .in("cafe24_order_id", allLookupIds);

  const existingMap = new Map<string, { id?: string; tracking_number: string | null; shipping_company: string | null; shipped_at: string | null; shipping_status: string | null }>();
  for (const e of existingRows || []) {
    existingMap.set(`${e.cafe24_order_id}::${e.cafe24_order_item_code || ""}`, {
      id: e.id as string,
      tracking_number: e.tracking_number as string | null,
      shipping_company: e.shipping_company as string | null,
      shipped_at: e.shipped_at as string | null,
      shipping_status: e.shipping_status as string | null,
    });
  }

  // 엑셀/과거 bare 수집분(C24- 없는 버전)을 C24- 버전으로 정규화 (중복 방지)
  const c24Set = new Set(cafeOrderIds);
  const nonC24Dupes = (existingRows || []).filter((e) => {
    const oid = e.cafe24_order_id as string;
    return !oid.startsWith("C24-") && c24Set.has(`C24-${oid}`);
  });
  let normalized = 0;
  for (const e of nonC24Dupes) {
    const oldOid = e.cafe24_order_id as string;
    const newOid = `C24-${oldOid}`;
    const newKey = `${newOid}::${e.cafe24_order_item_code || ""}`;
    // 같은 item_code의 C24- row가 이미 있으면 unique 제약 충돌 → 라이브 경로에서 건드리지 않고
    // 별도 정리 스크립트(remove-duplicates-c24.ts)에 맡긴다. PO/정산 참조가 걸린 행을
    // 크론에서 무단 삭제/병합하지 않기 위함.
    if (existingMap.has(newKey)) continue;
    await sb.from("orders").update({ cafe24_order_id: newOid, sales_channel: "cafe24" }).eq("id", e.id);
    const oldKey = `${oldOid}::${e.cafe24_order_item_code || ""}`;
    const val = existingMap.get(oldKey);
    if (val) {
      existingMap.delete(oldKey);
      existingMap.set(newKey, val);
    }
    normalized++;
  }
  if (normalized > 0) {
    console.log(`[collectOrders] ${normalized}건 bare 주문번호 → C24- 접두사 정규화`);
  }

  // 보호 로직:
  //  1) tracking_number: 카페24가 빈 값이면 기존 값 유지
  //  2) shipping_status: ordered/shipping/delivered → pending 다운그레이드 금지
  //     단, cancelled는 항상 override (카페24에서 취소 확정된 경우 admin에도 반영)
  //  3) 신규 insert인데 cancelled면 skip — 취소된 주문을 새로 DB에 넣지 않음
  const NON_DOWNGRADE = new Set(["ordered", "shipping", "delivered"]);
  const filteredRows: typeof validRows = [];
  for (const r of validRows) {
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
