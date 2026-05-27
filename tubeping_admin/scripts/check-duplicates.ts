/**
 * 주문번호만 다른 동일 주문건 (중복) 탐지 스크립트
 * 수취인명+연락처+상품명+수량 기준으로 같은 날짜의 중복 주문을 찾음
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // 전체 주문 조회
  const CHUNK = 1000;
  let offset = 0;
  const allOrders: any[] = [];

  while (true) {
    const { data, error } = await sb
      .from("orders")
      .select("id, cafe24_order_id, order_date, receiver_name, receiver_phone, product_name, quantity, buyer_name, buyer_phone, shipping_status")
      .neq("shipping_status", "cancelled")
      .order("order_date", { ascending: false })
      .range(offset, offset + CHUNK - 1);

    if (error) { console.error(error.message); break; }
    if (!data || data.length === 0) break;
    allOrders.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
  }

  console.log(`총 주문: ${allOrders.length}건\n`);

  // 중복 탐지: 같은 날짜 + 수취인명 + 수취인연락처 + 상품명 + 수량
  const groups = new Map<string, any[]>();
  for (const o of allOrders) {
    const dateKey = new Date(o.order_date).toISOString().slice(0, 10);
    const name = (o.receiver_name || o.buyer_name || "").trim();
    const phone = (o.receiver_phone || o.buyer_phone || "").replace(/[^0-9]/g, "");
    const product = (o.product_name || "").trim();
    const key = `${dateKey}|${name}|${phone}|${product}|${o.quantity}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  // 2건 이상인 그룹 = 중복
  const duplicates = [...groups.entries()].filter(([, v]) => v.length >= 2);
  console.log(`중복 그룹: ${duplicates.length}건\n`);

  // TEL-/PT-/PS- 접두사 vs 일반 주문번호 패턴 분류
  let telDupCount = 0;
  const dupDetails: Array<{
    key: string;
    orders: Array<{ id: string; cafe24_order_id: string; shipping_status: string }>;
    recommendation: string;
  }> = [];

  for (const [key, orders] of duplicates) {
    const hasTel = orders.some((o: any) => /^(TEL-|PT-|PS-)/.test(o.cafe24_order_id));
    const hasNonTel = orders.some((o: any) => !/^(TEL-|PT-|PS-|ETC-|EXCEL-|GRP-|SMP-)/.test(o.cafe24_order_id));

    if (hasTel && hasNonTel) {
      telDupCount++;
    }

    dupDetails.push({
      key,
      orders: orders.map((o: any) => ({
        id: o.id,
        cafe24_order_id: o.cafe24_order_id,
        shipping_status: o.shipping_status,
      })),
      recommendation: hasTel && hasNonTel
        ? "TEL/PT/PS 주문번호 건 삭제 가능 (일반 주문번호 건 유지)"
        : "수동 확인 필요",
    });
  }

  console.log(`TEL/일반 중복: ${telDupCount}건`);
  console.log(`기타 중복: ${duplicates.length - telDupCount}건\n`);

  // 상세 출력 (최대 50건)
  console.log("--- 중복 상세 (최대 50건) ---");
  for (const d of dupDetails.slice(0, 50)) {
    console.log(`\n[${d.key}]`);
    for (const o of d.orders) {
      console.log(`  ${o.cafe24_order_id} (${o.shipping_status}) id=${o.id}`);
    }
    console.log(`  → ${d.recommendation}`);
  }
  if (dupDetails.length > 50) {
    console.log(`\n... 외 ${dupDetails.length - 50}건`);
  }
}

main().catch(console.error);
