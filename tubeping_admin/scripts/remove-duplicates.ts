/**
 * 주문번호만 다른 동일 주문 중복 제거 스크립트
 *
 * 규칙:
 * - TEL-/PT-/PS- 접두사 건 vs 일반 주문번호 건이 중복이면:
 *   → 일반 건 유지, TEL-/PT-/PS- 건 삭제
 *   → 단, TEL- 건의 배송상태가 더 진행되었으면 그 정보를 일반 건에 반영 후 삭제
 *
 * Usage:
 *   npx tsx scripts/remove-duplicates.ts          # dry-run
 *   npx tsx scripts/remove-duplicates.ts --apply  # 실제 적용
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const dryRun = !process.argv.includes("--apply");

const STATUS_RANK: Record<string, number> = {
  draft: 0,
  pending: 1,
  ordered: 2,
  shipping: 3,
  delivered: 4,
  cancelled: -1,
};

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLY MODE ===");

  // 전체 주문 조회 (tracking, shipped_at 포함)
  const CHUNK = 1000;
  let offset = 0;
  const allOrders: any[] = [];

  while (true) {
    const { data, error } = await sb
      .from("orders")
      .select("id, cafe24_order_id, order_date, receiver_name, receiver_phone, product_name, quantity, buyer_name, buyer_phone, shipping_status, tracking_number, shipping_company, shipped_at, purchase_order_id")
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

  // 중복 그룹 생성
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

  let deleteCount = 0;
  let mergeCount = 0;
  const toDelete: string[] = [];
  const toMerge: Array<{ keepId: string; deleteId: string; updates: Record<string, any> }> = [];

  for (const [key, orders] of duplicates) {
    const prefixed = orders.filter((o: any) => /^(TEL-|PT-|PS-)/.test(o.cafe24_order_id));
    const regular = orders.filter((o: any) => !/^(TEL-|PT-|PS-)/.test(o.cafe24_order_id));

    if (prefixed.length === 0 || regular.length === 0) continue; // 수동 확인 필요 건은 스킵

    // 일반 건 중 가장 진행된 것을 keep 대상으로
    const keep = regular.sort((a: any, b: any) =>
      (STATUS_RANK[b.shipping_status] || 0) - (STATUS_RANK[a.shipping_status] || 0)
    )[0];

    for (const del of prefixed) {
      const keepRank = STATUS_RANK[keep.shipping_status] ?? 0;
      const delRank = STATUS_RANK[del.shipping_status] ?? 0;

      // TEL- 건이 더 진행되었으면 상태/송장 정보 반영
      const updates: Record<string, any> = {};
      if (delRank > keepRank) {
        updates.shipping_status = del.shipping_status;
        if (del.tracking_number && !keep.tracking_number) {
          updates.tracking_number = del.tracking_number;
          updates.shipping_company = del.shipping_company;
          updates.shipped_at = del.shipped_at;
        }
      }
      // 송장 정보만 TEL-에 있는 경우
      if (!keep.tracking_number && del.tracking_number) {
        updates.tracking_number = del.tracking_number;
        updates.shipping_company = del.shipping_company;
        updates.shipped_at = del.shipped_at;
      }

      if (Object.keys(updates).length > 0) {
        toMerge.push({ keepId: keep.id, deleteId: del.id, updates });
        mergeCount++;
      }
      toDelete.push(del.id);
      deleteCount++;
    }
  }

  console.log(`삭제 대상 (TEL-/PT-/PS- 중복): ${deleteCount}건`);
  console.log(`병합 필요 (배송상태/송장 반영): ${mergeCount}건\n`);

  if (deleteCount === 0) {
    console.log("처리할 중복이 없습니다.");
    return;
  }

  if (dryRun) {
    // 일부 예시 출력
    console.log("--- 삭제 예정 (최대 20건) ---");
    for (const id of toDelete.slice(0, 20)) {
      const o = allOrders.find((x: any) => x.id === id);
      if (o) console.log(`  삭제: ${o.cafe24_order_id} (${o.shipping_status})`);
    }
    if (toMerge.length > 0) {
      console.log("\n--- 병합 예정 ---");
      for (const m of toMerge.slice(0, 10)) {
        const keep = allOrders.find((x: any) => x.id === m.keepId);
        console.log(`  ${keep?.cafe24_order_id} ← 상태 반영: ${JSON.stringify(m.updates)}`);
      }
    }
    console.log("\n실제 적용: npx tsx scripts/remove-duplicates.ts --apply");
    return;
  }

  // 실제 적용: 병합 먼저, 삭제 후
  console.log("병합 중...");
  for (const m of toMerge) {
    const { error } = await sb.from("orders").update(m.updates).eq("id", m.keepId);
    if (error) console.error(`  병합 실패 (${m.keepId}): ${error.message}`);
  }

  console.log("삭제 중...");
  // 50개씩 배치 삭제
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 50) {
    const batch = toDelete.slice(i, i + 50);
    const { error } = await sb.from("orders").delete().in("id", batch);
    if (error) {
      console.error(`  배치 삭제 실패: ${error.message}`);
    } else {
      deleted += batch.length;
    }
  }

  console.log(`\n완료: ${deleted}건 삭제, ${mergeCount}건 상태 병합`);
}

main().catch(console.error);
