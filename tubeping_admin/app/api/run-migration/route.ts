import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/run-migration — 1회용 마이그레이션 실행
 * 배포 후 호출하고 이 파일은 삭제
 */
export async function POST(request: NextRequest) {
  const { secret } = await request.json();
  if (secret !== "migrate024") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const results: string[] = [];

  // 1. 컬럼 추가 시도 — Supabase JS로 직접 ALTER TABLE 불가
  //    대신 데이터 접근으로 컬럼 존재 여부 확인
  const { error: checkErr } = await sb
    .from("settlements")
    .select("share_token")
    .limit(1);

  if (checkErr?.message?.includes("does not exist")) {
    results.push("columns missing — please run SQL manually in Supabase Dashboard");
    return NextResponse.json({
      status: "manual_required",
      results,
      sql: `
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS seller_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS seller_confirmed_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS seller_confirmed_ip TEXT;

CREATE OR REPLACE FUNCTION set_settlement_share_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.share_token IS NULL THEN
    NEW.share_token := encode(gen_random_bytes(8), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_settlement_share_token ON settlements;
CREATE TRIGGER trg_set_settlement_share_token
  BEFORE INSERT ON settlements
  FOR EACH ROW
  EXECUTE FUNCTION set_settlement_share_token();

UPDATE settlements SET share_token = encode(gen_random_bytes(8), 'hex')
WHERE share_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_settlements_share_token ON settlements(share_token);
      `.trim(),
    });
  }

  // 2. 컬럼이 이미 존재하면 share_token이 null인 기존 정산에 토큰 부여
  const { data: nullTokens } = await sb
    .from("settlements")
    .select("id")
    .is("share_token", null);

  if (nullTokens && nullTokens.length > 0) {
    let filled = 0;
    for (const row of nullTokens) {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      await sb.from("settlements").update({ share_token: token }).eq("id", row.id);
      filled++;
    }
    results.push(`backfilled ${filled} settlements with share_token`);
  } else {
    results.push("all settlements already have share_token");
  }

  return NextResponse.json({ status: "ok", results });
}
