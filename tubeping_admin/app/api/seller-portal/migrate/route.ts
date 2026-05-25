import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { randomBytes } from "crypto";

// POST: view_token 생성 + sales_channel 일괄 수정
export async function POST() {
  const sb = getServiceClient();
  const results: string[] = [];

  // 1. view_token이 null인 클라이언트에 토큰 생성
  const { data: clients, error: fetchErr } = await sb
    .from("phone_order_clients")
    .select("id")
    .is("view_token", null);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  let tokenUpdated = 0;
  if (clients && clients.length > 0) {
    for (const client of clients) {
      const token = randomBytes(4).toString("hex");
      const { error } = await sb
        .from("phone_order_clients")
        .update({ view_token: token })
        .eq("id", client.id);
      if (!error) tokenUpdated++;
    }
  }
  results.push(`view_token: ${tokenUpdated}개 생성`);

  // 2. 이전에 sample로 잘못 분류된 주문 → phone으로 수정
  const { data: misclassified } = await sb
    .from("orders")
    .select("id, cafe24_order_id")
    .eq("sales_channel", "sample")
    .limit(5000);

  if (misclassified) {
    const fixIds = misclassified.filter((o) => {
      const oid = o.cafe24_order_id || "";
      return /^\d{8}\(\d+\)/.test(oid); // 20260519(2)-4 형태
    }).map((o) => o.id);

    if (fixIds.length > 0) {
      await sb.from("orders").update({ sales_channel: "phone" }).in("id", fixIds);
      results.push(`sample→phone 재분류: ${fixIds.length}건`);
    }
  }

  // 3. sales_channel 일괄 수정 (null인 주문들 대상)
  const { data: orders } = await sb
    .from("orders")
    .select("id, cafe24_order_id, sales_channel")
    .is("sales_channel", null)
    .limit(5000);

  let phoneCount = 0;
  let sampleCount = 0;
  let manualCount = 0;

  if (orders) {
    const phoneIds: string[] = [];
    const sampleIds: string[] = [];
    const manualIds: string[] = [];

    for (const o of orders) {
      const oid = o.cafe24_order_id || "";
      if (/^PT-/.test(oid)) {
        phoneIds.push(o.id);
      } else if (/^MR-/.test(oid)) {
        manualIds.push(o.id);
      } else if (/^EXCEL-/.test(oid)) {
        manualIds.push(o.id);
      } else if (/^\d{8}-\d{5,}$/.test(oid)) {
        // YYYYMMDD-0000027 (7자리+) 형태는 자사몰이므로 null 유지
      } else if (/^\d{8}/.test(oid)) {
        // 그 외 날짜로 시작 (20260424-4, 20260519(2)-4 등) → 전화
        phoneIds.push(o.id);
      }
    }

    if (phoneIds.length > 0) {
      const { error } = await sb.from("orders").update({ sales_channel: "phone" }).in("id", phoneIds);
      if (!error) phoneCount = phoneIds.length;
    }
    if (sampleIds.length > 0) {
      const { error } = await sb.from("orders").update({ sales_channel: "sample" }).in("id", sampleIds);
      if (!error) sampleCount = sampleIds.length;
    }
    if (manualIds.length > 0) {
      const { error } = await sb.from("orders").update({ sales_channel: "manual" }).in("id", manualIds);
      if (!error) manualCount = manualIds.length;
    }
  }

  results.push(`sales_channel 수정: phone=${phoneCount}, sample=${sampleCount}, manual=${manualCount}`);

  return NextResponse.json({ results });
}
