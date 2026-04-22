/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 전체 admin 광범위 진단
 * - orders / suppliers / products / mappings / stores / purchase_orders / settlements / cs
 * - 각 도메인별 데이터 품질, 고아 레코드, 스테일 상태, 설정 불일치 등
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "..", ".env.local");
const env = fs.readFileSync(envPath, "utf-8");
const envVars: Record<string, string> = {};
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) envVars[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const url = envVars.NEXT_PUBLIC_SUPABASE_URL || envVars.SUPABASE_URL;
const key = envVars.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("Missing env"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const H = (t: string) => console.log(`\n━━━ ${t} ━━━`);
const warn = (m: string) => console.log(`⚠️  ${m}`);
const ok = (m: string) => console.log(`✓  ${m}`);
const issue = (m: string) => console.log(`🔴 ${m}`);

async function main() {
  // ============= STORES =============
  H("STORES (판매자)");
  const { data: stores } = await sb.from("stores").select("*");
  const st = (stores || []) as any[];
  console.log(`총 ${st.length}개`);
  const activeStores = st.filter((s) => s.status === "active");
  const expiredTokens = st.filter((s) => s.access_token && s.token_expires_at && new Date(s.token_expires_at) < new Date());
  const noToken = st.filter((s) => !s.access_token);
  console.log(`  active: ${activeStores.length}, 카페24 토큰 있음: ${st.length - noToken.length}`);
  if (expiredTokens.length > 0) issue(`카페24 토큰 만료: ${expiredTokens.length}개 (${expiredTokens.map((s) => s.name).join(", ")})`);
  if (noToken.length > 0) console.log(`  토큰 없음 (수동/엑셀등록): ${noToken.map((s) => s.name).join(", ")}`);

  const nameCountStores: Record<string, number> = {};
  for (const s of st) nameCountStores[s.name] = (nameCountStores[s.name] || 0) + 1;
  const dupStores = Object.entries(nameCountStores).filter(([, c]) => c > 1);
  if (dupStores.length > 0) issue(`스토어명 중복: ${dupStores.map(([n, c]) => `${n}(${c})`).join(", ")}`);

  // ============= SUPPLIERS =============
  H("SUPPLIERS (공급사)");
  const { data: suppliers } = await sb.from("suppliers").select("id, name, short_code, status, order_email, settlement_email");
  const sup = (suppliers || []) as any[];
  console.log(`총 ${sup.length}개, active: ${sup.filter((s) => s.status === "active").length}`);
  const noCode = sup.filter((s) => !s.short_code);
  if (noCode.length > 0) issue(`short_code 없는 공급사: ${noCode.length}개 (${noCode.map((s) => s.name).join(", ")})`);

  const codeCount: Record<string, string[]> = {};
  for (const s of sup) {
    if (s.short_code) {
      if (!codeCount[s.short_code]) codeCount[s.short_code] = [];
      codeCount[s.short_code].push(s.name);
    }
  }
  const dupCodes = Object.entries(codeCount).filter(([, arr]) => arr.length > 1);
  if (dupCodes.length > 0) issue(`short_code 중복: ${dupCodes.map(([c, ns]) => `${c}=[${ns.join(",")}]`).join("; ")}`);

  const nameCountSup: Record<string, number> = {};
  for (const s of sup) {
    const cleaned = (s.name || "").replace(/\s+/g, " ").trim();
    nameCountSup[cleaned] = (nameCountSup[cleaned] || 0) + 1;
  }
  const dupSupNames = Object.entries(nameCountSup).filter(([, c]) => c > 1);
  if (dupSupNames.length > 0) issue(`공급사명 중복(공백 무시): ${dupSupNames.map(([n, c]) => `${n}(${c})`).join(", ")}`);

  const tabInName = sup.filter((s) => (s.name || "").includes("\t"));
  if (tabInName.length > 0) warn(`공급사명에 탭문자 포함: ${tabInName.length}개 (${tabInName.map((s) => s.name.replace(/\t/g, "\\t")).join(", ")})`);

  const noEmail = sup.filter((s) => s.status === "active" && !s.order_email);
  if (noEmail.length > 0) warn(`active인데 order_email 없음: ${noEmail.length}개`);

  // ============= PRODUCTS =============
  H("PRODUCTS (상품)");
  const { data: products } = await sb.from("products").select("id, product_name, tp_code, supplier, mapping_verified, name_aliases, selling, display, approval_status");
  const prod = (products || []) as any[];
  console.log(`총 ${prod.length}개`);
  const tpRe = /^([A-Z]{2})([A-Z0-9]{2})\d+$/;
  const validTp = prod.filter((p) => p.tp_code && tpRe.test(p.tp_code));
  const invalidTp = prod.filter((p) => p.tp_code && !tpRe.test(p.tp_code));
  const nullTp = prod.filter((p) => !p.tp_code);
  console.log(`  tp_code 정상: ${validTp.length}, 비정상: ${invalidTp.length}, 없음: ${nullTp.length}`);
  if (invalidTp.length > 0) {
    issue(`tp_code 비정상 포맷 ${invalidTp.length}개 — 정기 마이그레이션 필요`);
    console.log(`    샘플: ${invalidTp.slice(0, 5).map((p) => p.tp_code).join(", ")}`);
  }
  const dupProdNames: Record<string, number> = {};
  for (const p of prod) dupProdNames[(p.product_name || "").trim()] = (dupProdNames[(p.product_name || "").trim()] || 0) + 1;
  const dupPN = Object.entries(dupProdNames).filter(([, c]) => c > 1);
  if (dupPN.length > 0) issue(`중복 상품명: ${dupPN.length}개 (매칭 모호함, 샘플: ${dupPN.slice(0, 3).map(([n, c]) => `${n.slice(0, 30)}(${c})`).join(", ")})`);

  const textVsCode: any[] = [];
  const supByCode: Record<string, any> = {};
  for (const s of sup) if (s.short_code) supByCode[s.short_code.toUpperCase()] = s;
  for (const p of validTp) {
    const code = p.tp_code.substring(2, 4).toUpperCase();
    const tpSup = supByCode[code];
    if (tpSup && p.supplier && tpSup.name !== p.supplier) {
      textVsCode.push({ tp_code: p.tp_code, name: p.product_name?.slice(0, 30), text: p.supplier, code: tpSup.name });
    }
  }
  if (textVsCode.length > 0) warn(`products.supplier(text) vs tp_code 불일치: ${textVsCode.length}개 (text 필드 deprecate 권장)`);

  const notSellingButUsed = prod.filter((p) => !p.selling);
  console.log(`  판매 off: ${notSellingButUsed.length}개`);

  // ============= PRODUCT-CAFE24 MAPPINGS =============
  H("PRODUCT-CAFE24 MAPPINGS");
  const { data: mappings } = await sb.from("product_cafe24_mappings").select("id, product_id, store_id, cafe24_product_no, cafe24_product_code, sync_status");
  const mp = (mappings || []) as any[];
  console.log(`총 ${mp.length}개`);
  const productIdsSet = new Set(prod.map((p) => p.id));
  const orphanedMp = mp.filter((m) => !productIdsSet.has(m.product_id));
  if (orphanedMp.length > 0) issue(`고아 매핑 (products에 없는 product_id 참조): ${orphanedMp.length}개`);
  const storeIdsSet = new Set(st.map((s) => s.id));
  const orphanedMpStore = mp.filter((m) => !storeIdsSet.has(m.store_id));
  if (orphanedMpStore.length > 0) issue(`고아 매핑 (stores에 없는 store_id 참조): ${orphanedMpStore.length}개`);

  const failedSync = mp.filter((m) => m.sync_status === "failed");
  if (failedSync.length > 0) warn(`sync_status=failed 매핑: ${failedSync.length}개`);

  // ============= ORDERS =============
  H("ORDERS (주문)");
  const { data: orders } = await sb.from("orders").select("id, store_id, supplier_id, product_name, shipping_status, tracking_number, purchase_order_id, is_sample, cafe24_product_no, cafe24_shipping_synced, order_date");
  const ord = (orders || []) as any[];
  const active = ord.filter((o) => o.shipping_status !== "cancelled");
  console.log(`총 ${ord.length}, 활성 ${active.length}, 취소 ${ord.length - active.length}`);
  const unassigned = active.filter((o) => !o.supplier_id);
  const samples = active.filter((o) => o.is_sample);
  const noTracking = active.filter((o) => !o.tracking_number && !["delivered", "cancelled"].includes(o.shipping_status));
  const noPO = active.filter((o) => !o.purchase_order_id && !["delivered", "cancelled"].includes(o.shipping_status));
  const unsynced = active.filter((o) => o.tracking_number && !o.cafe24_shipping_synced);
  console.log(`  공급사 미배정: ${unassigned.length}`);
  console.log(`  샘플: ${samples.length}`);
  console.log(`  송장 미입력: ${noTracking.length}`);
  console.log(`  미발주: ${noPO.length}`);
  console.log(`  카페24 미연동 송장: ${unsynced.length}`);

  const orderStoreIds = new Set(ord.map((o) => o.store_id).filter(Boolean));
  const orphanedStores = [...orderStoreIds].filter((id) => !storeIdsSet.has(id));
  if (orphanedStores.length > 0) issue(`주문의 store_id가 stores에 없음: ${orphanedStores.length}개`);
  const orderSupplierIds = new Set(ord.map((o) => o.supplier_id).filter(Boolean));
  const supplierIdsSet = new Set(sup.map((s) => s.id));
  const orphanedSuppliers = [...orderSupplierIds].filter((id) => !supplierIdsSet.has(id));
  if (orphanedSuppliers.length > 0) issue(`주문의 supplier_id가 suppliers에 없음: ${orphanedSuppliers.length}개`);

  // ============= PURCHASE ORDERS =============
  H("PURCHASE ORDERS (발주서)");
  const { data: pos } = await sb.from("purchase_orders").select("id, po_number, supplier_id, status, created_at, sent_at");
  const poList = (pos || []) as any[];
  console.log(`총 ${poList.length}개`);
  const poByStatus: Record<string, number> = {};
  for (const p of poList) poByStatus[p.status || "null"] = (poByStatus[p.status || "null"] || 0) + 1;
  console.log(`  상태별:`, poByStatus);
  const orphanedPoSup = poList.filter((p) => p.supplier_id && !supplierIdsSet.has(p.supplier_id));
  if (orphanedPoSup.length > 0) issue(`발주서 supplier_id 고아: ${orphanedPoSup.length}개`);

  // orders에 붙어있는 po_id 중 실제 없는 것 (이전 DELETE로 stale)
  const poIdsSet = new Set(poList.map((p) => p.id));
  const ordersWithStalePO = ord.filter((o) => o.purchase_order_id && !poIdsSet.has(o.purchase_order_id));
  if (ordersWithStalePO.length > 0) issue(`주문의 purchase_order_id가 실제 없음(삭제됨): ${ordersWithStalePO.length}개`);

  // ============= SETTLEMENTS =============
  H("SETTLEMENTS (정산)");
  try {
    const { data: settlements } = await sb.from("settlements").select("id, supplier_id, period_start, period_end, total_amount, status");
    const set = (settlements || []) as any[];
    console.log(`총 ${set.length}개`);
    const orphanedSetSup = set.filter((s) => s.supplier_id && !supplierIdsSet.has(s.supplier_id));
    if (orphanedSetSup.length > 0) issue(`정산의 supplier_id 고아: ${orphanedSetSup.length}개`);
    const { data: setItems } = await sb.from("settlement_items").select("id, settlement_id, order_id");
    const si = (setItems || []) as any[];
    console.log(`settlement_items 총 ${si.length}개`);
    const ordIds = new Set(ord.map((o) => o.id));
    const orphanedSI = si.filter((x) => !ordIds.has(x.order_id));
    if (orphanedSI.length > 0) issue(`settlement_items의 order_id 고아: ${orphanedSI.length}개`);
  } catch (e) {
    warn(`settlements 조회 실패: ${e instanceof Error ? e.message : "unknown"}`);
  }

  // ============= CS =============
  H("CS");
  try {
    const { data: cs } = await sb.from("cs_tickets").select("id, status, created_at");
    const csList = (cs || []) as any[];
    console.log(`총 ${csList.length}개`);
    const csByStatus: Record<string, number> = {};
    for (const c of csList) csByStatus[c.status || "null"] = (csByStatus[c.status || "null"] || 0) + 1;
    console.log(`  상태별:`, csByStatus);
  } catch (e) {
    warn(`cs_tickets 테이블 조회 실패 (없을 수도): ${e instanceof Error ? e.message : "unknown"}`);
  }

  // ============= OKRs =============
  H("OKRs");
  try {
    const { data: okrs } = await sb.from("okrs").select("id, title, status");
    console.log(`총 ${(okrs || []).length}개`);
  } catch (e) {
    warn(`okrs 조회 실패: ${e instanceof Error ? e.message : "unknown"}`);
  }

  // ============= 요약 =============
  H("SUMMARY");
  console.log("위 내역에서 🔴 마크된 것들이 즉시 조치가 필요한 이슈이고,");
  console.log("⚠️  마크는 권고 수준입니다.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
