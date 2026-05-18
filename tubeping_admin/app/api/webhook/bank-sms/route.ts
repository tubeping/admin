import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, cafe24Fetch } from "@/lib/cafe24";
import { env } from "@/lib/env.server";

const WEBHOOK_SECRET = env.WEBHOOK_SECRET;

/**
 * POST /api/webhook/bank-sms — 은행 입금 문자 자동 처리 (MacroDroid → webhook)
 *
 * Headers: Authorization: Bearer <WEBHOOK_SECRET>
 * body: { text: string } — SMS 원문
 *
 * 흐름:
 *   1. SMS 파싱 → 입금자명 + 금액
 *   2. pending 주문에서 buyer_name/receiver_name 매칭
 *   3. 자동 입금확인 (shipping_status: pending → ordered)
 *   4. 카페24 상태 전환 (N00 → N10 상품준비중)
 *   5. payment_logs 테이블에 이력 저장
 */

// 신한은행 SMS 파싱 (멀티라인 + 한줄 형식 모두 지원)
function parseShinhanSms(text: string): { name: string; amount: number } | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l);
  let amount = 0;
  let name = "";

  const skipPatterns = [/^1577/, /^\[?web/i, /신한/i, /요일/, /오전|오후/, /^\d{2,3}-\d{3,4}-\d{4,}/, /^잔액/];

  for (const line of lines) {
    const depositMatch = line.match(/입금\s+([\d,]+)/);
    if (depositMatch) {
      amount = parseInt(depositMatch[1].replace(/,/g, ""), 10) || 0;
      continue;
    }
    if (/^잔액/.test(line)) continue;
    if (skipPatterns.some((p) => p.test(line))) continue;
    if (/^[\d,]+원?$/.test(line.replace(/\s/g, ""))) continue;
    if (!name && line.length >= 2) name = line;
  }

  // 한 줄 형식 fallback: [신한은행] 입금 50,000원 홍길동 잔액 1,234,567원
  if (!name) {
    const p1 = cleaned.match(/입금\s*[\d,]+\s*원?\s+([가-힣a-zA-Z0-9]{2,})/);
    if (p1) name = p1[1];
  }
  if (!amount) {
    const amountMatch = cleaned.match(/([\d,]+)\s*원/);
    if (amountMatch) amount = parseInt(amountMatch[1].replace(/,/g, ""), 10) || 0;
  }
  // 최후 수단: 한글 이름 추출
  if (!name) {
    const exclude = ["신한", "은행", "입금", "출금", "잔액", "국민", "우리", "하나", "농협", "기업", "발신"];
    const names = cleaned.match(/[가-힣]{2,4}/g) || [];
    name = names.find((n) => !exclude.some((ex) => n.includes(ex))) || "";
  }

  if (!name) return null;
  return { name, amount };
}

function normalize(s: string): string {
  return s.replace(/[\s\-()]/g, "").toLowerCase();
}

export async function POST(request: NextRequest) {
  // Bearer 토큰 인증
  if (WEBHOOK_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => null);
  const smsText = body?.text || body?.message || "";

  if (!smsText) {
    return NextResponse.json({ error: "text 필수" }, { status: 400 });
  }

  const parsed = parseShinhanSms(smsText);
  if (!parsed) {
    return NextResponse.json({ error: "파싱 실패", raw: smsText }, { status: 400 });
  }

  // 방어: 파싱된 이름이 너무 길거나 특수문자만 있으면 거부 (MacroDroid 치환 실패 케이스)
  if (!parsed.name || parsed.name.length > 10 || /[{}\[\]]/.test(parsed.name)) {
    return NextResponse.json({ error: "파싱된 이름 형식 오류", parsed, raw: smsText }, { status: 400 });
  }
  // 금액 0이면 매칭 진행 X (잘못된 케이스)
  if (parsed.amount <= 0) {
    return NextResponse.json({ error: "금액 0 — 파싱 오류 의심", parsed, raw: smsText }, { status: 400 });
  }

  const sb = getServiceClient();

  // pending 주문 조회
  const { data: orders } = await sb
    .from("orders")
    .select("id, store_id, cafe24_order_id, buyer_name, receiver_name, order_amount, payment_amount, product_name")
    .eq("shipping_status", "pending")
    .order("order_date", { ascending: false })
    .limit(500);

  if (!orders || orders.length === 0) {
    return NextResponse.json({
      parsed,
      matched: 0,
      message: "대기 주문 없음",
    });
  }

  // 1순위: payment_amount(고유 입금액)로 정확 매칭 — 동명이인 관계없이 금액만으로 유일 매칭
  let matched: typeof orders = [];
  if (parsed.amount > 0) {
    const byPaymentAmount = orders.filter((o) => (o.payment_amount || o.order_amount) === parsed.amount);
    if (byPaymentAmount.length === 1) {
      matched = byPaymentAmount;
    }
  }

  // 2순위: 이름 + 금액 매칭
  if (matched.length === 0) {
    const depName = normalize(parsed.name);
    const nameMatched = orders.filter((o) => {
      const bn = normalize(o.buyer_name || "");
      const rn = normalize(o.receiver_name || "");
      // 빈 문자열이 includes() 로 전부 매칭되는 버그 방지 — 최소 2자 이상 필요
      if (depName.length < 2) return false;
      if (bn === depName || rn === depName) return true;
      if (bn.length >= 2 && (bn.includes(depName) || depName.includes(bn))) return true;
      if (rn.length >= 2 && (rn.includes(depName) || depName.includes(rn))) return true;
      return false;
    });

    if (nameMatched.length > 1 && parsed.amount > 0) {
      const exactAmount = nameMatched.filter((o) => (o.payment_amount || o.order_amount) === parsed.amount);
      matched = exactAmount.length > 0 ? exactAmount : nameMatched;
    } else {
      matched = nameMatched;
    }
  }

  if (matched.length === 0) {
    // 매칭 실패 로그 저장
    await sb.from("payment_logs").insert({
      depositor_name: parsed.name,
      amount: parsed.amount,
      sms_text: smsText,
      status: "unmatched",
      matched_order_ids: [],
    });

    return NextResponse.json({
      parsed,
      matched: 0,
      message: `"${parsed.name}" 매칭 주문 없음`,
    });
  }

  // 입금확인 처리
  const matchedIds = matched.map((o) => o.id);
  const now = new Date().toISOString();

  await sb
    .from("orders")
    .update({
      shipping_status: "ordered",
      memo: `[${now.slice(0, 16).replace("T", " ")}] 입금확인 자동 (${parsed.name} ₩${parsed.amount.toLocaleString()})`,
    })
    .in("id", matchedIds)
    .eq("shipping_status", "pending");

  // 카페24 상태 전환
  let cafe24Success = 0;
  let cafe24Failed = 0;
  const stores = await getActiveStores();
  const storeMap = Object.fromEntries(stores.map((s) => [s.id, s]));

  for (const order of matched) {
    const store = storeMap[order.store_id];
    if (!store || !order.cafe24_order_id) continue;
    // 수기(EXCEL-)·전화(PT-) 주문은 카페24에 존재하지 않으므로 skip
    if (order.cafe24_order_id.startsWith("EXCEL-") || order.cafe24_order_id.startsWith("PT-")) continue;

    try {
      const res = await cafe24Fetch(store, `/orders/${order.cafe24_order_id}`, {
        method: "PUT",
        body: JSON.stringify({ request: { process_status: "prepare" } }),
      });
      if (res.ok) cafe24Success++;
      else cafe24Failed++;
    } catch {
      cafe24Failed++;
    }
  }

  // 동명이인 여부
  const isDuplicate = matched.length > 1;

  // 이력 저장
  await sb.from("payment_logs").insert({
    depositor_name: parsed.name,
    amount: parsed.amount,
    sms_text: smsText,
    status: isDuplicate ? "confirmed_with_amount" : "confirmed",
    matched_order_ids: matchedIds,
    cafe24_synced: cafe24Success,
    confirmed_at: now,
  });

  return NextResponse.json({
    parsed,
    matched: matched.length,
    name_matched_total: matched.length,
    amount_filtered: isDuplicate,
    confirmed: matchedIds.length,
    cafe24: { success: cafe24Success, failed: cafe24Failed },
    orders: matched.map((o) => ({
      id: o.id,
      cafe24_order_id: o.cafe24_order_id,
      buyer_name: o.buyer_name,
      receiver_name: o.receiver_name,
      product_name: o.product_name,
      amount: o.order_amount,
    })),
  });
}
