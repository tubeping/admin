import { NextRequest, NextResponse } from "next/server";
import { syncProductToStores } from "../[id]/sync/route";

/**
 * POST /api/products/sync-bulk
 * 여러 상품을 한번에 동기화 (self-call 제거 → 함수 직접 호출, 청크 병렬)
 * body: { product_ids: string[], concurrency?: number }
 */
export async function POST(request: NextRequest) {
  const { product_ids, concurrency } = await request.json();

  if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
    return NextResponse.json({ error: "product_ids가 필요합니다" }, { status: 400 });
  }

  // 카페24 API rate limit 보호용 청크 사이즈 — 기본 5
  const chunkSize = Math.min(Math.max(Number(concurrency) || 5, 1), 10);

  let totalSynced = 0;
  let totalErrors = 0;
  const productResults: Array<{ product_id: string; synced: number; errors: number; message: string }> = [];

  for (let i = 0; i < product_ids.length; i += chunkSize) {
    const chunk = product_ids.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(
      chunk.map(async (pid: string) => {
        const result = await syncProductToStores(pid);
        return { pid, result };
      })
    );

    for (const r of settled) {
      if (r.status === "fulfilled") {
        const { pid, result } = r.value;
        totalSynced += result.synced;
        totalErrors += result.errors;
        productResults.push({
          product_id: pid,
          synced: result.synced,
          errors: result.errors,
          message: result.message,
        });
      } else {
        totalErrors++;
        productResults.push({
          product_id: "?",
          synced: 0,
          errors: 1,
          message: r.reason instanceof Error ? r.reason.message : "동기화 예외",
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    total_products: product_ids.length,
    synced: totalSynced,
    errors: totalErrors,
    results: productResults,
    message: `${product_ids.length}개 상품 처리: ${totalSynced}개 동기화 성공${totalErrors > 0 ? `, ${totalErrors}개 실패` : ""}`,
  });
}
