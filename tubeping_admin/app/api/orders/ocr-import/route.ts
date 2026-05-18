import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { env } from "@/lib/env.server";

/**
 * POST /api/orders/ocr-import — 이미지(스크린샷)에서 주문 데이터 추출
 *
 * FormData: image (File — png/jpg/webp)
 *
 * Gemini Vision으로 테이블/주문 정보를 읽어 JSON 배열로 반환.
 * 클라이언트에서 확인 후 /api/orders/import 또는 /api/orders/phone-order로 등록.
 */

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
const MODEL = "gemini-2.5-flash";

const orderSchema = {
  type: SchemaType.OBJECT,
  properties: {
    orders: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          product_name: { type: SchemaType.STRING, description: "상품명" },
          option_text: { type: SchemaType.STRING, nullable: true, description: "옵션 (색상/사이즈 등)" },
          quantity: { type: SchemaType.NUMBER, description: "수량" },
          unit_price: { type: SchemaType.NUMBER, nullable: true, description: "단가" },
          order_amount: { type: SchemaType.NUMBER, nullable: true, description: "주문금액" },
          buyer_name: { type: SchemaType.STRING, nullable: true, description: "주문자명" },
          buyer_phone: { type: SchemaType.STRING, nullable: true, description: "주문자 연락처" },
          receiver_name: { type: SchemaType.STRING, nullable: true, description: "수령인명" },
          receiver_phone: { type: SchemaType.STRING, nullable: true, description: "수령인 연락처" },
          receiver_address: { type: SchemaType.STRING, nullable: true, description: "배송지 주소" },
          receiver_zipcode: { type: SchemaType.STRING, nullable: true, description: "우편번호" },
          memo: { type: SchemaType.STRING, nullable: true, description: "메모/비고" },
        },
        required: ["product_name", "quantity"],
      },
    },
  },
  required: ["orders"],
};

const SYSTEM = `당신은 한국 이커머스 주문 데이터 추출 전문가입니다.
이미지(스크린샷, 엑셀 캡처, 카카오톡 주문 메시지 등)에서 주문 정보를 읽어 JSON으로 변환합니다.

[규칙]
- 이미지에서 보이는 모든 주문 행을 추출
- 테이블 형태면 각 행이 1건
- 카카오톡/문자 메시지면 대화에서 주문 내용 파악
- 상품명과 수량은 필수, 나머지는 보이는 것만
- 연락처는 하이픈 포함 형식 (010-1234-5678)
- 금액은 숫자만 (₩, 원, 쉼표 제거)
- 주소는 보이는 그대로 전체 입력
- 옵션(색상, 사이즈 등)은 option_text에
- 확실하지 않은 필드는 null

JSON으로만 응답. 설명 금지.`;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const image = formData.get("image") as File | null;

  if (!image) {
    return NextResponse.json({ error: "이미지가 없습니다" }, { status: 400 });
  }

  const validTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!validTypes.includes(image.type)) {
    return NextResponse.json({ error: "png, jpg, webp, gif 이미지만 지원합니다" }, { status: 400 });
  }

  if (!env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY가 설정되지 않았습니다" }, { status: 500 });
  }

  try {
    const buffer = await image.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: orderSchema as never,
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
      systemInstruction: SYSTEM,
    });

    const result = await model.generateContent([
      { inlineData: { mimeType: image.type, data: base64 } },
      "이 이미지에서 주문 데이터를 추출해주세요.",
    ]);

    const raw = result.response.text();
    let parsed: { orders: Record<string, unknown>[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Gemini가 코드블록이나 불완전 JSON을 반환한 경우 정리 후 재시도
      const cleaned = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("[ocr-import] Invalid JSON from Gemini:", raw.slice(0, 500));
        return NextResponse.json({ error: "AI 응답을 파싱할 수 없습니다. 다른 이미지로 시도해 주세요." }, { status: 422 });
      }
    }

    return NextResponse.json({
      orders: parsed.orders || [],
      count: (parsed.orders || []).length,
    });
  } catch (e) {
    console.error("[ocr-import] Gemini error:", e);
    return NextResponse.json({ error: "이미지 분석 실패: " + (e as Error).message }, { status: 500 });
  }
}
