import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { env } from "@/lib/env.server";

const CRON_SECRET = env.CRON_SECRET;

/**
 * 뱅크다A 크롤러 → 자동 입금확인 API
 * POST body: { deposits: [{ datetime, depositor, amount, content }] }
 * Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deposits } = await request.json();
  if (!deposits?.length) {
    return NextResponse.json({ error: "deposits required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 미입금 전화주문 전체 조회
  const { data: unpaidOrders, error } = await sb
    .from("phone_orders")
    .select("id, order_number, depositor_name, recipient_name, total_amount, status")
    .eq("payment_status", "unpaid")
    .neq("status", "cancelled");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const matched: Array<{
    deposit: { datetime: string; depositor: string; amount: number };
    orders: Array<{ id: string; order_number: string; depositor_name: string }>;
  }> = [];
  const unmatched: Array<{ datetime: string; depositor: string; amount: number }> = [];
  const confirmedIds: string[] = [];
  const usedOrderIds = new Set<string>();

  for (const dep of deposits) {
    const depositorLower = (dep.depositor || "").toLowerCase().replace(/\s/g, "");
    if (depositorLower.length < 2) {
      unmatched.push(dep);
      continue;
    }

    const matchingOrders = (unpaidOrders || []).filter((o) => {
      if (usedOrderIds.has(o.id)) return false;
      const dn = (o.depositor_name || "").toLowerCase().replace(/\s/g, "");
      const rn = (o.recipient_name || "").toLowerCase().replace(/\s/g, "");
      if (!dn && !rn) return false;

      // 정확 매칭 우선
      if (dn === depositorLower || rn === depositorLower) return true;

      // 부분 매칭: 최소 2글자 이상이고 한쪽이 다른 쪽을 포함
      // 단, 양쪽 모두 3글자 이상일 때만 부분 매칭 허용 (2글자 부분매칭은 오탐 높음)
      const minLen = Math.min(dn.length, depositorLower.length);
      if (minLen >= 3 && dn.length >= 2 && depositorLower.includes(dn)) return true;
      if (minLen >= 3 && depositorLower.length >= 2 && dn.includes(depositorLower)) return true;
      if (minLen >= 3 && rn.length >= 2 && depositorLower.includes(rn)) return true;
      if (minLen >= 3 && depositorLower.length >= 2 && rn.includes(depositorLower)) return true;

      return false;
    });

    if (matchingOrders.length > 0) {
      matched.push({
        deposit: dep,
        orders: matchingOrders.map((o) => ({
          id: o.id,
          order_number: o.order_number,
          depositor_name: o.depositor_name,
        })),
      });
      for (const o of matchingOrders) {
        usedOrderIds.add(o.id);
        confirmedIds.push(o.id);
      }
    } else {
      unmatched.push(dep);
    }
  }

  // 매칭된 주문 일괄 입금확인 처리
  let confirmed = 0;
  if (confirmedIds.length > 0) {
    const { data, error: updateError } = await sb
      .from("phone_orders")
      .update({ payment_status: "paid", paid_at: new Date().toISOString() })
      .in("id", confirmedIds)
      .select("id");

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    confirmed = data?.length || 0;
  }

  return NextResponse.json({
    confirmed,
    matched,
    unmatched,
    total_deposits: deposits.length,
    total_unpaid_orders: unpaidOrders?.length || 0,
  });
}
