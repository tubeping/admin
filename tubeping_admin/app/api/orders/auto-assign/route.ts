import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { autoAssignSuppliers } from "@/lib/autoAssignSuppliers";

/**
 * POST /api/orders/auto-assign — 공급사 자동 배정
 * 매칭 로직은 lib/autoAssignSuppliers.ts 참조
 */
export async function POST() {
  const sb = getServiceClient();
  const result = await autoAssignSuppliers(sb);
  return NextResponse.json({ message: "ok", ...result });
}
