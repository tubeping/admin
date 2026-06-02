/**
 * import-finance-data.mjs — 재무 데이터 1회성 이관 (hub.eumlogics.kr/shinsan → Supabase)
 *
 * ⚠️ 진짜 최신 데이터는 PRELOADED(data.js, 스냅샷)가 아니라
 *    hub.eumlogics.kr 를 띄운 브라우저의 localStorage['shinsan_db_v6_*'] 에 있다.
 *    먼저 그 브라우저 콘솔에서 아래를 실행해 JSON 을 받아둘 것:
 *
 *      copy(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('shinsan_db_'))))
 *
 *    클립보드 내용을 finance-export.json 으로 저장한 뒤:
 *      node scripts/import-finance-data.mjs finance-export.json
 *
 * env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.local)
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const file = process.argv[2] || "finance-export.json";
const db = JSON.parse(readFileSync(file, "utf8"));

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// localStorage 의 camelCase 필드 → DB snake_case 매핑
const mapCommon = (r) => ({
  date: r.date,
  partner: r.partner ?? null,
  amount: r.amount ?? 0,
  category: r.category ?? null,
  corp_num: r.corpNum ?? null,
  descr: r.desc ?? null,
  memo: r.memo ?? null,
});
const mapInvoice = (r) => ({ ...mapCommon(r), type: r.type ?? null, supply: r.supply ?? 0, tax: r.tax ?? 0 });
const mapBank = (r) => ({ ...mapCommon(r), balance: r.balance ?? null });

const TABLES = [
  ["fin_sales", db.sales, mapInvoice],
  ["fin_purchases", db.purchases, mapInvoice],
  ["fin_card_tx", db.cardTx, mapCommon],
  ["fin_bank_in", db.bankIn, mapBank],
  ["fin_bank_out", db.bankOut, mapBank],
];

for (const [table, rows, map] of TABLES) {
  if (!rows?.length) { console.log(`${table}: 0건 (건너뜀)`); continue; }
  const mapped = rows.filter((r) => r.date).map(map);
  // 500건씩 배치 insert
  for (let i = 0; i < mapped.length; i += 500) {
    const chunk = mapped.slice(i, i + 500);
    const { error } = await sb.from(table).insert(chunk);
    if (error) { console.error(`${table} [${i}] 실패:`, error.message); process.exit(1); }
  }
  console.log(`${table}: ${mapped.length}건 적재 완료`);
}
console.log("✅ 이관 완료");
