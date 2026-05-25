/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load .env.local
const envPath = path.resolve(__dirname, "..", ".env.local");
const env = fs.readFileSync(envPath, "utf-8");
const envVars: Record<string, string> = {};
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) envVars[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const url = envVars.NEXT_PUBLIC_SUPABASE_URL || envVars.SUPABASE_URL;
const key = envVars.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE env. Found:", Object.keys(envVars).filter((k) => k.includes("SUPABASE")));
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const section = (title: string) => console.log(`\n=== ${title} ===`);

async function main() {
  section("1. Orders summary");
  const { data: o1 } = await sb.from("orders").select("id, supplier_id, shipping_status, is_sample");
  const orders = o1 || [];
  const active = orders.filter((o: any) => o.shipping_status !== "cancelled");
  console.log(`전체 orders: ${orders.length}, 활성(취소 제외): ${active.length}`);
  console.log(`  공급사 배정: ${active.filter((o: any) => o.supplier_id).length}`);
  console.log(`  공급사 미배정: ${active.filter((o: any) => !o.supplier_id).length}`);
  console.log(`  샘플: ${active.filter((o: any) => o.is_sample).length}`);

  section("2. Suppliers");
  const { data: sup } = await sb.from("suppliers").select("id, name, short_code, status");
  console.table((sup || []).map((s: any) => ({ name: s.name, short_code: s.short_code, status: s.status })));

  section("3. Products count + tp_code format");
  const { data: prod } = await sb.from("products").select("id, product_name, tp_code, supplier, mapping_verified, name_aliases");
  const products = prod || [];
  console.log(`전체 products: ${products.length}`);
  const tpRe = /^([A-Z]{2})([A-Z0-9]{2})\d+$/;
  const valid = products.filter((p: any) => p.tp_code && tpRe.test(p.tp_code));
  const invalid = products.filter((p: any) => p.tp_code && !tpRe.test(p.tp_code));
  const nullTp = products.filter((p: any) => !p.tp_code);
  console.log(`  tp_code 정상 포맷: ${valid.length}`);
  console.log(`  tp_code 비정상 포맷: ${invalid.length}`);
  console.log(`  tp_code 없음: ${nullTp.length}`);
  if (invalid.length > 0) {
    console.log("  비정상 샘플:", invalid.slice(0, 5).map((p: any) => p.tp_code));
  }

  section("4. 공급사 코드 분포 (products.tp_code 추출)");
  const codeCount: Record<string, number> = {};
  for (const p of valid as any[]) {
    const code = p.tp_code.substring(2, 4).toUpperCase();
    codeCount[code] = (codeCount[code] || 0) + 1;
  }
  const codeTable = Object.entries(codeCount).map(([code, cnt]) => {
    const match = (sup || []).find((s: any) => (s.short_code || "").toUpperCase() === code);
    return { code, products: cnt, supplier: match?.name || "(미등록)" };
  });
  console.table(codeTable);

  section("5. 매칭 가능 vs 불가 (현재 미배정 주문 기준)");
  const unassigned = active.filter((o: any) => !o.supplier_id);
  const { data: fullOrders } = await sb
    .from("orders")
    .select("id, product_name, supplier_id, shipping_status")
    .is("supplier_id", null)
    .neq("shipping_status", "cancelled");
  const nameToProduct: Record<string, any> = {};
  for (const p of products as any[]) {
    if (p.product_name) nameToProduct[p.product_name.trim()] = p;
    for (const alias of p.name_aliases || []) nameToProduct[(alias || "").trim()] = p;
  }
  const supByCode: Record<string, any> = {};
  for (const s of (sup || []) as any[]) if (s.short_code) supByCode[s.short_code.toUpperCase()] = s;

  const diagnostics: any[] = [];
  for (const o of (fullOrders || []) as any[]) {
    const key = (o.product_name || "").trim();
    const p = nameToProduct[key];
    const tp = p?.tp_code;
    const code = tp && tpRe.test(tp) ? tp.substring(2, 4).toUpperCase() : null;
    const expectedSupplier = code ? supByCode[code] : null;
    diagnostics.push({
      product: key.slice(0, 40),
      found_product: !!p,
      tp_code: tp || "-",
      code: code || "-",
      expected_supplier: expectedSupplier?.name || "-",
      reason: !p ? "products에 없음" : !tp ? "tp_code 없음" : !code ? "tp_code 포맷 오류" : !expectedSupplier ? "공급사 코드 미등록" : "OK(매칭 가능)",
    });
  }
  const grouped: Record<string, { product: string; tp_code: string; code: string; expected_supplier: string; reason: string; cnt: number }> = {};
  for (const d of diagnostics) {
    const k = d.product;
    if (!grouped[k]) grouped[k] = { ...d, cnt: 0 };
    grouped[k].cnt++;
  }
  console.table(Object.values(grouped));

  section("6. 현재 배정된 주문 (상품 x 공급사 분포)");
  const { data: assigned } = await sb
    .from("orders")
    .select("id, product_name, suppliers:supplier_id(name)")
    .not("supplier_id", "is", null)
    .neq("shipping_status", "cancelled");
  const assignedGroup: Record<string, number> = {};
  for (const o of (assigned || []) as any[]) {
    const sname = Array.isArray(o.suppliers) ? o.suppliers[0]?.name : (o.suppliers as any)?.name;
    const k = `${(o.product_name || "").trim().slice(0, 40)} || ${sname || "(null)"}`;
    assignedGroup[k] = (assignedGroup[k] || 0) + 1;
  }
  console.table(Object.entries(assignedGroup).map(([k, cnt]) => {
    const [product, supplier] = k.split(" || ");
    return { product, supplier, cnt };
  }));

  section("7. 과거 불일치 데이터 체크 (products.supplier 텍스트 vs tp_code 기반)");
  const mismatched: any[] = [];
  for (const p of valid as any[]) {
    const code = p.tp_code.substring(2, 4).toUpperCase();
    const tpSupplier = supByCode[code];
    if (tpSupplier && p.supplier && tpSupplier.name !== p.supplier) {
      mismatched.push({
        tp_code: p.tp_code,
        product: (p.product_name || "").slice(0, 40),
        text_supplier: p.supplier,
        code_supplier: tpSupplier.name,
      });
    }
  }
  console.log(`products.supplier(텍스트) vs tp_code(코드) 불일치: ${mismatched.length}건`);
  if (mismatched.length > 0) console.table(mismatched.slice(0, 10));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
