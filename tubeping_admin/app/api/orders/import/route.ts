import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import * as XLSX from "xlsx";

/**
 * POST /api/orders/import — 엑셀(xlsx/xls/csv) 주문 등록 (폐쇄몰 등)
 * FormData: file, store_name (스토어명, 선택)
 *
 * 컬럼 (유연 매칭):
 * 주문번호, 주문일, 상품명, 옵션, 수량, 단가, 주문금액,
 * 주문자, 수령자, 연락처, 배송지, 우편번호, 공급사
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File;
  const storeId = formData.get("store_id") as string | null;
  const storeName = formData.get("store_name") as string | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
  }
  if (!storeId && !storeName) {
    return NextResponse.json({ error: "판매사를 선택해주세요" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 판매사 결정: store_id 우선, 없으면 store_name으로 lookup, 없으면 가상 스토어 생성
  let store: { id: string } | null = null;
  if (storeId) {
    const { data } = await sb.from("stores").select("id").eq("id", storeId).single();
    store = data;
    if (!store) {
      return NextResponse.json({ error: "선택한 판매사를 찾을 수 없습니다" }, { status: 404 });
    }
  } else if (storeName) {
    const { data } = await sb.from("stores").select("id").eq("name", storeName).single();
    store = data;
    if (!store) {
      const { data: newStore } = await sb
        .from("stores")
        .insert({ mall_id: "manual_" + Date.now(), name: storeName, status: "active" })
        .select("id")
        .single();
      store = newStore;
    }
  }

  if (!store) {
    return NextResponse.json({ error: "스토어 확인 실패" }, { status: 500 });
  }

  // 파일 타입 감지: xlsx/xls는 바이너리 파싱, 그 외는 CSV
  const fileName = (file.name || "").toLowerCase();
  const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

  let rows: string[][] = [];

  if (isExcel) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) {
      return NextResponse.json({ error: "시트를 찾을 수 없습니다" }, { status: 400 });
    }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    rows = aoa
      .map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c).trim())))
      .filter((r) => r.some((c) => c !== ""));
  } else {
    const text = await file.text();
    const lines = text
      .replace(/^\uFEFF/, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);
    rows = lines.map((l) => l.split(",").map((c) => c.replace(/"/g, "").trim()));
  }

  if (rows.length < 2) {
    return NextResponse.json({ error: "데이터가 없습니다" }, { status: 400 });
  }

  // 헤더 파싱
  const header = rows[0];
  const col: Record<string, number> = {};

  // 순서 중요: 더 구체적인 alias가 위쪽에 있어야 includes 매칭에서 먼저 잡힘
  // (예: 상품주문번호가 주문번호보다 먼저 매칭되어야 함)
  const aliases: Record<string, string[]> = {
    order_item_id: ["상품주문번호", "주문상품번호", "item_order_id"],
    order_id: ["주문번호", "주문코드", "order_id"],
    order_date: ["결제완료일", "주문일", "주문일시", "날짜", "date"],
    product_name: ["상품명", "상품", "product"],
    option_text: ["옵션", "option"],
    quantity: ["주문수량", "수량", "qty", "quantity"],
    price: ["판매단가", "공급단가", "단가", "상품단가", "price"],
    amount: ["총결제금액", "결제금액", "주문금액", "총금액", "금액", "amount"],
    buyer_name: ["구매자명", "구매자", "주문자명", "주문자", "buyer"],
    receiver_name: ["수취인명", "수취인", "수령자명", "수령자", "받는분", "receiver"],
    receiver_phone: ["수취인연락처", "연락처", "수령자연락처", "전화번호", "phone"],
    receiver_address: ["배송지", "배송주소", "주소", "address"],
    receiver_zipcode: ["우편번호", "zipcode"],
    supplier: ["공급사명", "공급사", "supplier"],
  };

  for (let i = 0; i < header.length; i++) {
    const h = (header[i] || "").toLowerCase().replace(/\s+/g, "");
    for (const [key, aliasList] of Object.entries(aliases)) {
      if (col[key] !== undefined) continue; // 이미 매칭된 컬럼은 덮어쓰지 않음
      if (aliasList.some((a) => h.includes(a.toLowerCase()))) {
        col[key] = i;
        break;
      }
    }
  }

  if (col.product_name === undefined) {
    return NextResponse.json(
      { error: "필수 컬럼(상품명)을 찾을 수 없습니다. 헤더: " + header.join(", ") },
      { status: 400 }
    );
  }

  // 공급사 이름 → ID 매핑
  const { data: suppliers } = await sb.from("suppliers").select("id, name");
  const supMap: Record<string, string> = {};
  for (const s of suppliers || []) supMap[s.name] = s.id;

  // 기존 등록된 (cafe24_order_id, cafe24_order_item_code) 조합을 미리 조회해 중복 판정
  const { data: existing } = await sb
    .from("orders")
    .select("cafe24_order_id, cafe24_order_item_code")
    .eq("store_id", store.id);
  const existingKeys = new Set(
    (existing || []).map((e) => `${e.cafe24_order_id}::${e.cafe24_order_item_code}`)
  );

  // 데이터 파싱 + 저장
  let imported = 0;
  let skipped = 0;
  const errors: { row: number; error: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];

    const productName = cols[col.product_name] || "";
    if (!productName) {
      errors.push({ row: i + 1, error: "상품명 누락" });
      continue;
    }

    const itemOrderId = (cols[col.order_item_id] || "").toString().trim();
    const parentOrderId = (cols[col.order_id] || "").toString().trim();
    // 상품주문번호(line) 우선, 없으면 주문번호 사용, 그것도 없으면 fallback
    const lineKey = itemOrderId || parentOrderId || `EXCEL-${Date.now()}-${i}`;
    const orderId = parentOrderId || itemOrderId || `EXCEL-${Date.now()}-${i}`;

    // 중복 체크: (주문번호 AND 상품주문번호) 둘 다 일치하면 skip (재등록 없음)
    if (existingKeys.has(`${orderId}::${lineKey}`)) {
      skipped++;
      continue;
    }
    const quantity = parseInt(cols[col.quantity] || "1", 10) || 1;
    const price = parseInt((cols[col.price] || "0").replace(/,/g, ""), 10) || 0;
    const amount = parseInt((cols[col.amount] || "0").replace(/,/g, ""), 10) || price * quantity;
    const supplierName = cols[col.supplier] || "";
    const supplierId = supMap[supplierName] || null;

    const row = {
      store_id: store.id,
      cafe24_order_id: orderId,
      cafe24_order_item_code: lineKey,
      order_date: cols[col.order_date] || new Date().toISOString(),
      product_name: productName,
      option_text: cols[col.option_text] || "",
      quantity,
      product_price: price,
      order_amount: amount,
      buyer_name: cols[col.buyer_name] || "",
      receiver_name: cols[col.receiver_name] || "",
      receiver_phone: cols[col.receiver_phone] || "",
      receiver_address: cols[col.receiver_address] || "",
      receiver_zipcode: cols[col.receiver_zipcode] || "",
      supplier_id: supplierId,
      shipping_status: "pending",
    };

    const { error } = await sb.from("orders").insert(row);

    if (error) {
      errors.push({ row: i + 1, error: error.message });
    } else {
      imported++;
      existingKeys.add(`${orderId}::${lineKey}`); // 같은 파일 내 중복도 방지
    }
  }

  return NextResponse.json({
    total: rows.length - 1,
    imported,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
