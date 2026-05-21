import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { randomBytes } from "crypto";

// 일회성 마이그레이션 엔드포인트: view_token 컬럼이 없을 때만 사용
// phone_order_clients에 view_token을 추가하는 대신
// Supabase에서 직접 ALTER TABLE을 실행한 후 이 엔드포인트로 토큰 생성
export async function POST() {
  const sb = getServiceClient();

  // view_token이 null인 클라이언트에 토큰 생성
  const { data: clients, error: fetchErr } = await sb
    .from("phone_order_clients")
    .select("id")
    .is("view_token", null);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message, hint: "view_token 컬럼이 없다면 Supabase SQL Editor에서 먼저 실행하세요: ALTER TABLE phone_order_clients ADD COLUMN IF NOT EXISTS view_token TEXT UNIQUE;" }, { status: 500 });
  }

  if (!clients || clients.length === 0) {
    return NextResponse.json({ message: "모든 판매처에 이미 토큰이 있습니다.", updated: 0 });
  }

  let updated = 0;
  for (const client of clients) {
    const token = randomBytes(16).toString("hex");
    const { error } = await sb
      .from("phone_order_clients")
      .update({ view_token: token })
      .eq("id", client.id);

    if (!error) updated++;
  }

  return NextResponse.json({ message: `${updated}개 판매처에 토큰을 생성했습니다.`, updated });
}
