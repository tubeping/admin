import { NextRequest, NextResponse } from "next/server";
import { getActiveStores, cafe24Fetch, type StoreInfo } from "@/lib/cafe24";

const MALL_ID = "tubeping";

let _store: StoreInfo | null = null;
async function getMasterStore(): Promise<StoreInfo | null> {
  if (_store) return _store;
  const stores = await getActiveStores();
  _store = stores.find((s) => s.mall_id === MALL_ID) || null;
  return _store;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);
  const offset = searchParams.get("offset") || "0";
  const keyword = searchParams.get("keyword") || "";
  const category = searchParams.get("category") || "";

  const store = await getMasterStore();
  if (!store) {
    return NextResponse.json({ error: "마스터 스토어를 찾을 수 없습니다" }, { status: 500 });
  }

  const params = new URLSearchParams({ limit: String(limit), offset });
  if (keyword) params.set("product_name", keyword);
  if (category) params.set("category", category);

  const res = await cafe24Fetch(store, `/products?${params}`);

  if (!res.ok) {
    return NextResponse.json({ error: "카페24 API 오류" }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
