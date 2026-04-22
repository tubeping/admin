import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";

/**
 * POST /api/orders/morning-collect — 구글 시트에서 입금완료된 전화주문 자동 수집
 *
 * body: { sheet_url: string }
 *
 * 흐름:
 *   1. 시트 CSV 다운로드
 *   2. 각 행의 주문번호로 기존 DB 조회 → 이미 있으면 skip
 *   3. payment_logs에서 해당 수령인 이름 매칭 찾기 (최근 30일)
 *   4. 매칭 성공 시 orders에 insert (shipping_status='ordered'), 아니면 skip
 *   5. 결과 반환
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sheetUrl: string = body.sheet_url || "";

  if (!sheetUrl) {
    return NextResponse.json({ error: "sheet_url 필수" }, { status: 400 });
  }

  // 1. CSV 다운로드
  let csvText: string;
  try {
    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error(`${res.status}`);
    csvText = await res.text();
  } catch (e) {
    return NextResponse.json({ error: `시트 다운로드 실패: ${e instanceof Error ? e.message : "unknown"}` }, { status: 500 });
  }

  // 2. CSV 파싱 (간단 파서: 따옴표 처리)
  const rawRows = csvText.replace(/^\uFEFF/, "").split("\n").map((l) => l.trim()).filter((l) => l);
  const rows: string[][] = rawRows.map((line) => {
    const out: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.replace(/^"|"$/g, "").trim());
  });

  if (rows.length < 2) {
    return NextResponse.json({ error: "시트에 데이터가 없습니다" });
  }

  // 3. 헤더 매칭
  const header = rows[0].map((h) => h.toLowerCase().replace(/[\s\-_()]/g, ""));
  const findCol = (...cands: string[]): number => {
    for (const c of cands) {
      const norm = c.toLowerCase().replace(/[\s\-_()]/g, "");
      const idx = header.indexOf(norm);
      if (idx >= 0) return idx;
    }
    for (const c of cands) {
      const norm = c.toLowerCase().replace(/[\s\-_()]/g, "");
      const idx = header.findIndex((h) => h.includes(norm));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const colOrderNo = findCol("주문번호");
  const colStore = findCol("판매처");
  const colProduct = findCol("상품명");
  const colOption = findCol("상품옵션", "옵션");
  const colQty = findCol("수량");
  const colReceiver = findCol("수령인");
  const colPhone = findCol("수령인전화번호", "전화번호", "연락처");
  const colZip = findCol("수령인우편번호", "우편번호");
  const colAddr = findCol("수령인주소", "주소", "배송지");
  const colMemo = findCol("배송메시지", "배송메세지", "메모");

  if (colProduct < 0 || colReceiver < 0 || colPhone < 0) {
    return NextResponse.json({
      error: `필수 컬럼 없음 (상품명/수령인/전화번호)`,
      headers: rows[0],
    }, { status: 400 });
  }

  const sb = getServiceClient();

  // 4. 전화주문 store
  let phoneStoreId: string;
  const { data: phoneStore } = await sb.from("stores").select("id").eq("name", "전화주문").maybeSingle();
  if (phoneStore) {
    phoneStoreId = phoneStore.id;
  } else {
    const { data: created } = await sb.from("stores").insert({ mall_id: `manual_${Date.now()}`, name: "전화주문", status: "active" }).select("id").single();
    phoneStoreId = created!.id;
  }

  // 5. 시트의 모든 주문번호 수집 → 전화주문은 PT- 접두사로 저장
  //    기존 orders 조회 (PT- 접두사 포함해서 중복 체크)
  const orderNos = rows.slice(1)
    .map((r) => (r[colOrderNo] || "").trim())
    .filter(Boolean)
    .map((no) => no.startsWith("PT-") ? no : `PT-${no}`);
  const { data: existing } = await sb
    .from("orders")
    .select("cafe24_order_id")
    .in("cafe24_order_id", orderNos);
  const existingKeys = new Set((existing || []).map((e) => e.cafe24_order_id));

  // 6. payment_logs 매칭 준비 — 최근 30일
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: paymentLogs } = await sb
    .from("payment_logs")
    .select("depositor_name, amount, status, matched_order_ids, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  // 이름 정규화 맵
  const normName = (s: string) => (s || "").replace(/[\s\-()]/g, "").toLowerCase();
  const paidNameToLogs: Record<string, { amount: number; created_at: string }[]> = {};
  for (const log of paymentLogs || []) {
    const k = normName(log.depositor_name || "");
    if (!k) continue;
    if (!paidNameToLogs[k]) paidNameToLogs[k] = [];
    paidNameToLogs[k].push({ amount: log.amount || 0, created_at: log.created_at });
  }

  // 7. 상품명 매칭 → price 조회
  const productNames = [...new Set(rows.slice(1).map((r) => (r[colProduct] || "").trim()).filter(Boolean))];
  const { data: productMatches } = await sb
    .from("products")
    .select("product_name, price, tp_code")
    .in("product_name", productNames);
  const productPriceMap: Record<string, { price: number; tp_code: string }> = {};
  for (const p of productMatches || []) {
    productPriceMap[p.product_name] = { price: p.price || 0, tp_code: p.tp_code || "" };
  }

  // 8. 행 처리
  let imported = 0;
  let skipped_already = 0;
  let skipped_no_payment = 0;
  let skipped_error = 0;
  const importedIds: string[] = [];
  const details: Array<{ order_no: string; receiver: string; status: string; reason?: string }> = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawOrderNo = (r[colOrderNo] || "").trim();
    const orderNo = rawOrderNo.startsWith("PT-") ? rawOrderNo : `PT-${rawOrderNo}`;
    const receiver = (r[colReceiver] || "").trim();
    const product = (r[colProduct] || "").trim();
    if (!rawOrderNo || !product || !receiver) {
      skipped_error++;
      continue;
    }
    if (existingKeys.has(orderNo)) {
      skipped_already++;
      details.push({ order_no: orderNo, receiver, status: "이미 등록" });
      continue;
    }

    // 입금 매칭 — 수령인 이름으로
    const key = normName(receiver);
    const matched = paidNameToLogs[key] && paidNameToLogs[key].length > 0;

    // 금액: 시트에 금액 없음 → products.price로
    const priceInfo = productPriceMap[product];
    const unitPrice = priceInfo?.price || 0;
    const qty = parseInt(r[colQty] || "1", 10) || 1;
    const orderAmount = unitPrice * qty;

    // 입금액 매칭 검증 — 있으면 플러스
    const matchedLog = matched ? paidNameToLogs[key].find((l) => l.amount >= orderAmount && l.amount <= orderAmount + 9) : null;
    const paymentAmount = matchedLog ? matchedLog.amount : orderAmount;
    const shippingStatus = matched ? "ordered" : "pending"; // 입금완료 / 입금전

    const { data: inserted, error } = await sb
      .from("orders")
      .insert({
        store_id: phoneStoreId,
        cafe24_order_id: orderNo,
        cafe24_order_item_code: orderNo,
        order_date: new Date().toISOString(),
        product_name: product,
        option_text: colOption >= 0 ? (r[colOption] || "") : "",
        quantity: qty,
        product_price: unitPrice,
        order_amount: orderAmount,
        payment_amount: paymentAmount,
        buyer_name: receiver,
        buyer_phone: colPhone >= 0 ? (r[colPhone] || "") : "",
        receiver_name: receiver,
        receiver_phone: colPhone >= 0 ? (r[colPhone] || "") : "",
        receiver_address: colAddr >= 0 ? (r[colAddr] || "") : "",
        receiver_zipcode: colZip >= 0 ? (r[colZip] || "") : "",
        memo: colMemo >= 0 ? (r[colMemo] || "") : "",
        shipping_status: shippingStatus,
      })
      .select("id")
      .single();

    if (error) {
      skipped_error++;
      details.push({ order_no: orderNo, receiver, status: "에러", reason: error.message });
      continue;
    }
    importedIds.push(inserted!.id);
    imported++;
    if (!matched) skipped_no_payment++;
    details.push({ order_no: orderNo, receiver, status: matched ? "수집완료(입금확인)" : "수집완료(입금대기)" });
  }

  // 9. 공급사 자동 배정
  if (importedIds.length > 0) {
    try { await autoAssignSuppliers(sb, { orderIds: importedIds }); } catch { /* ignore */ }
  }

  return NextResponse.json({
    total_rows: rows.length - 1,
    imported,
    skipped_already,
    skipped_no_payment,
    skipped_error,
    details: details.slice(0, 100),
  });
}
