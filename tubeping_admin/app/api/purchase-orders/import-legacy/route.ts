import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import * as fs from "fs";
import * as path from "path";

/**
 * POST /api/purchase-orders/import-legacy
 * 발주모아 PO별정리 CSV를 읽어서 purchase_orders + po_legacy_items에 임포트
 */

interface CsvRow {
  po_number: string;
  order_date: string;
  supplier_name: string;
  product_code: string;
  order_item_no: string;
  order_number: string;
  item_order_date: string;
  product_name: string;
  option_name: string;
  quantity: string;
  buyer_name: string;
  buyer_phone: string;
  receiver_name: string;
  receiver_phone: string;
  zipcode: string;
  address: string;
  delivery_memo: string;
  shipping_company: string;
  tracking_number: string;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const csvPath =
    (body.csv_path as string) ||
    "/home/dev/OneDrive/신산애널리틱스/발주모아_2026_PO별정리.csv";

  if (!fs.existsSync(csvPath)) {
    return NextResponse.json({ error: `파일을 찾을 수 없습니다: ${csvPath}` }, { status: 400 });
  }

  const raw = fs.readFileSync(csvPath, "utf-8").replace(/^\uFEFF/, "");
  const lines = raw.split("\n").map((l) => l.replace(/\r$/, ""));

  // Skip header
  const dataLines = lines.slice(1).filter((l) => l.trim() && l.startsWith("PO-"));

  // Group by PO number
  const poGroups: Record<string, CsvRow[]> = {};
  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    if (cols.length < 3 || !cols[0].startsWith("PO-")) continue;

    const row: CsvRow = {
      po_number: cols[0] || "",
      order_date: cols[1] || "",
      supplier_name: cols[2] || "",
      product_code: cols[3] || "",
      order_item_no: cols[4] || "",
      order_number: cols[5] || "",
      item_order_date: cols[6] || "",
      product_name: cols[7] || "",
      option_name: cols[8] || "",
      quantity: cols[9] || "1",
      buyer_name: cols[10] || "",
      buyer_phone: cols[11] || "",
      receiver_name: cols[12] || "",
      receiver_phone: cols[13] || "",
      zipcode: cols[14] || "",
      address: cols[15] || "",
      delivery_memo: cols[16] || "",
      shipping_company: cols[17] || "",
      tracking_number: cols[18] || "",
    };

    if (!poGroups[row.po_number]) poGroups[row.po_number] = [];
    poGroups[row.po_number].push(row);
  }

  const sb = getServiceClient();

  // Check if already imported
  const poNumbers = Object.keys(poGroups);
  const { data: existingPOs } = await sb
    .from("purchase_orders")
    .select("po_number")
    .in("po_number", poNumbers.slice(0, 100)); // sample check

  const existingSet = new Set((existingPOs || []).map((p) => p.po_number));

  // Get or create supplier mapping
  const supplierNames = [...new Set(Object.values(poGroups).map((rows) => rows[0].supplier_name))];
  const { data: suppliers } = await sb.from("suppliers").select("id, name");
  const supplierMap: Record<string, string> = {};
  for (const s of suppliers || []) supplierMap[s.name] = s.id;

  // Create missing suppliers
  const missing = supplierNames.filter((n) => !supplierMap[n] && n);
  if (missing.length > 0) {
    const { data: created } = await sb
      .from("suppliers")
      .insert(missing.map((name) => ({ name, email: "", status: "active" })))
      .select("id, name");
    for (const s of created || []) supplierMap[s.name] = s.id;
  }

  let imported = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const [poNumber, rows] of Object.entries(poGroups)) {
    if (existingSet.has(poNumber)) {
      skipped++;
      continue;
    }

    const first = rows[0];
    const supplierId = supplierMap[first.supplier_name];
    if (!supplierId) {
      errors.push(`공급사 없음: ${first.supplier_name} (${poNumber})`);
      continue;
    }

    const totalItems = rows.reduce((sum, r) => sum + (parseInt(r.quantity) || 1), 0);

    // Create PO
    const { data: po, error: poErr } = await sb
      .from("purchase_orders")
      .insert({
        po_number: poNumber,
        supplier_id: supplierId,
        order_date: first.order_date,
        total_items: totalItems,
        total_amount: 0,
        status: "completed",
        source: "legacy",
        sent_at: first.order_date ? new Date(first.order_date).toISOString() : null,
        completed_at: first.order_date ? new Date(first.order_date).toISOString() : null,
      })
      .select("id")
      .single();

    if (poErr) {
      errors.push(`PO 생성 실패: ${poNumber} - ${poErr.message}`);
      continue;
    }

    // Create legacy items
    const items = rows.map((r) => ({
      purchase_order_id: po.id,
      product_code: r.product_code || null,
      order_item_no: r.order_item_no || null,
      order_number: r.order_number || null,
      order_date: r.item_order_date || null,
      product_name: r.product_name || null,
      option_name: r.option_name || null,
      quantity: parseInt(r.quantity) || 1,
      buyer_name: r.buyer_name || null,
      buyer_phone: r.buyer_phone || null,
      receiver_name: r.receiver_name || null,
      receiver_phone: r.receiver_phone || null,
      receiver_zipcode: r.zipcode || null,
      receiver_address: r.address || null,
      delivery_memo: r.delivery_memo || null,
      shipping_company: r.shipping_company || null,
      tracking_number: r.tracking_number || null,
    }));

    // Batch insert (max 100 per batch)
    for (let i = 0; i < items.length; i += 100) {
      const batch = items.slice(i, i + 100);
      const { error: itemErr } = await sb.from("po_legacy_items").insert(batch);
      if (itemErr) {
        errors.push(`아이템 생성 실패: ${poNumber} batch ${i} - ${itemErr.message}`);
      }
    }

    imported++;
  }

  return NextResponse.json({
    success: true,
    total_pos: poNumbers.length,
    imported,
    skipped,
    errors: errors.slice(0, 20),
    supplier_count: supplierNames.length,
  });
}
