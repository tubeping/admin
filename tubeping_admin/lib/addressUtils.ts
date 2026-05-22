/**
 * 주소 검증 공용 유틸 (juso.go.kr 기반)
 * - address-verify API 라우트와 autoVerifyAddresses에서 공통 사용
 */

const JUSO_API_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

/**
 * 주소에서 검색 키워드 추출
 * e.g. "서울특별시 강남구 테헤란로 123 OO빌딩 201호" → "강남구 테헤란로 123"
 */
export function extractSearchKeyword(address: string): string {
  const cleaned = address
    .trim()
    .replace(/\(\d{5}\)/, "")
    .replace(/\(.*?\)/g, "")
    .trim();
  const parts = cleaned.split(/\s+/);

  let roadIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if ((/[로길]$/.test(parts[i]) && !/[시도]$/.test(parts[i])) || /대로$/.test(parts[i])) {
      roadIdx = i;
      break;
    }
  }
  if (roadIdx >= 0) {
    return parts.slice(Math.max(0, roadIdx - 1), Math.min(parts.length, roadIdx + 2)).join(" ");
  }

  const meaningful = parts.filter((p) => p.length >= 2 && !/^[0-9]+[층호실]?$/.test(p));
  const startIdx = meaningful[0]?.match(/[시도]$/) ? 1 : 0;
  return meaningful.slice(startIdx, startIdx + 3).join(" ");
}

export function normalizeAddress(addr: string): string {
  return addr.replace(/\s+/g, " ").replace(/\(.*?\)/g, "").trim().toLowerCase();
}

export interface VerifyResult {
  status: "valid" | "invalid" | "unknown";
  reason: string | null;
  suggestion?: string | null;
  matched?: string | null;
  zipNo?: string | null;
}

/**
 * 단일 주소 검증 (juso.go.kr API)
 * @param confmKey juso.go.kr API 인증키
 * @param address 검증할 주소
 * @param full true면 matched/zipNo/suggestion 포함 (UI용), false면 status/reason만 (자동검증용)
 */
export async function verifyOneAddress(
  confmKey: string,
  address: string,
  full = false
): Promise<VerifyResult> {
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
    const addrPrefix = normalizedAddr.split(" ").slice(0, -1).join(" ");

    for (const j of juso) {
      const roadNorm = normalizeAddress(j.roadAddr || "");
      const jibunNorm = normalizeAddress(j.jibunAddr || "");

      if (
        normalizedAddr.includes(roadNorm) || roadNorm.includes(addrPrefix) ||
        normalizedAddr.includes(jibunNorm) || jibunNorm.includes(addrPrefix)
      ) {
        return {
          status: "valid",
          reason: null,
          ...(full && { suggestion: null, matched: j.roadAddr, zipNo: j.zipNo }),
        };
      }
    }

    // 검색 결과는 있지만 정확 매칭 아님 → 유효로 간주 (도로명까지만 검증)
    return {
      status: "valid",
      reason: null,
      ...(full && { suggestion: juso[0]?.roadAddr, matched: juso[0]?.roadAddr, zipNo: juso[0]?.zipNo }),
    };
  } catch (e) {
    return { status: "unknown", reason: (e as Error).message };
  }
}
