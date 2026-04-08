import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/orders/import — 엑셀(CSV) 주문 등록 (폐쇄몰 등)
 * FormData: file (CSV), store_name (스토어명, 선택)
 *
 * CSV 컬럼 (유연 매칭):
 * 주문번호, 주문일, 상품명, 옵션, 수량, 단가, 주문금액,
 * 주문자, 수령자, 연락처, 배송지, 우편번호, 공급사
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File;
  const storeName = (formData.get("store_name") as string) || "엑셀등록";

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 엑셀 등록용 가상 스토어 확인/생성
  let { data: store } = await sb
    .from("stores")
    .select("id")
    .eq("name", storeName)
    .single();

  if (!store) {
    const { data: newStore } = await sb
      .from("stores")
      .insert({
        mall_id: "excel_" + Date.now(),
        name: storeName,
        status: "active",
      })
      .select("id")
      .single();
    store = newStore;
  }

  if (!store) {
    return NextResponse.json({ error: "스토어 생성 실패" }, { status: 500 });
  }

  const text = await file.text();
  const lines = text
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l);

  if (lines.length < 2) {
    return NextResponse.json({ error: "데이터가 없습니다" }, { status: 400 });
  }

  // 헤더 파싱
  const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const col: Record<string, number> = {};

  const aliases: Record<string, string[]> = {
    order_id: ["주문번호", "주문코드", "order_id"],
    order_date: ["주문일", "주문일시", "날짜", "date"],
    product_name: ["상품명", "상품", "product"],
    option_text: ["옵션", "option"],
    quantity: ["수량", "qty", "quantity"],
    price: ["단가", "상품단가", "price"],
    amount: ["금액", "주문금액", "총금액", "amount"],
    buyer_name: ["주문자", "주문자명", "buyer"],
    receiver_name: ["수령자", "수령자명", "받는분", "receiver"],
    receiver_phone: ["연락처", "수령자연락처", "전화번호", "phone"],
    receiver_address: ["배송지", "주소", "address"],
    receiver_zipcode: ["우편번호", "zipcode"],
    supplier: ["공급사", "공급사명", "supplier"],
  };

  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase();
    for (const [key, aliasList] of Object.entries(aliases)) {
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

  // 데이터 파싱 + 저장
  let imported = 0;
  const errors: { row: number; error: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.replace(/"/g, "").trim());

    const productName = cols[col.product_name] || "";
    if (!productName) {
      errors.push({ row: i + 1, error: "상품명 누락" });
      continue;
    }

    const orderId = cols[col.order_id] || `EXCEL-${Date.now()}-${i}`;
    const quantity = parseInt(cols[col.quantity] || "1", 10) || 1;
    const price = parseInt(cols[col.price] || "0", 10) || 0;
    const amount = parseInt(cols[col.amount] || "0", 10) || price * quantity;
    const supplierName = cols[col.supplier] || "";
    const supplierId = supMap[supplierName] || null;

    const row = {
      store_id: store.id,
      cafe24_order_id: orderId,
      cafe24_order_item_code: String(i),
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

    const { error } = await sb.from("orders").upsert(row, {
      onConflict: "store_id,cafe24_order_id,cafe24_order_item_code",
    });

    if (error) {
      errors.push({ row: i + 1, error: error.message });
    } else {
      imported++;
    }
  }

  return NextResponse.json({
    total: lines.length - 1,
    imported,
    errors: errors.length > 0 ? errors : undefined,
  });
}
