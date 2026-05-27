/**
 * DB에만 있고 AK 엑셀에 없는 망고 주문 101건을 엑셀로 출력
 */

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

interface AKRow {
  orderNo: string;
  receiver: string;
  phone: string;
}

async function main() {
  // 1. AK 엑셀 읽기
  const xlsPath = "/home/dev/OneDrive/신산애널리틱스/0. 판매사 정산/아시안킹_망고_출고_통합_260527.xlsx";
  const buf = fs.readFileSync(xlsPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets["AK_출고통합"];
  const raw = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: "", raw: false });

  const akUnique = new Map<string, AKRow>();
  for (let i = 4; i < raw.length; i++) {
    const r = raw[i];
    const orderNo = String(r[1] || "").trim();
    if (!orderNo) continue;
    if (!akUnique.has(orderNo)) {
      akUnique.set(orderNo, {
        orderNo,
        receiver: String(r[6] || "").trim(),
        phone: String(r[7] || "").replace(/[^0-9]/g, ""),
      });
    }
  }

  // 2. DB 망고 주문 조회
  const { data: dbOrders, error } = await sb
    .from("orders")
    .select("id, cafe24_order_id, order_date, product_name, quantity, product_price, order_amount, receiver_name, receiver_phone, receiver_address, buyer_name, shipping_status, tracking_number, shipping_company, shipped_at, supplier_id, suppliers:supplier_id(name), stores:store_id(name)")
    .ilike("product_name", "%망고%")
    .gte("order_date", "2026-05-01")
    .lte("order_date", "2026-05-31T23:59:59")
    .neq("shipping_status", "cancelled")
    .order("order_date", { ascending: true });

  if (error) { console.error(error.message); return; }

  // 3. AK 매칭 (compare-asianking.ts 와 동일 로직)
  const dbByOrderNo = new Map<string, any>();
  const dbByReceiverPhone = new Map<string, any[]>();
  for (const o of dbOrders!) {
    dbByOrderNo.set(o.cafe24_order_id, o);
    const key = `${(o.receiver_name || "").trim()}|${(o.receiver_phone || "").replace(/[^0-9]/g, "")}`;
    if (!dbByReceiverPhone.has(key)) dbByReceiverPhone.set(key, []);
    dbByReceiverPhone.get(key)!.push(o);
  }

  const matchedDbIds = new Set<string>();
  for (const [, ak] of akUnique) {
    let dbMatch = dbByOrderNo.get(ak.orderNo);
    if (!dbMatch) {
      const key = `${ak.receiver}|${ak.phone}`;
      const candidates = (dbByReceiverPhone.get(key) || []).filter((c: any) => !matchedDbIds.has(c.id));
      if (candidates.length >= 1) dbMatch = candidates[0];
    }
    if (dbMatch && !matchedDbIds.has(dbMatch.id)) {
      matchedDbIds.add(dbMatch.id);
    }
  }

  // 4. DB에만 있는 건
  const dbOnly = dbOrders!.filter((o: any) => !matchedDbIds.has(o.id));
  console.log(`DB에만 있는 망고 주문: ${dbOnly.length}건`);

  // 판매사별 카운트
  const storeCount = new Map<string, number>();
  for (const o of dbOnly) {
    const storeName = (o.stores as any)?.name || "미지정";
    storeCount.set(storeName, (storeCount.get(storeName) || 0) + 1);
  }
  console.log("\n판매사별:");
  for (const [name, count] of [...storeCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}건`);
  }

  // 5. 엑셀 출력
  const rows = dbOnly.map((o: any) => {
    const kstDate = new Date(new Date(o.order_date).getTime() + 9 * 3600000).toISOString().slice(0, 10);
    return {
      "주문번호": o.cafe24_order_id,
      "주문일": kstDate,
      "판매사": (o.stores as any)?.name || "",
      "공급사": (o.suppliers as any)?.name || "",
      "상품명": o.product_name,
      "수량": o.quantity,
      "수취인": o.receiver_name,
      "연락처": o.receiver_phone,
      "주소": o.receiver_address,
      "배송상태": o.shipping_status,
      "배송업체": o.shipping_company || "",
      "송장번호": o.tracking_number || "",
    };
  });

  const outWb = XLSX.utils.book_new();
  const outWs = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(outWb, outWs, "DB에만있는망고주문");
  const outPath = "/home/dev/OneDrive/신산애널리틱스/0. 판매사 정산/DB에만있는_망고주문_비교.xlsx";
  XLSX.writeFile(outWb, outPath);
  console.log(`\n엑셀 저장: ${outPath}`);
}

main().catch(console.error);
