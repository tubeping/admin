/**
 * C24-/bare 카페24 주문 중복 정리 스크립트
 *
 * 배경: 과거 cron/collect-orders가 접두사 없는 bare 주문번호(YYYYMMDD-NNNNNNN)로
 *       저장해, 수동 수집분(C24-YYYYMMDD-NNNNNNN)과 동일 주문이 2건씩 생겼다.
 *       (store_id, 정규화 주문번호, item_code)가 같은데 C24- 유무만 다른 쌍을 찾는다.
 *
 * 처리: 운영정보(배송상태/송장/발주/결제)가 더 진행된 행을 KEEP, 나머지를 DELETE.
 *       - KEEP에 빈 필드는 DELETE 쪽 값으로 보강(송장/발주/결제/공급사)
 *       - settlement_items.order_id 가 DELETE 를 가리키면 KEEP 으로 재지정
 *       - KEEP 이 bare 면 C24- 접두사로 정규화
 *       - DELETE 행 삭제
 *
 * Usage:
 *   node --env-file=.env.local scripts/remove-duplicates-c24.mjs           # dry-run
 *   node --env-file=.env.local scripts/remove-duplicates-c24.mjs --apply   # 실제 적용
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const dryRun = !process.argv.includes("--apply");

const STATUS_RANK = { draft: 0, pending: 1, ordered: 2, shipping: 3, delivered: 4, cancelled: -1 };
const strip = (id) => (id || "").replace(/^C24-/, "");
const isCafePattern = (id) => /^\d{8}-\d+$/.test(id);

async function fetchAll() {
  const CHUNK = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const { data, error } = await sb
      .from("orders")
      .select("id, store_id, cafe24_order_id, cafe24_order_item_code, shipping_status, tracking_number, shipping_company, shipped_at, purchase_order_id, payment_amount, supplier_id, cafe24_shipping_synced, order_date, receiver_name, product_name")
      .order("order_date", { ascending: true })
      .range(offset, offset + CHUNK - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
  }
  return all;
}

function pickKeep(rows) {
  // 가장 진행된 상태 → 송장 보유 → 발주 보유 → C24- 형식 순으로 KEEP 선정
  return [...rows].sort((a, b) => {
    const r = (STATUS_RANK[b.shipping_status] ?? 0) - (STATUS_RANK[a.shipping_status] ?? 0);
    if (r !== 0) return r;
    const t = (b.tracking_number ? 1 : 0) - (a.tracking_number ? 1 : 0);
    if (t !== 0) return t;
    const p = (b.purchase_order_id ? 1 : 0) - (a.purchase_order_id ? 1 : 0);
    if (p !== 0) return p;
    const c = ((b.cafe24_order_id || "").startsWith("C24-") ? 1 : 0) - ((a.cafe24_order_id || "").startsWith("C24-") ? 1 : 0);
    return c;
  })[0];
}

async function main() {
  console.log(dryRun ? "=== DRY RUN (변경 없음) ===\n" : "=== APPLY MODE (실제 적용) ===\n");
  const all = await fetchAll();
  console.log(`총 주문: ${all.length}건`);

  // (store_id, 정규화 주문번호, item_code) 기준 그룹
  const groups = new Map();
  for (const o of all) {
    const base = strip(o.cafe24_order_id);
    if (!isCafePattern(base)) continue;
    const key = `${o.store_id}|${base}|${o.cafe24_order_item_code || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  // C24- 와 bare 가 함께 있는 그룹만 (실제 중복)
  const dupGroups = [...groups.entries()].filter(([, rows]) => {
    const hasC24 = rows.some((r) => (r.cafe24_order_id || "").startsWith("C24-"));
    const hasBare = rows.some((r) => !(r.cafe24_order_id || "").startsWith("C24-"));
    return hasC24 && hasBare;
  });

  console.log(`중복 그룹 (C24-/bare 공존): ${dupGroups.length}건\n`);
  if (dupGroups.length === 0) return;

  let willDelete = 0, willRename = 0, willRepoint = 0, manualReview = 0;
  const deleteIds = [];

  for (const [, rows] of dupGroups) {
    const keep = pickKeep(rows);
    const dels = rows.filter((r) => r.id !== keep.id);
    const base = strip(keep.cafe24_order_id);

    // KEEP 보강 필드 계산
    const updates = {};
    for (const del of dels) {
      if (!keep.tracking_number && del.tracking_number) {
        updates.tracking_number = del.tracking_number;
        if (del.shipping_company) updates.shipping_company = del.shipping_company;
        if (del.shipped_at) updates.shipped_at = del.shipped_at;
      }
      if ((STATUS_RANK[del.shipping_status] ?? 0) > (STATUS_RANK[keep.shipping_status] ?? 0)) {
        updates.shipping_status = del.shipping_status;
      }
      if (!keep.purchase_order_id && del.purchase_order_id) updates.purchase_order_id = del.purchase_order_id;
      if (!keep.payment_amount && del.payment_amount) updates.payment_amount = del.payment_amount;
      if (!keep.supplier_id && del.supplier_id) updates.supplier_id = del.supplier_id;
      if (del.cafe24_shipping_synced && !keep.cafe24_shipping_synced) updates.cafe24_shipping_synced = true;
    }
    // KEEP 이 bare 면 C24- 로 정규화
    const needRename = !(keep.cafe24_order_id || "").startsWith("C24-");

    // settlement_items 참조 확인
    const delIds = dels.map((d) => d.id);
    const { data: siRefs } = await sb.from("settlement_items").select("id, order_id").in("order_id", delIds);
    const refCount = (siRefs || []).length;

    // 서로 다른 purchase_order_id 를 가진 경우(둘 다 발주됨) → 수동 검토 권고
    const distinctPOs = new Set(rows.map((r) => r.purchase_order_id).filter(Boolean));
    const poConflict = distinctPOs.size > 1;

    console.log(`[${base}] item=${rows[0].cafe24_order_item_code} (${rows[0].receiver_name})`);
    for (const r of rows) {
      const tag = r.id === keep.id ? "KEEP " : "DEL  ";
      console.log(`  ${tag}${r.cafe24_order_id}  status=${r.shipping_status}  trk=${r.tracking_number || "-"}  po=${r.purchase_order_id ? r.purchase_order_id.slice(0, 8) : "-"}  pay=${r.payment_amount || "-"}  id=${r.id}`);
    }
    if (Object.keys(updates).length) console.log(`  → KEEP 보강: ${JSON.stringify(updates)}`);
    if (needRename) { console.log(`  → KEEP 주문번호 정규화: ${keep.cafe24_order_id} → C24-${base}`); willRename++; }
    if (refCount) { console.log(`  → settlement_items ${refCount}건 KEEP 으로 재지정`); willRepoint += refCount; }
    if (poConflict) { console.log(`  ⚠️  서로 다른 발주서에 묶임(distinct PO=${distinctPOs.size}) — 정산/발주 영향 검토 권장`); manualReview++; }
    console.log("");

    willDelete += dels.length;
    deleteIds.push(...delIds);

    if (!dryRun) {
      // 1) KEEP 보강
      if (Object.keys(updates).length) {
        const { error } = await sb.from("orders").update(updates).eq("id", keep.id);
        if (error) { console.error(`  보강 실패: ${error.message}`); continue; }
      }
      // 2) settlement_items 재지정
      if (refCount) {
        const { error } = await sb.from("settlement_items").update({ order_id: keep.id }).in("order_id", delIds);
        if (error) { console.error(`  settlement_items 재지정 실패: ${error.message}`); continue; }
      }
      // 3) DELETE 행 삭제
      {
        const { error } = await sb.from("orders").delete().in("id", delIds);
        if (error) { console.error(`  삭제 실패: ${error.message}`); continue; }
      }
      // 4) KEEP 정규화 (삭제 후 C24- 키가 비었으므로 안전)
      if (needRename) {
        const { error } = await sb.from("orders").update({ cafe24_order_id: `C24-${base}`, sales_channel: "cafe24" }).eq("id", keep.id);
        if (error) console.error(`  정규화 실패: ${error.message}`);
      }
    }
  }

  console.log("──────────────────────────────────");
  console.log(`삭제 대상: ${willDelete}건 / 정규화: ${willRename}건 / settlement 재지정: ${willRepoint}건 / 수동검토 권고: ${manualReview}건`);
  if (dryRun) console.log(`\n실제 적용: node --env-file=.env.local scripts/remove-duplicates-c24.mjs --apply`);
  else console.log(`\n완료.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
