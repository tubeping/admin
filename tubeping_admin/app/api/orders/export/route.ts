import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/orders/export — 판매사별 송장 엑셀 다운로드
 * ?store_id=xxx — 특정 판매사
 * ?format=acts — ACTs 양식 (상품주문번호 기준)
 * ?format=default — 기본 양식
 * ?tracking_only=true — 송장 입력된 건만
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const storeId = searchParams.get("store_id");
  const format = searchParams.get("format") || "default";
  const trackingOnly = searchParams.get("tracking_only") === "true";

  const sb = getServiceClient();

  let query = sb
    .from("orders")
    .select("*, stores:store_id(name, mall_id)")
    .order("order_date", { ascending: false });

  if (storeId) query = query.eq("store_id", storeId);
  if (trackingOnly) {
    query = query.not("tracking_number", "is", null).neq("tracking_number", "");
  }

  const { data: orders, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: "다운로드할 주문이 없습니다" }, { status: 404 });
  }

  const BOM = "\uFEFF";
  let csv = "";
  let filename = "";

  if (format === "acts") {
    // ACTs 양식 — 상품주문번호 기준으로 택배사/송장번호
    const header = "상품주문번호,주문번호,상품명,옵션정보,주문수량,수취인명,연락처,우편번호,배송지,택배사,송장번호";
    const rows = orders.map((o) => [
      o.cafe24_order_item_code || o.cafe24_order_id,
      o.cafe24_order_id,
      `"${(o.product_name || "").replace(/"/g, '""')}"`,
      `"${(o.option_text || "").replace(/"/g, '""')}"`,
      o.quantity,
      o.receiver_name,
      o.receiver_phone,
      o.receiver_zipcode,
      `"${(o.receiver_address || "").replace(/"/g, '""')}"`,
      o.shipping_company || "",
      o.tracking_number || "",
    ].join(","));

    csv = BOM + header + "\n" + rows.join("\n");
    const storeName = orders[0]?.stores?.name || "acts";
    filename = `송장_${storeName}_${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    // 기본 양식
    const header = "주문번호,주문일,판매사,상품명,옵션,수량,금액,주문자,수령자,연락처,주소,우편번호,공급사,택배사,송장번호,상태";
    const rows = orders.map((o) => [
      o.cafe24_order_id,
      o.order_date?.slice(0, 10),
      o.stores?.name || "",
      `"${(o.product_name || "").replace(/"/g, '""')}"`,
      `"${(o.option_text || "").replace(/"/g, '""')}"`,
      o.quantity,
      o.order_amount,
      o.buyer_name,
      o.receiver_name,
      o.receiver_phone,
      `"${(o.receiver_address || "").replace(/"/g, '""')}"`,
      o.receiver_zipcode,
      "",
      o.shipping_company || "",
      o.tracking_number || "",
      o.shipping_status,
    ].join(","));

    csv = BOM + header + "\n" + rows.join("\n");
    const storeName = orders[0]?.stores?.name || "전체";
    filename = `주문_${storeName}_${new Date().toISOString().slice(0, 10)}.csv`;
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
