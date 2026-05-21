import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";

/**
 * POST /api/orders/reassign — 기존 주문의 supplier_id를 리셋하고 재배정
 *
 * body: { days?: number, force?: boolean }
 *   - days: 최근 N일 주문만 대상 (기본 30)
 *   - force: true면 manual 수정도 리셋 (기본 false — 수동 수정 보호)
 *
 * 제외 조건:
 *   - purchase_order_id가 이미 있는 주문 (발주서 생성된 건은 유지)
 *   - auto_assign_status="manual"인 주문 (수동 수정 보호, force=true면 무시)
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const days = Number(body.days || 30);
  const force = !!body.force;

  const sb = getServiceClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // 발주서 없는 주문만 리셋 (manual 수정은 force=true일 때만)
  let resetQuery = sb
    .from("orders")
    .update({ supplier_id: null, auto_assign_status: null })
    .gte("order_date", since)
    .is("purchase_order_id", null)
    .neq("shipping_status", "cancelled");
  if (!force) {
    resetQuery = resetQuery.or("auto_assign_status.is.null,auto_assign_status.neq.manual");
  }
  const { data: resetRows, error: resetErr } = await resetQuery.select("id");

  if (resetErr) {
    return NextResponse.json({ error: `reset 실패: ${resetErr.message}` }, { status: 500 });
  }

  const result = await autoAssignSuppliers(sb);

  return NextResponse.json({
    reset: resetRows?.length || 0,
    ...result,
  });
}
