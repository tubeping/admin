import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env.server";
import { createClient } from "@supabase/supabase-js";

const CRON_SECRET = env.CRON_SECRET;

const CARRIER_MAP: Record<string, string> = {
  CJ대한통운: "kr.cjlogistics",
  한진택배: "kr.hanjin",
  한진: "kr.hanjin",
  롯데택배: "kr.lotte",
  롯데글로벌로지스: "kr.lotte",
  우체국택배: "kr.epost",
  로젠택배: "kr.logen",
  경동택배: "kr.kyungdong",
  대신택배: "kr.daesin",
};

async function checkDeliveryStatus(
  carrierCode: string,
  trackingNumber: string
): Promise<string | null> {
  const url = `https://apis.tracker.delivery/carriers/${carrierCode}/tracks/${trackingNumber}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json();
      return data?.state?.id ?? null;
    } catch {
      if (attempt === 0) continue;
      return null;
    }
  }
  return null;
}

/**
 * GET /api/cron/update-delivery-status — 배송상태 자동 업데이트
 * 택배 조회 API로 배송중인 주문의 실제 배송상태를 확인하고 업데이트
 * Vercel Cron으로 매일 오전 10시(KST) 실행
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 배송중 + 송장번호 있는 주문 조회
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, shipping_company, tracking_number")
    .eq("shipping_status", "shipping")
    .not("tracking_number", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let delivered = 0;
  let checked = 0;
  let errors = 0;
  let skipped = 0;

  for (const order of orders ?? []) {
    const carrierCode = CARRIER_MAP[order.shipping_company];
    if (!carrierCode) {
      skipped++;
      continue;
    }

    const status = await checkDeliveryStatus(
      carrierCode,
      order.tracking_number
    );
    checked++;

    if (status === "delivered") {
      const { error: updateError } = await supabase
        .from("orders")
        .update({ shipping_status: "delivered" })
        .eq("id", order.id);

      if (!updateError) {
        delivered++;
      } else {
        errors++;
      }
    } else if (status === null) {
      errors++;
    }

    // Rate limiting: 20건마다 2초 대기
    if (checked % 20 === 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return NextResponse.json({
    message: "배송상태 업데이트 완료",
    total: orders?.length ?? 0,
    checked,
    delivered,
    errors,
    skipped,
  });
}
