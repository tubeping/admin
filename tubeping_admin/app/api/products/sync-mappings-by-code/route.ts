import { NextResponse } from "next/server";
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

/**
 * POST /api/products/sync-mappings-by-code
 *
 * 원칙: 자체코드(custom_product_code == tp_code) 기반 매핑
 *
 * 각 sub-mall cafe24 상품을 훑어서, custom_product_code가 TubePing tp_code와 일치하면
 * product_cafe24_mappings 테이블에 (product_id, store_id, cafe24_product_no, cafe24_product_code)
 * row를 upsert한다. 이름은 매칭 키로 사용하지 않는다.
 */
export async function POST() {
  const sb = getServiceClient();

  // 1. TubePing tp_code → product_id 맵 (전체 페이지네이션)
  const tpCodeToId = new Map<string, string>();
  {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("products")
        .select("id, tp_code")
        .range(from, from + pageSize - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      for (const p of data) {
        if (p.tp_code) tpCodeToId.set(p.tp_code, p.id);
      }
      if (data.length < pageSize) break;
      from += pageSize;
      if (from > 20000) break;
    }
  }

  // 2. sub-mall 스토어 목록
  const stores = (await getCafe24Stores()).filter((s) => s.mall_id !== MASTER_MALL_ID);

  type Report = {
    mall_id: string;
    store: string;
    cafe24_total: number;
    with_code: number;
    code_matched_tp: number;
    upserted: number;
    duplicate_codes: { code: string; product_nos: number[] }[];
    errors: string[];
  };

  const reports: Report[] = await Promise.all(
    stores.map(async (store) => {
      const report: Report = {
        mall_id: store.mall_id,
        store: store.name,
        cafe24_total: 0,
        with_code: 0,
        code_matched_tp: 0,
        upserted: 0,
        duplicate_codes: [],
        errors: [],
      };

      try {
        // 카페24 상품 페이지네이션 (display=T + display=F 둘 다)
        const all: Cafe24Product[] = [];
        const seen = new Set<number>();
        for (const displayFlag of ["T", "F"]) {
          let offset = 0;
          const pageLimit = 100;
          while (offset < 10000) {
            const res = await cafe24Fetch(store, `/products?limit=${pageLimit}&offset=${offset}&display=${displayFlag}`);
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

        // 자체코드 기반 매칭 + 동일 sub-mall 안 중복 코드 감지
        // (product_cafe24_mappings의 UNIQUE가 product_id+store_id라서 같은 코드가 여러 개면 충돌)
        const codeToProductNos = new Map<string, number[]>();
        for (const p of all) {
          const code = (p.custom_product_code || "").trim();
          if (!code) continue;
          report.with_code++;
          if (!tpCodeToId.get(code)) continue;
          report.code_matched_tp++;
          if (!codeToProductNos.has(code)) codeToProductNos.set(code, []);
          codeToProductNos.get(code)!.push(p.product_no);
        }

        const rows: Record<string, unknown>[] = [];
        for (const [code, productNos] of codeToProductNos) {
          if (productNos.length > 1) {
            report.duplicate_codes.push({ code, product_nos: productNos });
            continue; // 중복 코드는 자동 매핑 스킵 (수동 처리 필요)
          }
          const productId = tpCodeToId.get(code)!;
          rows.push({
            product_id: productId,
            store_id: store.id,
            cafe24_product_no: productNos[0],
            cafe24_product_code: null,
            sync_status: "synced",
            last_sync_at: new Date().toISOString(),
          });
        }

        // 배치 upsert
        const BATCH = 200;
        for (let i = 0; i < rows.length; i += BATCH) {
          const slice = rows.slice(i, i + BATCH);
          const { error } = await sb
            .from("product_cafe24_mappings")
            .upsert(slice, { onConflict: "product_id,store_id" });
          if (error) {
            report.errors.push(`upsert 실패: ${error.message.substring(0, 150)}`);
          } else {
            report.upserted += slice.length;
          }
        }
      } catch (err) {
        report.errors.push(err instanceof Error ? err.message : "unknown");
      }

      return report;
    })
  );

  const summary = reports.reduce(
    (acc, r) => {
      acc.cafe24_total += r.cafe24_total;
      acc.with_code += r.with_code;
      acc.code_matched_tp += r.code_matched_tp;
      acc.upserted += r.upserted;
      return acc;
    },
    { cafe24_total: 0, with_code: 0, code_matched_tp: 0, upserted: 0 }
  );

  return NextResponse.json({ success: true, summary, reports });
}
