/**
 * import-finance-data.mjs — 재무 데이터 적재 (hub.eumlogics.kr/shinsan localStorage → Supabase fin_*)
 *
 * ── 데이터 최신화 절차 (최준 대표용) ───────────────────────────────
 * 1) hub.eumlogics.kr/shinsan 을 띄운 브라우저 콘솔에서 아래 실행 → 클립보드 복사:
 *
 *      copy(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('shinsan_db_'))))
 *
 * 2) 클립보드 내용을 finance-export.json 으로 저장.
 * 3) 전체 교체(권장 — 중복 안 남):
 *
 *      node scripts/import-finance-data.mjs finance-export.json --replace
 *
 *    └ --replace: fin_* 5개 테이블을 전부 비우고 새로 적재(=현재 hub 스냅샷으로 통째 교체).
 *      플래그를 빼면 기존 데이터 위에 append 되어 중복이 생기므로 갱신 시엔 반드시 --replace.
 *
 * env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.local 에 이미 설정돼 있음)
 * ──────────────────────────────────────────────────────────────────
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const file = args.find((a) => !a.startsWith("--")) || "finance-export.json";
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

console.log(`소스: ${file} | 모드: ${replace ? "전체 교체(--replace)" : "추가(append) ⚠️ 갱신이면 --replace 권장"}`);

for (const [table, rows, map] of TABLES) {
  // 갱신 전 현재 건수 표시(안전 확인용)
  const { count: before } = await sb.from(table).select("*", { count: "exact", head: true });

  if (replace) {
    const { error: delErr } = await sb.from(table).delete().gt("id", 0); // id 는 identity PK → 전체 삭제
    if (delErr) { console.error(`${table} 비우기 실패:`, delErr.message); process.exit(1); }
  }

  if (!rows?.length) { console.log(`${table}: 입력 0건 (기존 ${before ?? 0}건, ${replace ? "비움" : "유지"})`); continue; }
  const mapped = rows.filter((r) => r.date).map(map);
  for (let i = 0; i < mapped.length; i += 500) {
    const chunk = mapped.slice(i, i + 500);
    const { error } = await sb.from(table).insert(chunk);
    if (error) { console.error(`${table} [${i}] 실패:`, error.message); process.exit(1); }
  }
  console.log(`${table}: 기존 ${before ?? 0}건 → ${replace ? "교체" : "추가"} ${mapped.length}건 완료`);
}
console.log(`✅ ${replace ? "전체 교체" : "적재"} 완료`);
