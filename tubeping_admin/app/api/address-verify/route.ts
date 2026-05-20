import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/address-verify — 주소 검증 (juso.go.kr 기반)
 * Body: { addresses: Array<{ id: string; address: string }> }
 *
 * 각 주소에서 핵심 키워드(시/도, 구/군, 동/읍/면/리 + 도로명)를 추출해서
 * juso.go.kr API로 검색 → 매칭 결과에 따라 valid/invalid/unknown 반환
 */
export async function POST(request: NextRequest) {
  const confmKey = process.env.JUSO_CONFIRM_KEY;
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
      if (!address || address.trim().length < 2) {
        return { id, status: "invalid" as const, reason: "주소 없음", suggestion: null };
      }

      try {
        // Extract search keyword: use the road address part or first meaningful chunk
        const keyword = extractSearchKeyword(address);
        if (!keyword || keyword.length < 2) {
          return { id, status: "unknown" as const, reason: "검색 키워드 추출 실패", suggestion: null };
        }

        const params = new URLSearchParams({
          confmKey,
          currentPage: "1",
          countPerPage: "5",
          keyword,
          resultType: "json",
        });

        const res = await fetch(
          `https://business.juso.go.kr/addrlink/addrLinkApi.do?${params.toString()}`
        );
        const data = await res.json();
        const common = data?.results?.common;
        const juso = data?.results?.juso || [];

        if (common?.errorCode !== "0") {
          return { id, status: "unknown" as const, reason: common?.errorMessage || "API 오류", suggestion: null };
        }

        if (juso.length === 0) {
          return { id, status: "invalid" as const, reason: "주소 검색 결과 없음", suggestion: null };
        }

        // Check if any result closely matches the original address
        const normalizedAddr = normalizeAddress(address);

        for (const j of juso) {
          const roadNorm = normalizeAddress(j.roadAddr || "");
          const jibunNorm = normalizeAddress(j.jibunAddr || "");

          // Check if the search result road/jibun address is contained in the original
          if (normalizedAddr.includes(roadNorm) || roadNorm.includes(normalizedAddr.split(" ").slice(0, -1).join(" "))) {
            return {
              id,
              status: "valid" as const,
              reason: null,
              suggestion: null,
              matched: j.roadAddr,
              zipNo: j.zipNo
            };
          }
          if (normalizedAddr.includes(jibunNorm) || jibunNorm.includes(normalizedAddr.split(" ").slice(0, -1).join(" "))) {
            return {
              id,
              status: "valid" as const,
              reason: null,
              suggestion: null,
              matched: j.roadAddr,
              zipNo: j.zipNo
            };
          }
        }

        // If we got results but none match closely, suggest the top one
        return {
          id,
          status: "suspect" as const,
          reason: "유사 주소 발견 (정확한 매칭 없음)",
          suggestion: juso[0]?.roadAddr || null,
          zipNo: juso[0]?.zipNo || null,
        };
      } catch (e) {
        return { id, status: "unknown" as const, reason: (e as Error).message, suggestion: null };
      }
    })
  );

  return NextResponse.json({ results });
}

/**
 * Extract a search keyword from a full address.
 * e.g. "서울특별시 강남구 테헤란로 123 OO빌딩 201호" → "강남구 테헤란로 123"
 */
function extractSearchKeyword(address: string): string {
  const trimmed = address.trim();

  // Remove detail address parts (after building name, floor, room number etc.)
  // Common patterns: N층, N호, N동, (우편번호)
  const cleaned = trimmed
    .replace(/\(\d{5}\)/, "") // remove zipcode in parentheses
    .replace(/\(.*?\)/g, "")  // remove anything in parentheses
    .trim();

  const parts = cleaned.split(/\s+/);

  // Find the road name pattern (XX로, XX길, XX대로) or lot number (XX동 NNN-NN)
  let roadIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/[로길]$/.test(parts[i]) && !/[시도]$/.test(parts[i])) {
      roadIdx = i;
      break;
    }
    if (/대로$/.test(parts[i])) {
      roadIdx = i;
      break;
    }
  }

  if (roadIdx >= 0) {
    // Include district + road name + number
    const start = Math.max(0, roadIdx - 1);
    const end = Math.min(parts.length, roadIdx + 2); // road name + building number
    return parts.slice(start, end).join(" ");
  }

  // Fallback: use first 3-4 meaningful parts (skip province-level)
  const meaningful = parts.filter(p =>
    p.length >= 2 && !/^[0-9]+[층호실]?$/.test(p)
  );

  // Skip 시/도 level, take 구/군 + 동/읍/면 level
  const startIdx = meaningful[0]?.match(/[시도]$/) ? 1 : 0;
  return meaningful.slice(startIdx, startIdx + 3).join(" ");
}

function normalizeAddress(addr: string): string {
  return addr
    .replace(/\s+/g, " ")
    .replace(/\(.*?\)/g, "")
    .trim()
    .toLowerCase();
}
