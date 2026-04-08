import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/suppliers/import — CSV/엑셀 공급사 일괄 등록
 * FormData: file (CSV)
 * CSV 컬럼: 공급사명, 이메일, 담당자, 연락처, 사업자번호, 메모
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
  }

  const text = await file.text();
  const lines = text
    .replace(/^\uFEFF/, "") // BOM 제거
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l);

  if (lines.length < 2) {
    return NextResponse.json({ error: "데이터가 없습니다 (헤더 + 최소 1행)" }, { status: 400 });
  }

  // 헤더 파싱 (유연하게 매칭)
  const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const colMap: Record<string, number> = {};

  const nameAliases = ["공급사명", "공급사", "업체명", "이름", "name"];
  const emailAliases = ["이메일", "email", "메일"];
  const contactAliases = ["담당자", "담당자명", "contact", "contact_name"];
  const phoneAliases = ["연락처", "전화번호", "phone", "tel"];
  const bizNoAliases = ["사업자번호", "사업자", "business_no"];
  const memoAliases = ["메모", "비고", "memo", "note"];

  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase();
    if (nameAliases.some((a) => h.includes(a.toLowerCase()))) colMap.name = i;
    else if (emailAliases.some((a) => h.includes(a.toLowerCase()))) colMap.email = i;
    else if (contactAliases.some((a) => h.includes(a.toLowerCase()))) colMap.contact_name = i;
    else if (phoneAliases.some((a) => h.includes(a.toLowerCase()))) colMap.phone = i;
    else if (bizNoAliases.some((a) => h.includes(a.toLowerCase()))) colMap.business_no = i;
    else if (memoAliases.some((a) => h.includes(a.toLowerCase()))) colMap.memo = i;
  }

  if (colMap.name === undefined || colMap.email === undefined) {
    return NextResponse.json(
      { error: "필수 컬럼(공급사명, 이메일)을 찾을 수 없습니다. 헤더: " + header.join(", ") },
      { status: 400 }
    );
  }

  // 데이터 파싱
  const rows: {
    name: string;
    email: string;
    contact_name?: string;
    phone?: string;
    business_no?: string;
    memo?: string;
  }[] = [];
  const errors: { row: number; error: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.replace(/"/g, "").trim());
    const name = cols[colMap.name] || "";
    const email = cols[colMap.email] || "";

    if (!name || !email) {
      errors.push({ row: i + 1, error: `공급사명 또는 이메일 누락` });
      continue;
    }

    rows.push({
      name,
      email,
      contact_name: colMap.contact_name !== undefined ? cols[colMap.contact_name] : undefined,
      phone: colMap.phone !== undefined ? cols[colMap.phone] : undefined,
      business_no: colMap.business_no !== undefined ? cols[colMap.business_no] : undefined,
      memo: colMap.memo !== undefined ? cols[colMap.memo] : undefined,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "유효한 데이터가 없습니다", errors }, { status: 400 });
  }

  // DB 저장
  const sb = getServiceClient();
  const { data, error } = await sb.from("suppliers").upsert(rows, {
    onConflict: "email",
    ignoreDuplicates: true,
  }).select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    total: lines.length - 1,
    imported: data?.length || 0,
    skipped: rows.length - (data?.length || 0),
    errors,
  });
}
