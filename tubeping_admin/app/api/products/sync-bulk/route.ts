import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/products/sync-bulk
 * 여러 상품을 한번에 동기화
 * body: { product_ids: string[] }
 */
export async function POST(request: NextRequest) {
  const { product_ids } = await request.json();

  if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
    return NextResponse.json({ error: "product_ids가 필요합니다" }, { status: 400 });
  }

  let totalSynced = 0;
  let totalErrors = 0;

  for (const pid of product_ids) {
    try {
      const res = await fetch(new URL(`/admin/api/products/${pid}/sync`, request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        totalSynced += data.synced || 0;
        totalErrors += data.errors || 0;
      } else {
        totalErrors++;
      }
    } catch {
      totalErrors++;
    }
  }

  return NextResponse.json({
    success: true,
    synced: totalSynced,
    errors: totalErrors,
    message: `${product_ids.length}개 상품 동기화: ${totalSynced}개 성공${totalErrors > 0 ? `, ${totalErrors}개 실패` : ""}`,
  });
}
