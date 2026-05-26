import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { generateOrderCsv, enrichWithTpCode, POConfig } from "@/lib/purchaseOrderCsv";

/**
 * GET /api/purchase-orders/download?id=xxx&type=po|shipment
 * type=po       → 공급사에 보낸 발주 CSV 재생성 다운로드
 * type=shipment → 공급사가 회신한 송장 정보 CSV 다운로드
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const type = searchParams.get("type") || "po";

  if (!id) {
    return NextResponse.json({ error: "id 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 발주서 조회
  const { data: po, error: poErr } = await sb
    .from("purchase_orders")
    .select("*, suppliers:supplier_id(name, email, po_config)")
    .eq("id", id)
    .single();

  if (poErr || !po) {
    return NextResponse.json({ error: "발주서를 찾을 수 없습니다" }, { status: 404 });
  }

  // Legacy PO인 경우 po_legacy_items에서 조회
  if (po.source === "legacy") {
    const { data: legacyItems } = await sb
      .from("po_legacy_items")
      .select("*")
      .eq("purchase_order_id", po.id)
      .order("created_at", { ascending: true });

    if (!legacyItems || legacyItems.length === 0) {
      return NextResponse.json({ error: "주문 데이터가 없습니다" }, { status: 404 });
    }

    const BOM = "\uFEFF";
    const header = "상품코드,주문상품고유번호,주문번호,주문일,상품명,옵션,수량,주문자,주문자연락처,수령인,수령인연락처,우편번호,주소,배송메시지,택배사,송장번호";
    const rows = legacyItems.map((o) => [
      o.product_code || "", o.order_item_no || "", o.order_number || "", o.order_date || "",
      csvEscape(o.product_name || ""), csvEscape(o.option_name || ""), String(o.quantity || 1),
      o.buyer_name || "", o.buyer_phone || "", o.receiver_name || "", o.receiver_phone || "",
      o.receiver_zipcode || "", csvEscape(o.receiver_address || ""), csvEscape(o.delivery_memo || ""),
      o.shipping_company || "", o.tracking_number || "",
    ].join(","));

    const csv = BOM + header + "\n" + rows.join("\n");
    const filename = `발주서_${po.po_number}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  }

  // 주문 목록 조회 (tubeping PO)
  const { data: orders } = await sb
    .from("orders")
    .select(
      "store_id, cafe24_order_id, cafe24_order_item_code, cafe24_product_no, product_name, option_text, quantity, order_date, buyer_name, buyer_phone, receiver_name, receiver_phone, receiver_address, receiver_zipcode, memo, shipping_company, tracking_number"
    )
    .eq("purchase_order_id", po.id)
    .order("cafe24_order_id", { ascending: true });

  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: "주문 데이터가 없습니다" }, { status: 404 });
  }

  const poConfig: POConfig | null = po.suppliers?.po_config || null;

  if (type === "shipment") {
    const BOM = "\uFEFF";
    const header = "주문번호,주문상품고유번호,상품명,옵션,수량,수령자,택배사,송장번호";
    const rows = orders.map((o) => {
      const cols = [
        o.cafe24_order_id || "",
        o.cafe24_order_item_code || "",
        csvEscape(o.product_name || ""),
        csvEscape(o.option_text || ""),
        String(o.quantity || 1),
        o.receiver_name || "",
        o.shipping_company || "",
        o.tracking_number || "",
      ];
      return cols.join(",");
    });
    const csv = BOM + header + "\n" + rows.join("\n");
    const filename = `송장정보_${po.po_number}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  }

  const enriched = await enrichWithTpCode(sb, orders);
  const csv = generateOrderCsv(enriched, poConfig);
  const filename = `발주서_${po.po_number}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
