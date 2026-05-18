import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/address-search — 주소통합검색 (juso.go.kr) 프록시
 * params: keyword, page (default 1)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const keyword = searchParams.get("keyword") || "";
  const page = searchParams.get("page") || "1";

  if (!keyword || keyword.length < 2) {
    return NextResponse.json({ results: [], totalCount: 0 });
  }

  const confmKey = process.env.JUSO_CONFIRM_KEY;
  if (!confmKey) {
    return NextResponse.json(
      { error: "JUSO_CONFIRM_KEY 환경변수가 설정되지 않았습니다" },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    confmKey,
    currentPage: page,
    countPerPage: "10",
    keyword,
    resultType: "json",
  });

  try {
    const res = await fetch(
      `https://business.juso.go.kr/addrlink/addrLinkApi.do?${params.toString()}`
    );
    const data = await res.json();

    const common = data?.results?.common;
    const juso = data?.results?.juso || [];

    if (common?.errorCode !== "0") {
      return NextResponse.json(
        { error: common?.errorMessage || "주소 검색 실패", results: [], totalCount: 0 },
        { status: 400 }
      );
    }

    const results = juso.map((j: Record<string, string>) => ({
      zipNo: j.zipNo,
      roadAddr: j.roadAddr,
      jibunAddr: j.jibunAddr,
      bdNm: j.bdNm,
    }));

    return NextResponse.json({
      results,
      totalCount: Number(common?.totalCount || 0),
      currentPage: Number(common?.currentPage || 1),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "주소 검색 API 호출 실패" },
      { status: 500 }
    );
  }
}
