import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import * as XLSX from "xlsx";

/**
 * POST /api/orders/payment-match — 은행 거래내역 업로드 → 고객명 기준 입금 매칭
 *
 * FormData: file (은행 엑셀/CSV)
 *
 * 흐름:
 *   1. 은행 파일 파싱 → 입금 건만 추출 (입금자명, 금액)
 *   2. 미입금 주문(shipping_status=pending) 조회
 *   3. 입금자명 ↔ buyer_name/receiver_name 매칭
 *   4. 매칭 결과 반환 (확정은 별도 PATCH로)
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
  }

  // 파일 파싱
  const fname = file.name.toLowerCase();
  const isExcel = fname.endsWith(".xlsx") || fname.endsWith(".xls");

  let rows: string[][] = [];
  if (isExcel) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "시트 없음" }, { status: 400 });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    rows = aoa
      .map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c).trim())))
      .filter((r) => r.some((c) => c !== ""));
  } else {
    const text = await file.text();
    rows = text.replace(/^\uFEFF/, "").split("\n")
      .map((l) => l.trim()).filter((l) => l)
      .map((l) => l.split(",").map((c) => c.replace(/"/g, "").trim()));
  }

  if (rows.length < 2) {
    return NextResponse.json({ error: "데이터 없음" }, { status: 400 });
  }

  // 헤더 파싱 — 은행마다 다른 컬럼명 유연 매칭
  const header = rows[0].map((h) => h.replace(/[\s\-_]/g, "").toLowerCase());
  const findCol = (...candidates: string[]): number => {
    for (const c of candidates) {
      const idx = header.indexOf(c.toLowerCase().replace(/[\s\-_]/g, ""));
      if (idx >= 0) return idx;
    }
    for (const c of candidates) {
      const idx = header.findIndex((h) => h.includes(c.toLowerCase().replace(/[\s\-_]/g, "")));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const nameCol = findCol("입금자명", "보내는분", "적요", "거래자명", "입금인", "비고", "이름", "성명", "name");
  const amountCol = findCol("입금", "입금액", "거래금액", "금액", "amount");
  const dateCol = findCol("거래일", "거래일시", "일자", "날짜", "date");
  const memoCol = findCol("메모", "비고", "적요내용", "내용");

  if (nameCol < 0) {
    return NextResponse.json({
      error: `입금자명 컬럼을 찾을 수 없습니다.\n헤더: ${rows[0].join(", ")}`,
    }, { status: 400 });
  }

  // 입금 건 추출
  interface Deposit {
    name: string;
    amount: number;
    date: string;
    memo: string;
    row_index: number;
  }

  const deposits: Deposit[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const name = (cols[nameCol] || "").trim();
    if (!name) continue;

    const amountStr = amountCol >= 0 ? (cols[amountCol] || "0").replace(/[,\s원]/g, "") : "0";
    const amount = parseInt(amountStr, 10) || 0;
    if (amountCol >= 0 && amount <= 0) continue; // 출금 건 제외

    deposits.push({
      name,
      amount,
      date: dateCol >= 0 ? (cols[dateCol] || "") : "",
      memo: memoCol >= 0 ? (cols[memoCol] || "") : "",
      row_index: i + 1,
    });
  }

  if (deposits.length === 0) {
    return NextResponse.json({ error: "입금 건이 없습니다" }, { status: 400 });
  }

  // 미입금 주문 조회 (pending 상태)
  const sb = getServiceClient();
  const { data: orders } = await sb
    .from("orders")
    .select("id, cafe24_order_id, order_date, product_name, option_text, quantity, product_price, order_amount, buyer_name, buyer_phone, receiver_name, shipping_status, store_id, stores:store_id(name)")
    .eq("shipping_status", "pending")
    .order("order_date", { ascending: false })
    .limit(500);

  if (!orders || orders.length === 0) {
    return NextResponse.json({ deposits: deposits.length, matches: [], unmatched_deposits: deposits, message: "미입금 대기 주문이 없습니다" });
  }

  // 매칭: 입금자명 ↔ buyer_name 또는 receiver_name
  function normalize(s: string): string {
    return s.replace(/[\s\-()]/g, "").toLowerCase();
  }

  interface MatchResult {
    deposit: Deposit;
    order: {
      id: string;
      cafe24_order_id: string;
      order_date: string;
      product_name: string;
      quantity: number;
      order_amount: number;
      buyer_name: string;
      receiver_name: string;
      store_name: string;
    };
    match_type: "buyer" | "receiver";
  }

  const matches: MatchResult[] = [];
  const matchedOrderIds = new Set<string>();
  const matchedDepositIdx = new Set<number>();

  for (const dep of deposits) {
    const depName = normalize(dep.name);
    if (!depName) continue;

    // 정확 매칭 우선
    const exact = orders.find((o) =>
      !matchedOrderIds.has(o.id) && (
        normalize(o.buyer_name || "") === depName ||
        normalize(o.receiver_name || "") === depName
      )
    );

    if (exact) {
      const matchType = normalize(exact.buyer_name || "") === depName ? "buyer" : "receiver";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storeName = Array.isArray(exact.stores) ? (exact.stores as any)[0]?.name : (exact.stores as any)?.name || "";
      matches.push({
        deposit: dep,
        order: {
          id: exact.id,
          cafe24_order_id: exact.cafe24_order_id,
          order_date: exact.order_date,
          product_name: exact.product_name,
          quantity: exact.quantity,
          order_amount: exact.order_amount,
          buyer_name: exact.buyer_name || "",
          receiver_name: exact.receiver_name || "",
          store_name: storeName,
        },
        match_type: matchType,
      });
      matchedOrderIds.add(exact.id);
      matchedDepositIdx.add(dep.row_index);
      continue;
    }

    // 부분 매칭 (2글자 이상 이름이 포함되면)
    if (depName.length >= 2) {
      const partial = orders.find((o) =>
        !matchedOrderIds.has(o.id) && (
          normalize(o.buyer_name || "").includes(depName) ||
          normalize(o.receiver_name || "").includes(depName) ||
          depName.includes(normalize(o.buyer_name || "")) ||
          depName.includes(normalize(o.receiver_name || ""))
        )
      );
      if (partial) {
        const matchType = (normalize(partial.buyer_name || "").includes(depName) || depName.includes(normalize(partial.buyer_name || ""))) ? "buyer" : "receiver";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const storeName = Array.isArray(partial.stores) ? (partial.stores as any)[0]?.name : (partial.stores as any)?.name || "";
        matches.push({
          deposit: dep,
          order: {
            id: partial.id,
            cafe24_order_id: partial.cafe24_order_id,
            order_date: partial.order_date,
            product_name: partial.product_name,
            quantity: partial.quantity,
            order_amount: partial.order_amount,
            buyer_name: partial.buyer_name || "",
            receiver_name: partial.receiver_name || "",
            store_name: storeName,
          },
          match_type: matchType,
        });
        matchedOrderIds.add(partial.id);
        matchedDepositIdx.add(dep.row_index);
      }
    }
  }

  const unmatchedDeposits = deposits.filter((d) => !matchedDepositIdx.has(d.row_index));

  return NextResponse.json({
    total_deposits: deposits.length,
    matched: matches.length,
    unmatched: unmatchedDeposits.length,
    pending_orders: orders.length,
    matches,
    unmatched_deposits: unmatchedDeposits,
    matched_columns: {
      name: rows[0][nameCol],
      amount: amountCol >= 0 ? rows[0][amountCol] : null,
      date: dateCol >= 0 ? rows[0][dateCol] : null,
    },
  });
}
