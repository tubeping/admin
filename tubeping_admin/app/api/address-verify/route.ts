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

  const results = await Promise.all(
    batch.map(async ({ id, address }) => {
      const r = await verifyOneAddress(confmKey, address, true);
      return { id, ...r };
    })
  );

  // DB에 검증 결과 영구 저장
  try {
    const sb = getServiceClient();
    const now = new Date().toISOString();
    await Promise.all(
      results.map((r) =>
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

  return NextResponse.json({ results });
}
