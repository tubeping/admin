/**
 * TEL-/JP- 끼리 중복된 주문 정리
 * 동일 수취인+상품+날짜인데 주문번호만 다른 경우
 * → 배송 상태가 더 진행된 건 유지, 나머지 삭제
 *
 * Usage:
 *   npx tsx scripts/remove-duplicates-tel.ts          # dry-run
 *   npx tsx scripts/remove-duplicates-tel.ts --apply  # 실제 적용
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const dryRun = !process.argv.includes("--apply");

const STATUS_RANK: Record<string, number> = {
  draft: 0, pending: 1, ordered: 2, shipping: 3, delivered: 4, cancelled: -1,
};

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLY MODE ===");

  const CHUNK = 1000;
  let offset = 0;
  const allOrders: any[] = [];

  while (true) {
    const { data, error } = await sb
      .from("orders")
      .select("id, cafe24_order_id, order_date, receiver_name, receiver_phone, product_name, quantity, buyer_name, buyer_phone, shipping_status, tracking_number, shipping_company, shipped_at")
      .neq("shipping_status", "cancelled")
      .order("order_date", { ascending: false })
      .range(offset, offset + CHUNK - 1);
    if (error) { console.error(error.message); break; }
    if (!data || data.length === 0) break;
    allOrders.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
  }

  // 중복 그룹
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

  const duplicates = [...groups.entries()].filter(([, v]) => v.length >= 2);
  console.log(`중복 그룹: ${duplicates.length}건\n`);

  const toDelete: string[] = [];

  for (const [key, orders] of duplicates) {
    // 배송 상태 기준 정렬: 더 진행된 건 유지
    orders.sort((a: any, b: any) => {
      const rankDiff = (STATUS_RANK[b.shipping_status] ?? 0) - (STATUS_RANK[a.shipping_status] ?? 0);
      if (rankDiff !== 0) return rankDiff;
      // 같은 상태면 tracking_number 있는 건 우선
      if (b.tracking_number && !a.tracking_number) return 1;
      if (a.tracking_number && !b.tracking_number) return -1;
      return 0;
    });

    const keep = orders[0];
    for (let i = 1; i < orders.length; i++) {
      toDelete.push(orders[i].id);
      if (!dryRun) {
        // 삭제 대상에 tracking이 있고 keep에 없으면 병합
        if (orders[i].tracking_number && !keep.tracking_number) {
          await sb.from("orders").update({
            tracking_number: orders[i].tracking_number,
            shipping_company: orders[i].shipping_company,
            shipped_at: orders[i].shipped_at,
          }).eq("id", keep.id);
        }
      }
    }
  }

  console.log(`삭제 대상: ${toDelete.length}건`);

  if (dryRun) {
    for (const id of toDelete.slice(0, 20)) {
      const o = allOrders.find((x: any) => x.id === id);
      if (o) console.log(`  삭제: ${o.cafe24_order_id} (${o.shipping_status})`);
    }
    console.log("\n실제 적용: npx tsx scripts/remove-duplicates-tel.ts --apply");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 50) {
    const batch = toDelete.slice(i, i + 50);
    const { error } = await sb.from("orders").delete().in("id", batch);
    if (error) console.error(`  배치 삭제 실패: ${error.message}`);
    else deleted += batch.length;
  }
  console.log(`\n완료: ${deleted}건 삭제`);
}

main().catch(console.error);
