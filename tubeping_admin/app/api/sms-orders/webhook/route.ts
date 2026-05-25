import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { env } from "@/lib/env.server";

/**
 * POST /api/sms-orders/webhook
 * 안드로이드 폰에서 통화매니저로 전달받은 SMS를 수신하고 파싱
 *
 * body: {
 *   sender_phone: string,    // 원래 발신자 (고객)
 *   receiver_phone?: string, // 수신번호 (070-7706-7778)
 *   message: string,         // 통화매니저가 전달한 전체 텍스트
 *   received_at?: string,    // 수신 시각
 * }
 *
 * Authorization: Bearer <WEBHOOK_SECRET>
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret = env.WEBHOOK_SECRET || env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { sender_phone, receiver_phone, message, received_at } = body as {
    sender_phone?: string;
    receiver_phone?: string;
    message?: string;
    received_at?: string;
  };

  if (!message) {
    return NextResponse.json({ error: "message 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 1. 원본 메시지 저장
  const { data: rawMsg, error: insertErr } = await sb
    .from("sms_raw_messages")
    .insert({
      sender_phone: sender_phone || "unknown",
      receiver_phone: receiver_phone || "070-7706-7778",
      raw_text: message,
      forwarded_text: message,
      received_at: received_at || new Date().toISOString(),
      parse_status: "pending",
    })
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // 2. 통화매니저 포맷에서 실제 발신번호와 메시지 본문 추출
  // 포맷: "[통화매니저]01073736734에서 07077067778로 발송한 문자입니다.\n\n{실제내용}"
  let actualSender = sender_phone || "";
  let actualMessage = message;

  const callManagerMatch = message.match(
    /\[통화매니저\]\s*(\d+)\s*에서\s*(\d+)\s*로\s*발송한\s*문자입니다\.\s*\n*([\s\S]*)/
  );
  if (callManagerMatch) {
    actualSender = callManagerMatch[1]; // 고객 전화번호
    actualMessage = callManagerMatch[3].trim(); // 실제 주문 내용
  }

  // 전화번호 포맷팅
  actualSender = formatPhone(actualSender);

  // 3. SMS 내용 파싱하여 주문 정보 추출
  const parsed = parseSmsToOrder(actualMessage, actualSender);

  // 4. 파싱 결과 저장
  await sb
    .from("sms_raw_messages")
    .update({
      sender_phone: actualSender || sender_phone || "unknown",
      parse_status: parsed ? "parsed" : "failed",
      parsed_at: new Date().toISOString(),
      parse_result: parsed,
    })
    .eq("id", rawMsg.id);

  // 5. 파싱 성공 시 sms_orders에 자동 등록
  if (parsed) {
    const dt = new Date().toISOString().slice(0, 10);
    const { data: numData } = await sb.rpc("generate_sms_order_number", { order_dt: dt });
    const orderNumber = numData || `SMS-${dt.replace(/-/g, "")}-001`;

    const { data: order, error: orderErr } = await sb
      .from("sms_orders")
      .insert({
        order_number: orderNumber,
        raw_message_id: rawMsg.id,
        order_date: dt,
        product_name: parsed.product_name || "(확인필요)",
        option_text: parsed.option_text || null,
        quantity: parsed.quantity || 1,
        orderer_name: parsed.orderer_name || null,
        orderer_phone: actualSender || null,
        depositor_name: parsed.depositor_name || null,
        recipient_name: parsed.recipient_name || "(확인필요)",
        recipient_phone: parsed.recipient_phone || actualSender || null,
        recipient_zipcode: parsed.recipient_zipcode || null,
        recipient_address: parsed.recipient_address || null,
        delivery_message: parsed.delivery_message || null,
        parse_confidence: parsed.confidence || "low",
        needs_review: true,
        memo: parsed.memo || null,
      })
      .select("id")
      .single();

    if (!orderErr && order) {
      await sb
        .from("sms_raw_messages")
        .update({ sms_order_id: order.id })
        .eq("id", rawMsg.id);

      return NextResponse.json({
        success: true,
        raw_message_id: rawMsg.id,
        sms_order_id: order.id,
        order_number: orderNumber,
        parsed,
      }, { status: 201 });
    }
  }

  return NextResponse.json({
    success: true,
    raw_message_id: rawMsg.id,
    sms_order_id: null,
    parsed: parsed || null,
    parse_status: parsed ? "parsed" : "failed",
  }, { status: 201 });
}

/**
 * GET /api/sms-orders/webhook
 * 원본 수신 문자 목록 조회
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);

  const sb = getServiceClient();
  let query = sb
    .from("sms_raw_messages")
    .select("*", { count: "exact" })
    .order("received_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("parse_status", status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data, total: count });
}

// ============================================================
// SMS 파싱 로직
// ============================================================

interface ParsedOrder {
  orderer_name?: string;
  recipient_name?: string;
  recipient_phone?: string;
  recipient_address?: string;
  recipient_zipcode?: string;
  product_name?: string;
  option_text?: string;
  quantity?: number;
  depositor_name?: string;
  delivery_message?: string;
  memo?: string;
  confidence: "low" | "medium" | "high";
}

function parseSmsToOrder(text: string, senderPhone: string): ParsedOrder | null {
  if (!text || text.trim().length < 5) return null;

  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  const result: ParsedOrder = { confidence: "low" };
  let fieldsFound = 0;

  // 라인별 "키: 값" 패턴을 파싱하는 맵 생성
  const kvMap: Record<string, string> = {};
  for (const line of lines) {
    const kvMatch = line.match(/^([가-힣a-zA-Z\s]{1,10})\s*[:\-]\s*(.+)$/);
    if (kvMatch) {
      kvMap[kvMatch[1].replace(/\s/g, "")] = kvMatch[2].trim();
    }
  }

  // --- 이름 추출 (라인별 키:값 우선) ---
  const ordererKeys = ["주문자", "주문자명", "보내는분"];
  for (const k of ordererKeys) {
    if (kvMap[k]) { result.orderer_name = kvMap[k].match(/^([가-힣]{2,4})/)?.[1] || kvMap[k]; fieldsFound++; break; }
  }

  const recipientKeys = ["수령인", "받는분", "수취인", "배송지이름", "수령인명"];
  for (const k of recipientKeys) {
    if (kvMap[k]) { result.recipient_name = kvMap[k].match(/^([가-힣]{2,4})/)?.[1] || kvMap[k]; fieldsFound++; break; }
  }

  const depositorKeys = ["입금자", "입금자명"];
  for (const k of depositorKeys) {
    if (kvMap[k]) { result.depositor_name = kvMap[k].match(/^([가-힣]{2,4})/)?.[1] || kvMap[k]; fieldsFound++; break; }
  }

  // --- 전화번호 추출 ---
  const phoneKeys = ["연락처", "전화", "전화번호", "핸드폰", "휴대폰", "HP", "TEL"];
  for (const k of phoneKeys) {
    if (kvMap[k]) {
      const ph = kvMap[k].match(/01[016789][\s\-]?\d{3,4}[\s\-]?\d{4}/);
      if (ph) { result.recipient_phone = formatPhone(ph[0]); fieldsFound++; break; }
    }
  }
  // 전화번호가 텍스트에 독립적으로 있는 경우
  if (!result.recipient_phone) {
    for (const line of lines) {
      const ph = line.match(/^(01[016789][\s\-]?\d{3,4}[\s\-]?\d{4})$/);
      if (ph) { result.recipient_phone = formatPhone(ph[1]); break; }
    }
  }

  // --- 주소 추출 ---
  const addrKeys = ["주소", "배송지", "배송주소"];
  for (const k of addrKeys) {
    if (kvMap[k]) { result.recipient_address = kvMap[k]; fieldsFound++; break; }
  }
  // 우편번호
  const zipKeys = ["우편번호", "zip"];
  for (const k of zipKeys) {
    if (kvMap[k]) { const z = kvMap[k].match(/(\d{5})/); if (z) { result.recipient_zipcode = z[1]; fieldsFound++; } break; }
  }
  // 주소 키워드 없이 시/도로 시작하는 줄
  if (!result.recipient_address) {
    for (const line of lines) {
      if (/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(line) && line.length > 8) {
        result.recipient_address = line;
        fieldsFound++;
        break;
      }
    }
  }

  // --- 상품명 추출 ---
  const productKeys = ["상품명", "상품", "품명", "주문상품", "제품", "제품명"];
  for (const k of productKeys) {
    if (kvMap[k]) { result.product_name = kvMap[k].slice(0, 100); fieldsFound++; break; }
  }

  // --- 수량 추출 ---
  const qtyKeys = ["수량"];
  for (const k of qtyKeys) {
    if (kvMap[k]) { const q = kvMap[k].match(/(\d+)/); if (q) { result.quantity = parseInt(q[1], 10); fieldsFound++; } break; }
  }

  // --- 옵션 추출 ---
  if (kvMap["옵션"]) { result.option_text = kvMap["옵션"]; fieldsFound++; }

  // --- 배송 메시지 ---
  const deliveryKeys = ["배송메시지", "배송메모", "요청사항", "배송요청", "메모"];
  for (const k of deliveryKeys) {
    if (kvMap[k]) { result.delivery_message = kvMap[k]; fieldsFound++; break; }
  }

  // --- 구조화되지 않은 짧은 문자 처리 ---
  if (fieldsFound < 3) {
    result.memo = `[원본] ${text.slice(0, 500)}`;
  }

  // 수령인이 없으면 주문자를 수령인으로
  if (!result.recipient_name && result.orderer_name) {
    result.recipient_name = result.orderer_name;
  }

  // 주문자도 수령인도 없는 경우 - 첫 줄에서 이름 추출
  if (!result.recipient_name) {
    const nameGuess = lines[0]?.match(/^([가-힣]{2,4})$/);
    if (nameGuess) {
      result.recipient_name = nameGuess[1];
      result.orderer_name = nameGuess[1];
    }
  }

  // 신뢰도 계산
  if (fieldsFound >= 5) result.confidence = "high";
  else if (fieldsFound >= 3) result.confidence = "medium";
  else result.confidence = "low";

  return result;
}

function formatPhone(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}
