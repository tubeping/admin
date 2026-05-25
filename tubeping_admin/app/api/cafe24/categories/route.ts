import { NextResponse } from "next/server";
import { getActiveStores, cafe24Fetch, type StoreInfo } from "@/lib/cafe24";

const MALL_ID = "tubeping";

let _store: StoreInfo | null = null;
async function getMasterStore(): Promise<StoreInfo | null> {
  if (_store) return _store;
  const stores = await getActiveStores();
  _store = stores.find((s) => s.mall_id === MALL_ID) || null;
  return _store;
}

export async function GET() {
  const store = await getMasterStore();
  if (!store) {
    return NextResponse.json({ error: "마스터 스토어를 찾을 수 없습니다" }, { status: 500 });
  }

  const res = await cafe24Fetch(store, `/categories?limit=100`);

  if (!res.ok) {
    return NextResponse.json({ error: "카테고리 조회 실패" }, { status: res.status });
  }

  const data = await res.json();

  // 대분류만 필터 (parent=1, depth=1) + HTML 태그 제거
  const categories = (data.categories || [])
    .filter((c: { parent_category_no: number }) => c.parent_category_no === 1)
    .map((c: { category_no: number; category_name: string }) => ({
      id: c.category_no,
      name: c.category_name.replace(/<[^>]*>/g, "").trim(),
    }));

  return NextResponse.json({ categories });
}
