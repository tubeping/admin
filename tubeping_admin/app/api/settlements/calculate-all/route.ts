import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/settlements/calculate-all
 * 모든 활성 판매사에 대해 정산서 일괄 생성
 * body: { period, include_no_tracking?, cutoff_date? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { period, include_no_tracking = true, date_basis = "order_date", start_date, end_date } = body;

  if (!period) {
    return NextResponse.json({ error: "period 필수" }, { status: 400 });
  }

  const sb = getServiceClient();

  // 활성 스토어 중 해당 기간에 주문이 있는 스토어만
  const { data: stores } = await sb
    .from("stores")
    .select("id, name")
    .eq("status", "active");

  if (!stores || stores.length === 0) {
    return NextResponse.json({ error: "활성 판매사가 없습니다" }, { status: 400 });
  }

  const [year, month] = period.split("-").map(Number);
  const startDate = `${period}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${period}-${String(lastDay).padStart(2, "0")}`;

  const results: { store_name: string; status: string; error?: string }[] = [];

  for (const store of stores) {
    // 해당 기간에 주문이 있는지 확인
    const dateField = date_basis === "shipped_at" ? "shipped_at" : "order_date";
    const { count } = await sb
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .gte(dateField, start_date || startDate)
      .lte(dateField, (end_date || endDate) + "T23:59:59");

    if (!count || count === 0) {
      results.push({ store_name: store.name, status: "skipped", error: "주문 없음" });
      continue;
    }

    // 개별 정산 API 호출 (내부에서 직접 fetch하지 않고 같은 로직 사용)
    try {
      const calcRes = await fetch(
        new URL("/admin/api/settlements/calculate", request.url).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store_id: store.id,
            period,
            include_no_tracking,
            date_basis,
            start_date,
            end_date,
          }),
        }
      );
      const calcData = await calcRes.json();
      if (calcRes.ok) {
        results.push({ store_name: store.name, status: "created" });
      } else {
        results.push({ store_name: store.name, status: "error", error: calcData.error });
      }
    } catch (e) {
      results.push({ store_name: store.name, status: "error", error: String(e) });
    }
  }

  return NextResponse.json({
    total: stores.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
}
