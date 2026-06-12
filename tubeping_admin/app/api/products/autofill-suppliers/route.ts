import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { fillProductSuppliers } from "@/lib/fillProductSuppliers";

export const maxDuration = 120;

/**
 * POST /api/products/autofill-suppliers   body: { dryRun?: boolean }
 *
 * 공급사 비어있는 상품을 마스터 카탈로그·공급사 마스터에서 자동 도출해 채운다.
 * dryRun=true 면 계획만 반환(쓰기 없음). 기존 공급사 값은 절대 덮어쓰지 않는다.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dryRun = !!body.dryRun;
  const sb = getServiceClient();

  try {
    const r = await fillProductSuppliers(sb, { dryRun });
    const byMethod: Record<string, number> = {};
    for (const it of r.plan) byMethod[it.method] = (byMethod[it.method] || 0) + 1;
    const msg = dryRun
      ? `공급사 빈 상품 ${r.emptyCount}건 중 ${r.plan.length}건 도출 가능 (미적용). 미매칭 ${r.unmatched.length}건`
      : `공급사 빈 상품 ${r.emptyCount}건 중 ${r.applied}건 채움${r.failed ? `, 실패 ${r.failed}건` : ""}. 미매칭 ${r.unmatched.length}건은 수동 입력 필요`;
    return NextResponse.json({ success: true, message: msg, byMethod, ...r });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "공급사 자동채움 실패" },
      { status: 500 }
    );
  }
}
