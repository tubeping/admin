/**
 * TEL- 접두사 자사몰 주문 정리 스크립트
 *
 * 카페24 자사몰 주문인데 TEL- 접두사가 잘못 붙은 주문을 정리:
 * 1. cafe24_order_id에서 TEL- 접두사 제거
 * 2. sales_channel을 null로 변경 (자사몰)
 *
 * 대상: TEL- 접두사 + 뒤의 주문번호가 YYYYMMDD-NNNNNNN 형태 (7자리 이상 시퀀스)
 * 제외: TEL-YYYYMMDD-NNN (3자리 시퀀스) → 실제 전화주문 가능성 높음
 *
 * Usage:
 *   npx tsx scripts/fix-tel-prefix.ts          # dry-run (확인만)
 *   npx tsx scripts/fix-tel-prefix.ts --apply  # 실제 적용
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const dryRun = !process.argv.includes("--apply");

async function main() {
  console.log(`\n=== TEL- 접두사 자사몰 주문 정리 ${dryRun ? "(DRY-RUN)" : "(APPLY)"} ===\n`);

  // 1. TEL- 접두사 주문 전체 조회
  const allTelOrders: { id: string; cafe24_order_id: string; sales_channel: string | null; store_id: string | null; shipping_status: string }[] = [];
  let from = 0;
  const chunk = 1000;
  while (true) {
    const { data, error } = await sb
      .from("orders")
      .select("id, cafe24_order_id, sales_channel, store_id, shipping_status")
      .ilike("cafe24_order_id", "TEL-%")
      .range(from, from + chunk - 1);
    if (error) { console.error("조회 오류:", error.message); return; }
    if (!data || data.length === 0) break;
    allTelOrders.push(...data);
    if (data.length < chunk) break;
    from += chunk;
  }

  console.log(`TEL- 접두사 주문 총: ${allTelOrders.length}건\n`);
  if (allTelOrders.length === 0) { console.log("정리 대상 없음"); return; }

  // 2. 자사몰 주문 판별 — TEL- 뒤가 YYYYMMDD-NNNNNNN (7자리+ 시퀀스) 형태
  //    실제 전화주문: TEL-YYYYMMDD-001 (짧은 시퀀스)
  const mallOrders = allTelOrders.filter((o) => {
    const stripped = o.cafe24_order_id.replace(/^TEL-/, "");
    return /^\d{8}-\d{5,}$/.test(stripped); // YYYYMMDD + 5자리 이상 시퀀스 → 카페24 형태
  });

  const phoneOrders = allTelOrders.filter((o) => {
    const stripped = o.cafe24_order_id.replace(/^TEL-/, "");
    return !/^\d{8}-\d{5,}$/.test(stripped); // 나머지 → 실제 전화주문
  });

  console.log(`  자사몰 주문 (TEL- 제거 대상): ${mallOrders.length}건`);
  console.log(`  전화주문 (유지): ${phoneOrders.length}건\n`);

  if (mallOrders.length === 0) { console.log("정리 대상 없음"); return; }

  // 3. 중복 체크 — TEL- 제거 후 같은 order_id가 이미 존재하는지 확인
  const strippedIds = mallOrders.map((o) => o.cafe24_order_id.replace(/^TEL-/, ""));
  const existingMap = new Set<string>();

  for (let i = 0; i < strippedIds.length; i += 100) {
    const batch = strippedIds.slice(i, i + 100);
    const { data } = await sb
      .from("orders")
      .select("cafe24_order_id")
      .in("cafe24_order_id", batch);
    for (const d of data || []) existingMap.add(d.cafe24_order_id);
  }

  const toUpdate: typeof mallOrders = [];
  const duplicates: typeof mallOrders = [];

  for (const o of mallOrders) {
    const stripped = o.cafe24_order_id.replace(/^TEL-/, "");
    if (existingMap.has(stripped)) {
      duplicates.push(o); // TEL- 제거하면 기존 주문과 중복 → 삭제 대상
    } else {
      toUpdate.push(o);
    }
  }

  console.log(`  접두사 제거 대상: ${toUpdate.length}건`);
  console.log(`  중복 (기존 주문 있음, 삭제 대상): ${duplicates.length}건\n`);

  // 4. 샘플 출력
  console.log("--- 접두사 제거 샘플 (최대 10건) ---");
  for (const o of toUpdate.slice(0, 10)) {
    const stripped = o.cafe24_order_id.replace(/^TEL-/, "");
    console.log(`  ${o.cafe24_order_id} → ${stripped}  (channel: ${o.sales_channel} → null, status: ${o.shipping_status})`);
  }
  if (duplicates.length > 0) {
    console.log("\n--- 중복 삭제 샘플 (최대 10건) ---");
    for (const o of duplicates.slice(0, 10)) {
      console.log(`  ${o.cafe24_order_id} (삭제 예정, 기존 주문 유지)`);
    }
  }

  if (dryRun) {
    console.log(`\n[DRY-RUN] 실제 적용하려면: npx tsx scripts/fix-tel-prefix.ts --apply\n`);
    return;
  }

  // 5. 적용: 접두사 제거 + sales_channel 수정
  console.log("\n--- 적용 중 ---");
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += 50) {
    const batch = toUpdate.slice(i, i + 50);
    for (const o of batch) {
      const stripped = o.cafe24_order_id.replace(/^TEL-/, "");
      const { error } = await sb
        .from("orders")
        .update({ cafe24_order_id: stripped, cafe24_order_item_code: stripped, sales_channel: null })
        .eq("id", o.id);
      if (error) {
        console.error(`  오류 [${o.cafe24_order_id}]: ${error.message}`);
      } else {
        updated++;
      }
    }
    console.log(`  진행: ${Math.min(i + 50, toUpdate.length)}/${toUpdate.length}`);
  }
  console.log(`\n접두사 제거 완료: ${updated}건`);

  // 6. 중복 삭제
  if (duplicates.length > 0) {
    console.log("\n--- 중복 주문 삭제 ---");
    let deleted = 0;
    for (let i = 0; i < duplicates.length; i += 50) {
      const ids = duplicates.slice(i, i + 50).map((o) => o.id);
      // FK 정리: settlement_items
      await sb.from("settlement_items").delete().in("order_id", ids);
      const { error } = await sb.from("orders").delete().in("id", ids);
      if (error) {
        console.error(`  삭제 오류: ${error.message}`);
      } else {
        deleted += ids.length;
      }
    }
    console.log(`중복 삭제 완료: ${deleted}건`);
  }

  console.log("\n=== 완료 ===\n");
}

main().catch(console.error);
