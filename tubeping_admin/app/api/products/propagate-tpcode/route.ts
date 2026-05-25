import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCafe24Stores, cafe24Fetch } from "@/lib/cafe24";

export const maxDuration = 300;

const MASTER_MALL_ID = "tubeping";

type Cafe24Product = {
  product_no: number;
  product_name: string;
  custom_product_code?: string;
  product_code?: string;
};

type MatchedExtra = {
  cafe24_product_no: number;
  cafe24_name: string;
  tubeping_name: string;
  tp_code: string;
};

type StoreReport = {
  store: string;
  mall_id: string;
  cafe24_total: number;
  matched: number;
  updated: number;
  failed: number;
  code_in_tubeping: number;    // 카페24 custom_product_code가 TubePing tp_code 와 일치
  code_other: number;          // 비어있진 않지만 TubePing tp_code 가 아닌 임의 값
  code_empty: number;          // custom_product_code 가 비어있음
  tubeping_dup_names: string[];
  cafe24_dup_names: string[];
  unmatched: { product_no: number; product_name: string; current_code: string; code_hit_tp: boolean }[];
  matched_by_normalize: MatchedExtra[];
  errors: string[];
};

// 정규화: 공백/괄호/특수문자 제거 + 소문자
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\[\](){}【】〔〕「」『』<>＜＞,.·•!?~@#$%^&*_=+\-\\/|"'`:;]/g, "")
    .trim();
}

/**
 * POST /api/products/propagate-tpcode
 * TubePing 자체코드(tp_code)를 sub-mall 카페24에 상품명 매칭으로 propagate
 *  ?normalize=true  — 공백/특수문자 무시한 정규화 매칭 추가 (기본은 엄격 매칭)
 *  ?dry_run=true    — 실제 PUT 안 하고 리포트만
 */
export async function POST(request: NextRequest) {
  const sb = getServiceClient();
  const normalize = request.nextUrl.searchParams.get("normalize") === "true";
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "true";

  // 1. TubePing 마스터 상품을 DB에서 전체 로드 (Supabase 기본 limit 1000 회피)
  const tpProducts: { id: string; tp_code: string | null; product_name: string | null }[] = [];
  {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("products")
        .select("id, tp_code, product_name")
        .range(from, from + pageSize - 1);
      if (error) {
        return NextResponse.json({ error: `상품 조회 실패: ${error.message}` }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      tpProducts.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
      if (from > 20000) break;
    }
  }
  if (tpProducts.length === 0) {
    return NextResponse.json({ error: "TubePing 상품이 없습니다" }, { status: 400 });
  }

  // TubePing 상품명 → tp_code 맵 (중복 검사)
  const tpNameMap = new Map<string, string>();
  const tpDupNames = new Set<string>();
  for (const p of tpProducts) {
    if (!p.product_name || !p.tp_code) continue;
    const key = p.product_name.trim();
    if (!key) continue;
    if (tpNameMap.has(key)) {
      tpDupNames.add(key);
    } else {
      tpNameMap.set(key, p.tp_code);
    }
  }
  for (const dup of tpDupNames) tpNameMap.delete(dup);

  // 정규화 맵 (normalize 모드 전용) — 정규화 후에도 충돌한 이름은 제외
  const tpNormMap = new Map<string, { tpCode: string; originalName: string }>();
  const tpNormDup = new Set<string>();
  if (normalize) {
    for (const p of tpProducts) {
      if (!p.product_name || !p.tp_code) continue;
      const nk = normalizeName(p.product_name);
      if (!nk) continue;
      if (tpNormMap.has(nk)) {
        tpNormDup.add(nk);
      } else {
        tpNormMap.set(nk, { tpCode: p.tp_code, originalName: p.product_name });
      }
    }
    for (const dup of tpNormDup) tpNormMap.delete(dup);
  }

  // 검증용: 모든 tp_code 집합 (custom_product_code가 실제 TubePing 코드인지 확인)
  const tpCodeSet = new Set<string>();
  for (const p of tpProducts) {
    if (p.tp_code) tpCodeSet.add(p.tp_code);
  }

  // 2. sub-mall 스토어 목록 (마스터 제외, 카페24 mall만)
  const stores = (await getCafe24Stores()).filter((s) => s.mall_id !== MASTER_MALL_ID);
  if (stores.length === 0) {
    return NextResponse.json({ error: "sub-mall 스토어가 없습니다" }, { status: 400 });
  }

  // 3. 각 스토어를 병렬로 처리
  const reports: StoreReport[] = await Promise.all(
    stores.map(async (store) => {
      const report: StoreReport = {
        store: store.name,
        mall_id: store.mall_id,
        cafe24_total: 0,
        matched: 0,
        updated: 0,
        failed: 0,
        code_in_tubeping: 0,
        code_other: 0,
        code_empty: 0,
        tubeping_dup_names: Array.from(tpDupNames),
        cafe24_dup_names: [],
        unmatched: [],
        matched_by_normalize: [],
        errors: [],
      };

      try {
        // cafe24 상품 페이지네이션 (display=T + display=F)
        const all: Cafe24Product[] = [];
        const seen = new Set<number>();
        for (const displayFlag of ["T", "F"]) {
          let offset = 0;
          const pageLimit = 100;
          while (offset < 10000) {
            const res = await cafe24Fetch(
              store,
              `/products?limit=${pageLimit}&offset=${offset}&display=${displayFlag}`
            );
            if (!res.ok) {
              report.errors.push(`상품 조회 실패 [${res.status}] display=${displayFlag}`);
              break;
            }
            const data = await res.json();
            const page: Cafe24Product[] = data.products || [];
            if (page.length === 0) break;
            for (const p of page) {
              if (!seen.has(p.product_no)) {
                seen.add(p.product_no);
                all.push(p);
              }
            }
            if (page.length < pageLimit) break;
            offset += pageLimit;
          }
        }
        report.cafe24_total = all.length;

        // 자체코드 현재 상태 카운트
        for (const p of all) {
          const code = (p.custom_product_code || "").trim();
          if (!code) report.code_empty++;
          else if (tpCodeSet.has(code)) report.code_in_tubeping++;
          else report.code_other++;
        }

        // 카페24 상품명 중복 검사
        const cafeNameCount = new Map<string, number>();
        for (const p of all) {
          const key = (p.product_name || "").trim();
          if (!key) continue;
          cafeNameCount.set(key, (cafeNameCount.get(key) || 0) + 1);
        }
        const cafeDupNames = new Set<string>();
        for (const [name, count] of cafeNameCount) {
          if (count > 1) cafeDupNames.add(name);
        }
        report.cafe24_dup_names = Array.from(cafeDupNames);

        // 매칭 + PUT
        const updateJobs: { p: Cafe24Product; tpCode: string }[] = [];
        for (const p of all) {
          const key = (p.product_name || "").trim();
          if (!key) {
            {
              const cc = (p.custom_product_code || "").trim();
              report.unmatched.push({
                product_no: p.product_no,
                product_name: p.product_name || "",
                current_code: cc,
                code_hit_tp: cc ? tpCodeSet.has(cc) : false,
              });
            }
            continue;
          }
          if (cafeDupNames.has(key)) continue; // 카페24 쪽 중복 → 스킵

          // 1차: 엄격 매칭
          let tpCode = tpNameMap.get(key);

          // 2차: 정규화 매칭 (normalize 모드)
          if (!tpCode && normalize) {
            const nk = normalizeName(key);
            if (nk) {
              const hit = tpNormMap.get(nk);
              if (hit) {
                tpCode = hit.tpCode;
                report.matched_by_normalize.push({
                  cafe24_product_no: p.product_no,
                  cafe24_name: key,
                  tubeping_name: hit.originalName,
                  tp_code: hit.tpCode,
                });
              }
            }
          }

          if (!tpCode) {
            const cc = (p.custom_product_code || "").trim();
            report.unmatched.push({
              product_no: p.product_no,
              product_name: key,
              current_code: cc,
              code_hit_tp: cc ? tpCodeSet.has(cc) : false,
            });
            continue;
          }
          if (p.custom_product_code === tpCode) {
            report.matched++;
            continue;
          }
          updateJobs.push({ p, tpCode });
          report.matched++;
        }

        // dry_run 모드: PUT 생략
        if (dryRun) {
          return report;
        }

        // 카페24 rate limit (40 req/s per mall) 대응: 순차 + 429 재시도
        const sampleErrors: string[] = [];
        const putOne = async (productNo: number, tpCode: string): Promise<boolean> => {
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const putRes = await cafe24Fetch(store, `/products/${productNo}`, {
                method: "PUT",
                body: JSON.stringify({
                  shop_no: 1,
                  request: { custom_product_code: tpCode },
                }),
              });
              if (putRes.ok) return true;
              if (putRes.status === 429) {
                // rate limit — 대기 후 재시도
                await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
                continue;
              }
              const txt = await putRes.text();
              if (sampleErrors.length < 3) sampleErrors.push(`${putRes.status}: ${txt.substring(0, 200)}`);
              return false;
            } catch (e) {
              if (sampleErrors.length < 3) sampleErrors.push(e instanceof Error ? e.message : "unknown");
              return false;
            }
          }
          if (sampleErrors.length < 3) sampleErrors.push("429 재시도 한도 초과");
          return false;
        };

        // 순차 처리하면서 초당 30 req 페이스 유지 (안전 마진)
        for (const { p, tpCode } of updateJobs) {
          const ok = await putOne(p.product_no, tpCode);
          if (ok) report.updated++;
          else report.failed++;
          await new Promise((r) => setTimeout(r, 35)); // ~28 req/s
        }
        report.errors.push(...sampleErrors);
      } catch (err) {
        report.errors.push(err instanceof Error ? err.message : "unknown");
      }

      return report;
    })
  );

  // 전체 합계
  const summary = reports.reduce(
    (acc, r) => {
      acc.cafe24_total += r.cafe24_total;
      acc.matched += r.matched;
      acc.updated += r.updated;
      acc.failed += r.failed;
      acc.unmatched += r.unmatched.length;
      return acc;
    },
    { cafe24_total: 0, matched: 0, updated: 0, failed: 0, unmatched: 0 }
  );

  return NextResponse.json({
    success: true,
    summary,
    tubeping_dup_names: Array.from(tpDupNames),
    reports,
  });
}
