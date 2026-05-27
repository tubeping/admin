/**
 * 아시안킹 출고 엑셀 vs 튜핑어드민 주문 비교 스크립트
 *
 * 비교 대상: 망고 상품 주문 (5/12~5/15 기간)
 * 매칭 기준: 주문번호(cafe24_order_id) 또는 수취인+연락처
 */

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

interface AKRow {
  shipDate: string;
  orderNo: string;
  store: string;
  product: string;
  qty: number;
  receiver: string;
  phone: string;
  carrier: string;
  tracking: string;
}

async function main() {
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
      store: String(r[2] || "").trim(),
      product: String(r[3] || "").trim(),
      qty: parseInt(r[5] || "1", 10) || 1,
      receiver: String(r[6] || "").trim(),
      phone: String(r[7] || "").replace(/[^0-9]/g, ""),
      carrier: String(r[10] || "").trim(),
      tracking: String(r[11] || "").trim(),
    });
  }
  console.log(`아시안킹 엑셀: ${akRows.length}건\n`);

  // 2. 튜핑어드민 망고 주문 조회 (5월 전체)
  const { data: dbOrders, error } = await sb
    .from("orders")
    .select("id, cafe24_order_id, order_date, product_name, quantity, receiver_name, receiver_phone, shipping_status, tracking_number, shipping_company, supplier_id, suppliers:supplier_id(name)")
    .ilike("product_name", "%망고%")
    .gte("order_date", "2026-05-01")
    .lte("order_date", "2026-05-31T23:59:59")
    .neq("shipping_status", "cancelled")
    .order("order_date", { ascending: true });

  if (error) { console.error("DB 조회 에러:", error.message); return; }
  console.log(`튜핑어드민 망고 주문: ${dbOrders!.length}건\n`);

  // DB 인덱스: 주문번호 → order, 수취인+연락처 → order[]
  const dbByOrderNo = new Map<string, any>();
  const dbByReceiverPhone = new Map<string, any[]>();
  for (const o of dbOrders!) {
    dbByOrderNo.set(o.cafe24_order_id, o);
    const key = `${(o.receiver_name || "").trim()}|${(o.receiver_phone || "").replace(/[^0-9]/g, "")}`;
    if (!dbByReceiverPhone.has(key)) dbByReceiverPhone.set(key, []);
    dbByReceiverPhone.get(key)!.push(o);
  }

  // 3. 비교
  const matched: Array<{ ak: AKRow; db: any; diffs: string[] }> = [];
  const notInDb: AKRow[] = [];
  const matchedDbIds = new Set<string>();

  // 중복 주문번호 제거 (엑셀에 동일 주문번호가 여러 번 나옴 - 수량 나눠서)
  const akUnique = new Map<string, AKRow>();
  for (const ak of akRows) {
    if (!akUnique.has(ak.orderNo)) {
      akUnique.set(ak.orderNo, ak);
    }
  }

  for (const [, ak] of akUnique) {
    // 1차: 주문번호 매칭
    let dbMatch = dbByOrderNo.get(ak.orderNo);

    // 2차: 수취인+연락처 매칭
    if (!dbMatch) {
      const key = `${ak.receiver}|${ak.phone}`;
      const candidates = dbByReceiverPhone.get(key) || [];
      if (candidates.length === 1) {
        dbMatch = candidates[0];
      } else if (candidates.length > 1) {
        // 여러 건이면 매칭 안 함 (수동 확인)
        dbMatch = candidates.find((c: any) => !matchedDbIds.has(c.id));
      }
    }

    if (dbMatch && !matchedDbIds.has(dbMatch.id)) {
      matchedDbIds.add(dbMatch.id);
      const diffs: string[] = [];

      // 송장 비교
      const akTracking = ak.tracking === "1234567890" ? "" : ak.tracking;
      const dbTracking = dbMatch.tracking_number || "";
      if (akTracking && akTracking !== dbTracking) {
        diffs.push(`송장: DB[${dbTracking || "없음"}] → AK[${akTracking}]`);
      }

      // 배송업체 비교
      if (ak.carrier && ak.carrier !== (dbMatch.shipping_company || "")) {
        diffs.push(`배송업체: DB[${dbMatch.shipping_company || "없음"}] → AK[${ak.carrier}]`);
      }

      // 배송상태 비교 (아시안킹에서 출고됐으면 최소 shipping이어야 함)
      if (akTracking && dbMatch.shipping_status === "ordered") {
        diffs.push(`상태: DB[ordered] → 실제출고(shipping/delivered)`);
      }

      // 공급사 비교
      const supplierName = (dbMatch.suppliers as any)?.name || "";
      if (supplierName && !supplierName.includes("아시안킹")) {
        diffs.push(`공급사: DB[${supplierName}] (아시안킹이어야 함)`);
      }
      if (!supplierName) {
        diffs.push(`공급사: 미배정 (아시안킹이어야 함)`);
      }

      matched.push({ ak, db: dbMatch, diffs });
    } else if (!dbMatch) {
      notInDb.push(ak);
    }
  }

  // DB에만 있는 주문
  const notInAk = dbOrders!.filter((o: any) => !matchedDbIds.has(o.id));

  console.log("========== 비교 결과 ==========");
  console.log(`매칭됨: ${matched.length}건`);
  console.log(`  - 차이 있음: ${matched.filter(m => m.diffs.length > 0).length}건`);
  console.log(`  - 일치: ${matched.filter(m => m.diffs.length === 0).length}건`);
  console.log(`아시안킹에만 있음 (DB에 없음): ${notInDb.length}건`);
  console.log(`DB에만 있음 (아시안킹에 없음): ${notInAk.length}건`);

  // 차이 상세
  const withDiffs = matched.filter(m => m.diffs.length > 0);
  if (withDiffs.length > 0) {
    console.log("\n========== 차이 상세 ==========");
    for (const m of withDiffs) {
      console.log(`\n주문번호: ${m.ak.orderNo} (DB: ${m.db.cafe24_order_id})`);
      console.log(`  수취인: ${m.ak.receiver} / ${m.ak.phone}`);
      for (const d of m.diffs) {
        console.log(`  ⚠ ${d}`);
      }
    }
  }

  // 아시안킹에만 있는 건
  if (notInDb.length > 0) {
    console.log("\n========== 아시안킹에만 있음 (DB에 없음) ==========");
    for (const ak of notInDb) {
      console.log(`  ${ak.orderNo} ${ak.receiver} ${ak.phone} ${ak.tracking}`);
    }
  }

  // DB에만 있는 건
  if (notInAk.length > 0) {
    console.log("\n========== DB에만 있음 (아시안킹에 없음) ==========");
    for (const o of notInAk) {
      const dateStr = new Date(o.order_date).toISOString().slice(0, 10);
      console.log(`  ${o.cafe24_order_id} ${dateStr} ${o.receiver_name} ${o.shipping_status} ${o.tracking_number || "송장없음"}`);
    }
  }

  // 수정이 필요한 건 요약
  const needsTrackingUpdate = withDiffs.filter(m => m.diffs.some(d => d.startsWith("송장:")));
  const needsCarrierUpdate = withDiffs.filter(m => m.diffs.some(d => d.startsWith("배송업체:")));
  const needsStatusUpdate = withDiffs.filter(m => m.diffs.some(d => d.startsWith("상태:")));
  const needsSupplierUpdate = withDiffs.filter(m => m.diffs.some(d => d.startsWith("공급사:")));

  console.log("\n========== 수정 필요 요약 ==========");
  console.log(`송장 업데이트 필요: ${needsTrackingUpdate.length}건`);
  console.log(`배송업체 업데이트 필요: ${needsCarrierUpdate.length}건`);
  console.log(`배송상태 업데이트 필요: ${needsStatusUpdate.length}건`);
  console.log(`공급사 배정 필요: ${needsSupplierUpdate.length}건`);
}

main().catch(console.error);
