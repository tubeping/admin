/**
 * 아시안킹 출고 엑셀 기준으로 튜핑어드민 DB 수정
 * - 송장번호 불일치 → AK 기준으로 업데이트
 * - 배송업체 누락/불일치 → AK 기준으로 업데이트
 * - 배송상태 ordered → shipping/delivered 업데이트
 *
 * Usage:
 *   npx tsx scripts/fix-asianking.ts          # dry-run
 *   npx tsx scripts/fix-asianking.ts --apply  # 실제 적용
 */

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const dryRun = !process.argv.includes("--apply");

interface AKRow {
  shipDate: string;
  orderNo: string;
  receiver: string;
  phone: string;
  carrier: string;
  tracking: string;
}

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLY MODE ===\n");

  // 1. 엑셀 읽기
  const xlsPath = "/home/dev/OneDrive/신산애널리틱스/0. 판매사 정산/아시안킹_망고_출고_통합_260527.xlsx";
  const buf = fs.readFileSync(xlsPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets["AK_출고통합"];
  const raw = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: "", raw: false });

  const akRows: AKRow[] = [];
  for (let i = 4; i < raw.length; i++) {
    const r = raw[i];
    const orderNo = String(r[1] || "").trim();
    if (!orderNo) continue;
    akRows.push({
      shipDate: String(r[0] || "").trim().slice(0, 10),
      orderNo,
      receiver: String(r[6] || "").trim(),
      phone: String(r[7] || "").replace(/[^0-9]/g, ""),
      carrier: String(r[10] || "").trim(),
      tracking: String(r[11] || "").trim(),
    });
  }

  // 중복 주문번호 → 첫 건만 (같은 주문 수량 분할)
  const akUnique = new Map<string, AKRow>();
  for (const ak of akRows) {
    if (!akUnique.has(ak.orderNo)) akUnique.set(ak.orderNo, ak);
  }

  // 2. DB 망고 주문 조회
  const { data: dbOrders, error } = await sb
    .from("orders")
    .select("id, cafe24_order_id, order_date, receiver_name, receiver_phone, shipping_status, tracking_number, shipping_company, shipped_at")
    .ilike("product_name", "%망고%")
    .gte("order_date", "2026-05-01")
    .lte("order_date", "2026-05-31T23:59:59")
    .neq("shipping_status", "cancelled");

  if (error) { console.error("DB 조회 에러:", error.message); return; }

  const dbByOrderNo = new Map<string, any>();
  const dbByReceiverPhone = new Map<string, any[]>();
  for (const o of dbOrders!) {
    dbByOrderNo.set(o.cafe24_order_id, o);
    const key = `${(o.receiver_name || "").trim()}|${(o.receiver_phone || "").replace(/[^0-9]/g, "")}`;
    if (!dbByReceiverPhone.has(key)) dbByReceiverPhone.set(key, []);
    dbByReceiverPhone.get(key)!.push(o);
  }

  // 3. 매칭 + 수정 사항 수집
  const updates: Array<{ id: string; orderNo: string; receiver: string; fields: Record<string, any>; desc: string[] }> = [];
  const matchedDbIds = new Set<string>();

  for (const [, ak] of akUnique) {
    let dbMatch = dbByOrderNo.get(ak.orderNo);
    if (!dbMatch) {
      const key = `${ak.receiver}|${ak.phone}`;
      const candidates = (dbByReceiverPhone.get(key) || []).filter((c: any) => !matchedDbIds.has(c.id));
      if (candidates.length >= 1) dbMatch = candidates[0];
    }
    if (!dbMatch || matchedDbIds.has(dbMatch.id)) continue;
    matchedDbIds.add(dbMatch.id);

    const akTracking = ak.tracking === "1234567890" ? "" : ak.tracking;
    const dbTracking = dbMatch.tracking_number || "";
    const fields: Record<string, any> = {};
    const desc: string[] = [];

    // 송장번호 업데이트
    if (akTracking && akTracking !== dbTracking) {
      fields.tracking_number = akTracking;
      desc.push(`송장: ${dbTracking || "없음"} → ${akTracking}`);
    }

    // 배송업체 업데이트
    if (ak.carrier && ak.carrier !== (dbMatch.shipping_company || "")) {
      fields.shipping_company = ak.carrier;
      desc.push(`배송업체: ${dbMatch.shipping_company || "없음"} → ${ak.carrier}`);
    }

    // 배송상태 업데이트: 실제 송장이 있는데 ordered면 → delivered로
    if (akTracking && (dbMatch.shipping_status === "ordered" || dbMatch.shipping_status === "pending")) {
      fields.shipping_status = "delivered";
      fields.shipped_at = fields.shipped_at || new Date(ak.shipDate + "T09:00:00+09:00").toISOString();
      desc.push(`상태: ${dbMatch.shipping_status} → delivered`);
    }

    // shipped_at 설정
    if (akTracking && !dbMatch.shipped_at) {
      fields.shipped_at = new Date(ak.shipDate + "T09:00:00+09:00").toISOString();
    }

    if (Object.keys(fields).length > 0) {
      updates.push({ id: dbMatch.id, orderNo: ak.orderNo, receiver: ak.receiver, fields, desc });
    }
  }

  console.log(`수정 대상: ${updates.length}건\n`);

  for (const u of updates) {
    console.log(`${u.orderNo} (${u.receiver})`);
    for (const d of u.desc) console.log(`  → ${d}`);
  }

  if (dryRun) {
    console.log("\n실제 적용: npx tsx scripts/fix-asianking.ts --apply");
    return;
  }

  // 실제 적용
  console.log("\n적용 중...");
  let fixed = 0;
  for (const u of updates) {
    const { error } = await sb.from("orders").update(u.fields).eq("id", u.id);
    if (error) {
      console.error(`  실패: ${u.orderNo} - ${error.message}`);
    } else {
      fixed++;
    }
  }
  console.log(`\n완료: ${fixed}/${updates.length}건 수정`);
}

main().catch(console.error);
