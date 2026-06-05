import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { env } from "@/lib/env.server";

/**
 * POST /api/orders/ocr-import — 파일에서 주문 데이터 추출 (OCR/문서 분석)
 *
 * FormData: image (File — 이미지/PDF/DOCX/XLSX/HWP/TXT 등)
 *
 * Gemini로 테이블/주문 정보를 읽어 JSON 배열로 반환.
 * 클라이언트에서 /api/orders/manual-register로 바로 등록.
 */

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
// 한글 이름·주소 정확도를 위해 Pro 사용 (Flash 는 장→정, 하→희 등 오인식이 잦음)
const MODEL = "gemini-2.5-pro";

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

[수량(quantity) — 매우 중요]
- 상품명에 포함된 무게/용량/규격 표기(2kg, 3kg, 500g, 1L, 10개입 등)는 '상품명의 일부'다.
  절대 수량(quantity)으로 해석하지 말 것. 예) "밤호박 3kg" → product_name="밤호박 3kg", quantity 아님.
- 별도의 '수량/개수/주문수량' 컬럼이 명시적으로 있을 때만 그 값을 quantity 로 쓴다.
- 수량 컬럼이 없으면 quantity 는 1 로 둔다.

[한글 이름·주소 — 매우 중요]
- 이름·주소의 한글은 추측·교정하지 말고, 픽셀에 보이는 글자 그대로 정확히 읽는다.
- 흔히 혼동되는 글자를 구별할 것: 장/정, 하/허/희, 얀/안/연, 은/을, 김/긴 등.
- 그럴듯한 흔한 이름으로 바꾸지 말 것. 보이는 그대로가 정답이다.

[기타]
- 연락처는 하이픈 포함 형식 (010-1234-5678)
- 금액은 숫자만 (₩, 원, 쉼표 제거)
- 주소는 보이는 그대로 전체 입력
- 옵션(색상, 사이즈 등)은 option_text에
- 이름 컬럼이 '성함/받는분/수령인/수취인'이면 receiver_name 에, '주문자/구매자'면 buyer_name 에. 구분이 없으면 receiver_name 에 넣는다. 연락처도 같은 기준.
- 확실하지 않은 필드는 null

JSON으로만 응답. 설명 금지.`;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const image = formData.get("image") as File | null;

  if (!image) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
  }

  const validTypes = [
    "image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif",
    "application/pdf",
    "text/plain", "text/html", "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  // docx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",        // xlsx
    "application/msword",                                                        // doc
    "application/vnd.ms-excel",                                                  // xls
    "application/haansofthwp",                                                   // hwp
    "application/x-hwp",                                                         // hwp (alt)
  ];
  // MIME이 없거나 알 수 없는 경우 확장자로 판단
  const ext = image.name?.split(".").pop()?.toLowerCase() || "";
  const extAllowed = ["png","jpg","jpeg","webp","gif","heic","heif","pdf","txt","html","csv","doc","docx","xls","xlsx","hwp","hwpx"];
  if (!validTypes.includes(image.type) && !extAllowed.includes(ext)) {
    return NextResponse.json({ error: `지원하지 않는 파일 형식입니다 (${image.type || ext})` }, { status: 400 });
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
        temperature: 0,
        maxOutputTokens: 8192,
      },
      systemInstruction: SYSTEM,
    });

    const mimeType = image.type || (ext === "pdf" ? "application/pdf" : ext === "hwp" ? "application/haansofthwp" : "application/octet-stream");
    const result = await model.generateContent([
      { inlineData: { mimeType, data: base64 } },
      "이 파일에서 주문 데이터를 추출해주세요.",
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
