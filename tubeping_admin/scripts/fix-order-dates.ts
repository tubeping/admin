/**
 * 주문번호(cafe24_order_id)에 포함된 YYYYMMDD 날짜와 order_date가 불일치하는
 * 기존 주문 데이터를 일괄 보정하는 스크립트
 *
 * 대상: 엑셀 임포트, 전화주문(PT-/TEL-), 문자주문(PS-) 등
 *       주문번호에 날짜가 포함되어 있으나 order_date가 임포트 시점으로 잘못 설정된 건
 *
 * Usage:
 *   npx tsx scripts/fix-order-dates.ts          # dry-run (변경 없이 대상만 확인)
 *   npx tsx scripts/fix-order-dates.ts --apply  # 실제 보정 적용
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("환경변수 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const dryRun = !process.argv.includes("--apply");

function parseDateFromOrderId(orderId: string): string | null {
  const m = orderId.match(/(\d{8})/);
  if (!m) return null;
  const ds = m[1];
  const y = parseInt(ds.slice(0, 4), 10);
  const mo = parseInt(ds.slice(4, 6), 10);
  const d = parseInt(ds.slice(6, 8), 10);
  if (y < 2020 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(`${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}T09:00:00+09:00`).toISOString();
}

async function main() {
  console.log(dryRun ? "=== DRY RUN (변경 없음) ===" : "=== APPLY MODE (실제 보정) ===");
  console.log("");

  // 카페24 직수집 주문(순수 숫자 주문번호 YYYYMMDD-NNN)은 제외
  // 대상: 엑셀 임포트, 전화(PT-/TEL-), 문자(PS-), 기타(ETC-/EXCEL-/GRP-/SMP-) 등
  const CHUNK = 1000;
  let offset = 0;
  let totalChecked = 0;
  let mismatchCount = 0;
  let fixedCount = 0;
  const mismatches: Array<{ id: string; cafe24_order_id: string; old_date: string; new_date: string }> = [];

  while (true) {
    const { data: orders, error } = await sb
      .from("orders")
      .select("id, cafe24_order_id, order_date")
      .order("order_date", { ascending: false })
      .range(offset, offset + CHUNK - 1);

    if (error) {
      console.error("조회 에러:", error.message);
      break;
    }
    if (!orders || orders.length === 0) break;

    for (const o of orders) {
      totalChecked++;
      const parsed = parseDateFromOrderId(o.cafe24_order_id);
      if (!parsed) continue;

      // 주문번호 날짜와 order_date 날짜(KST 기준) 비교
      const parsedDate = parsed.slice(0, 10); // YYYY-MM-DD
      const currentDate = new Date(o.order_date);
      const kstDate = new Date(currentDate.getTime() + 9 * 3600000).toISOString().slice(0, 10);

      if (parsedDate !== kstDate) {
        mismatchCount++;
        mismatches.push({
          id: o.id,
          cafe24_order_id: o.cafe24_order_id,
          old_date: kstDate,
          new_date: parsedDate,
        });
      }
    }

    offset += CHUNK;
    if (orders.length < CHUNK) break;
  }

  console.log(`총 조회: ${totalChecked}건`);
  console.log(`불일치 발견: ${mismatchCount}건`);
  console.log("");

  if (mismatches.length === 0) {
    console.log("보정할 데이터가 없습니다.");
    return;
  }

  // 불일치 목록 출력 (최대 30건)
  console.log("--- 불일치 목록 (최대 30건) ---");
  for (const m of mismatches.slice(0, 30)) {
    console.log(`  ${m.cafe24_order_id}  order_date: ${m.old_date} → ${m.new_date}`);
  }
  if (mismatches.length > 30) {
    console.log(`  ... 외 ${mismatches.length - 30}건`);
  }
  console.log("");

  if (dryRun) {
    console.log("실제 보정을 적용하려면: npx tsx scripts/fix-order-dates.ts --apply");
    return;
  }

  // 실제 보정
  console.log("보정 시작...");
  for (const m of mismatches) {
    const correctDate = new Date(
      `${m.new_date}T09:00:00+09:00`
    ).toISOString();

    const { error } = await sb
      .from("orders")
      .update({ order_date: correctDate })
      .eq("id", m.id);

    if (error) {
      console.error(`  실패: ${m.cafe24_order_id} - ${error.message}`);
    } else {
      fixedCount++;
    }
  }

  console.log("");
  console.log(`보정 완료: ${fixedCount}/${mismatchCount}건`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
