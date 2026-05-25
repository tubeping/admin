import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env.server";
import { getServiceClient } from "@/lib/supabase";
import { verifyOneAddress } from "@/lib/addressUtils";

/**
 * POST /api/address-verify — 주소 검증 (juso.go.kr 기반)
 * Body: { addresses: Array<{ id: string; address: string }> }
 *
 * 각 주소에서 핵심 키워드를 추출해서 juso.go.kr API로 검색
 * → valid/invalid/unknown 반환 + DB에 결과 영구 저장
 */
export async function POST(request: NextRequest) {
  const confmKey = env.JUSO_CONFIRM_KEY;
  if (!confmKey) {
    return NextResponse.json(
      { error: "JUSO_CONFIRM_KEY 환경변수가 설정되지 않았습니다" },
      { status: 500 }
    );
  }

  const body = await request.json();
  const addresses: { id: string; address: string }[] = body.addresses || [];

  if (addresses.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Rate limit: max 50 at a time
  const batch = addresses.slice(0, 50);
  const sb = getServiceClient();

  // 이미 valid인 주문은 재검증 스킵
  const ids = batch.map((a) => a.id);
  const { data: existing } = await sb
    .from("orders")
    .select("id, address_verify_status")
    .in("id", ids)
    .eq("address_verify_status", "valid");
  const alreadyValid = new Set((existing || []).map((o) => o.id));
  const toVerify = batch.filter((a) => !alreadyValid.has(a.id));

  // valid인 건은 그대로 반환
  const skippedResults = batch
    .filter((a) => alreadyValid.has(a.id))
    .map((a) => ({ id: a.id, status: "valid" as const, reason: null, suggestion: null, matched: null, zipNo: null }));

  const verifiedResults = await Promise.all(
    toVerify.map(async ({ id, address }) => {
      const r = await verifyOneAddress(confmKey, address, true);
      return { id, ...r };
    })
  );

  // DB에 검증 결과 영구 저장 (새로 검증한 것만)
  if (verifiedResults.length > 0) {
    try {
      const now = new Date().toISOString();
      await Promise.all(
        verifiedResults.map((r) =>
          sb.from("orders").update({
            address_verify_status: r.status,
            address_verify_reason: r.reason || null,
            address_verified_at: now,
          }).eq("id", r.id)
        )
      );
    } catch (e) {
      console.warn("[address-verify] DB persist skipped:", (e as Error).message);
    }
  }

  return NextResponse.json({ results: [...skippedResults, ...verifiedResults] });
}
