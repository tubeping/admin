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
  const isSample = formData.get("is_sample") === "true";

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
  // 더 구체적인 alias가 먼저 와야 부분일치 시 우선 매칭됨
  const aliases: Record<string, string[]> = {
    order_item_id: ["상품주문번호", "주문상품번호", "주문상품고유번호", "item_order_id"],
    order_id: ["주문번호", "주문코드", "order_id"],
    order_date: ["결제완료일", "주문일자", "주문일시", "주문일", "결제일", "날짜", "date"],
    product_name: ["상품명", "품명", "제품명", "상품", "product"],
    option_text: ["상품옵션", "옵션정보", "옵션명", "옵션", "option"],
    quantity: ["주문수량", "구매수량", "수량", "qty", "quantity"],
    price: ["판매단가", "공급단가", "판매가", "단가", "상품단가", "price"],
    amount: ["총결제금액", "결제금액", "주문금액", "총금액", "금액", "amount"],
    // buyer/receiver는 반드시 receiver_* 가 먼저 매칭되어야 함 (substring 충돌 방지)
    receiver_phone: ["수령인연락처", "수령인휴대폰", "수령인전화", "수취인연락처", "수취인휴대폰", "수령자연락처", "받는분연락처", "배송연락처", "휴대폰번호", "핸드폰번호", "수취인전화", "연락처", "전화번호", "phone"],
    receiver_name: ["수령인명", "수령인", "수취인명", "수취인", "수령자명", "수령자", "받는분", "받으시는분", "수신인", "고객명", "receiver"],
    receiver_address: ["배송지주소", "배송주소", "수령지주소", "수령인주소", "수취인주소", "받는주소", "배송지", "주소", "address"],
    receiver_zipcode: ["배송우편번호", "수령인우편번호", "우편번호", "zipcode", "zip"],
    buyer_phone: ["구매자연락처", "주문자연락처", "구매자휴대폰", "주문자휴대폰", "buyer_phone"],
    buyer_name: ["구매자명", "구매자", "주문자명", "주문자", "buyer"],
    memo: ["배송메시지", "배송메세지", "배송요청사항", "배송요청사항", "요청사항", "배송시요청사항", "메모"],
    supplier: ["공급사명", "공급사", "supplier"],
    order_status: ["상태", "주문상태", "order_status", "status"],
  };

  // 1차: 정확 일치 (수령인연락처 → receiver_phone처럼 더 긴 단어가 우선)
  const headerNorm = header.map((h) => (h || "").toLowerCase().replace(/[\s\-_()]/g, ""));
  for (let i = 0; i < headerNorm.length; i++) {
    const h = headerNorm[i];
    for (const [key, aliasList] of Object.entries(aliases)) {
      if (col[key] !== undefined) continue;
      if (aliasList.some((a) => a.toLowerCase().replace(/[\s\-_()]/g, "") === h)) {
        col[key] = i;
        break;
      }
    }
  }
  // 2차: 부분 일치 (정확 일치로 못 잡은 컬럼 대상)
  for (let i = 0; i < headerNorm.length; i++) {
    const h = headerNorm[i];
    // 이 위치가 이미 다른 key에 점유됐으면 skip
    if (Object.values(col).includes(i)) continue;
    for (const [key, aliasList] of Object.entries(aliases)) {
      if (col[key] !== undefined) continue;
      if (aliasList.some((a) => h.includes(a.toLowerCase().replace(/[\s\-_()]/g, "")))) {
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

  // 상품명 → products.price fallback 맵 (엑셀에 가격 없는 경우 대비)
  const uniqueProductNames = [...new Set(
    rows.slice(1).map((r) => r[col.product_name] || "").filter(Boolean)
  )];
  const nameToPrice: Record<string, number> = {};
  if (uniqueProductNames.length > 0) {
    const { data: productsForPrice } = await sb
      .from("products")
      .select("product_name, price")
      .in("product_name", uniqueProductNames);
    for (const p of productsForPrice || []) {
      if (p.product_name && p.price) nameToPrice[p.product_name.trim()] = p.price;
    }
  }

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
    // 엑셀에 가격이 없거나 0이면 products.price로 fallback
    let price = parseInt((cols[col.price] || "0").replace(/,/g, ""), 10) || 0;
    if (price === 0) {
      const fallbackPrice = nameToPrice[productName.trim()];
      if (fallbackPrice) price = fallbackPrice;
    }
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
      buyer_phone: cols[col.buyer_phone] || "",
      receiver_name: cols[col.receiver_name] || "",
      receiver_phone: cols[col.receiver_phone] || "",
      receiver_address: cols[col.receiver_address] || "",
      receiver_zipcode: cols[col.receiver_zipcode] || "",
      memo: cols[col.memo] || "",
      supplier_id: supplierId,
      shipping_status: (() => {
        const rawStatus = (cols[col.order_status] || "").trim();
        // 엑셀 상태값 → 내부 상태 매핑
        if (rawStatus.includes("취소") || rawStatus.includes("환불")) return "cancelled";
        if (rawStatus.includes("배송완료") || rawStatus.includes("배송 완료")) return "delivered";
        if (rawStatus.includes("배송중") || rawStatus.includes("출고완료")) return "shipping";
        if (rawStatus.includes("결제완료") || rawStatus.includes("출고") || rawStatus.includes("주문") || rawStatus.includes("준비")) return "ordered";
        if (rawStatus.includes("입금") || rawStatus.includes("대기")) return "pending";
        // 상태 컬럼 없으면: 수기/전화/ACTs 등 외부 플랫폼은 이미 결제완료 상태로 오므로 ordered
        return "ordered";
      })(),
      is_sample: isSample,
    };

    const { data: inserted, error } = await sb.from("orders").insert(row).select("id, order_amount").single();

    if (error) {
      errors.push({ row: i + 1, error: error.message });
    } else {
      imported++;
      existingKeys.add(`${orderId}::${lineKey}`);

      // 고유 입금액 부여 (전화/수기주문만 — 동명이인 구분용)
      // 같은 금액의 pending 주문이 있으면 끝자리 +1~+9
      if (inserted) {
        const baseAmount = inserted.order_amount || 0;
        const { data: sameAmount } = await sb
          .from("orders")
          .select("payment_amount")
          .eq("shipping_status", "pending")
          .gte("payment_amount", baseAmount)
          .lte("payment_amount", baseAmount + 9)
          .neq("id", inserted.id);

        const usedOffsets = new Set(
          (sameAmount || []).map((o) => (o.payment_amount || 0) - baseAmount)
        );
        let offset = 0;
        for (let n = 0; n <= 9; n++) {
          if (!usedOffsets.has(n)) { offset = n; break; }
        }
        await sb
          .from("orders")
          .update({ payment_amount: baseAmount + offset })
          .eq("id", inserted.id);
      }
    }
  }

  // import 시 자동 공급사 배정은 제거됨 — 검증 탭에서만 매칭 처리
  // 디버깅: 어떤 헤더가 어떤 필드로 매칭됐는지 응답에 포함
  const matchedColumns: Record<string, string> = {};
  for (const [key, idx] of Object.entries(col)) {
    matchedColumns[key] = header[idx];
  }
  const unmatchedHeaders = header.filter((_, i) => !Object.values(col).includes(i));

  return NextResponse.json({
    total: rows.length - 1,
    imported,
    skipped,
    matched_columns: matchedColumns,
    unmatched_headers: unmatchedHeaders,
    errors: errors.length > 0 ? errors : undefined,
  });
}
