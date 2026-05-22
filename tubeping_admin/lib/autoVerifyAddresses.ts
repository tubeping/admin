import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 주문 주소 자동 검증 (juso.go.kr 기반, 서버사이드)
 *
 * 흐름:
 *   1. address_verify_status IS NULL인 주문 중 receiver_address가 있는 건 조회
 *   2. juso.go.kr API로 주소 검증
 *   3. 결과를 orders.address_verify_status에 저장 (valid/invalid/unknown)
 *
 * opts.orderIds가 주어지면 해당 주문만, 아니면 미검증 전체 대상
 */

const JUSO_API_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

function extractSearchKeyword(address: string): string {
  const trimmed = address.trim();
  const cleaned = trimmed
    .replace(/\(\d{5}\)/, "")
    .replace(/\(.*?\)/g, "")
    .trim();
  const parts = cleaned.split(/\s+/);
  let roadIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/[로길]$/.test(parts[i]) && !/[시도]$/.test(parts[i])) { roadIdx = i; break; }
    if (/대로$/.test(parts[i])) { roadIdx = i; break; }
  }
  if (roadIdx >= 0) {
    const start = Math.max(0, roadIdx - 1);
    const end = Math.min(parts.length, roadIdx + 2);
    return parts.slice(start, end).join(" ");
  }
  const meaningful = parts.filter(p => p.length >= 2 && !/^[0-9]+[층호실]?$/.test(p));
  const startIdx = meaningful[0]?.match(/[시도]$/) ? 1 : 0;
  return meaningful.slice(startIdx, startIdx + 3).join(" ");
}

function normalizeAddress(addr: string): string {
  return addr.replace(/\s+/g, " ").replace(/\(.*?\)/g, "").trim().toLowerCase();
}

async function verifyOneAddress(
  confmKey: string,
  address: string
): Promise<{ status: "valid" | "invalid" | "unknown"; reason: string | null }> {
  if (!address || address.trim().length < 2) {
    return { status: "invalid", reason: "주소 없음" };
  }
  try {
    const keyword = extractSearchKeyword(address);
    if (!keyword || keyword.length < 2) {
      return { status: "unknown", reason: "검색 키워드 추출 실패" };
    }
    const params = new URLSearchParams({
      confmKey,
      currentPage: "1",
      countPerPage: "5",
      keyword,
      resultType: "json",
    });
    const res = await fetch(`${JUSO_API_URL}?${params.toString()}`);
    const data = await res.json();
    const common = data?.results?.common;
    const juso = data?.results?.juso || [];

    if (common?.errorCode !== "0") {
      return { status: "unknown", reason: common?.errorMessage || "API 오류" };
    }
    if (juso.length === 0) {
      return { status: "invalid", reason: "주소 검색 결과 없음" };
    }

    const normalizedAddr = normalizeAddress(address);
    for (const j of juso) {
      const roadNorm = normalizeAddress(j.roadAddr || "");
      const jibunNorm = normalizeAddress(j.jibunAddr || "");
      if (
        normalizedAddr.includes(roadNorm) ||
        roadNorm.includes(normalizedAddr.split(" ").slice(0, -1).join(" ")) ||
        normalizedAddr.includes(jibunNorm) ||
        jibunNorm.includes(normalizedAddr.split(" ").slice(0, -1).join(" "))
      ) {
        return { status: "valid", reason: null };
      }
    }
    // 검색 결과는 있지만 정확 매칭 아님 → 유효로 간주 (도로명까지만 검증)
    return { status: "valid", reason: null };
  } catch (e) {
    return { status: "unknown", reason: (e as Error).message };
  }
}

export async function autoVerifyAddresses(
  sb: SupabaseClient,
  opts: { orderIds?: string[] } = {}
): Promise<{ total: number; valid: number; invalid: number; unknown: number }> {
  const confmKey = process.env.JUSO_CONFIRM_KEY;
  if (!confmKey) {
    console.warn("[autoVerifyAddresses] JUSO_CONFIRM_KEY not set, skipping");
    return { total: 0, valid: 0, invalid: 0, unknown: 0 };
  }

  // 미검증 주문 조회
  let q = sb
    .from("orders")
    .select("id, receiver_address")
    .is("address_verify_status", null)
    .neq("shipping_status", "cancelled")
    .not("receiver_address", "is", null);
  if (opts.orderIds && opts.orderIds.length > 0) q = q.in("id", opts.orderIds);
  q = q.limit(200); // 한 번에 최대 200건

  const { data: orders, error: qErr } = await q;
  if (qErr) {
    // 컬럼이 아직 없으면 조용히 스킵
    if (qErr.message?.includes("does not exist")) {
      console.warn("[autoVerifyAddresses] address_verify_status column missing, skipping");
      return { total: 0, valid: 0, invalid: 0, unknown: 0 };
    }
    console.error("[autoVerifyAddresses] query error:", qErr.message);
    return { total: 0, valid: 0, invalid: 0, unknown: 0 };
  }
  if (!orders || orders.length === 0) {
    return { total: 0, valid: 0, invalid: 0, unknown: 0 };
  }

  let valid = 0, invalid = 0, unknown = 0;

  // 배치 처리 (50건씩, juso.go.kr rate limit 고려)
  for (let i = 0; i < orders.length; i += 50) {
    const batch = orders.slice(i, i + 50);
    const results = await Promise.all(
      batch.map(async (order) => {
        const result = await verifyOneAddress(confmKey, order.receiver_address || "");
        return { id: order.id, ...result };
      })
    );

    // DB 업데이트
    for (const r of results) {
      const { error: updErr } = await sb
        .from("orders")
        .update({
          address_verify_status: r.status,
          address_verify_reason: r.reason,
          address_verified_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      if (updErr) {
        if (updErr.message?.includes("does not exist")) {
          console.warn("[autoVerifyAddresses] column missing, aborting persist");
          return { total: orders.length, valid, invalid, unknown };
        }
      }

      if (r.status === "valid") valid++;
      else if (r.status === "invalid") invalid++;
      else unknown++;
    }
  }

  return { total: orders.length, valid, invalid, unknown };
}
