/**
 * 카페24 API 공통 유틸 — 멀티 스토어 지원
 * 각 스토어별 토큰을 Supabase에서 조회/갱신
 */

import { getServiceClient } from "./supabase";

const CLIENT_ID = process.env.CAFE24_CLIENT_ID_V2 || process.env.CAFE24_CLIENT_ID || "";
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET_V2 || process.env.CAFE24_CLIENT_SECRET || "";
const API_VERSION = "2026-03-01";

// 스토어별 토큰 메모리 캐시
const tokenCache: Record<
  string,
  { access: string; refresh: string; expiresAt: number; mallId: string }
> = {};

export interface StoreInfo {
  id: string;
  mall_id: string;
  name: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
}

/**
 * Supabase에서 active 스토어 목록 조회
 */
export async function getActiveStores(): Promise<StoreInfo[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("stores")
    .select("id, mall_id, name, access_token, refresh_token, token_expires_at")
    .eq("status", "active");

  if (error) throw new Error(`스토어 조회 실패: ${error.message}`);
  return data || [];
}

/**
 * 특정 스토어의 유효한 토큰 반환 (캐시 + 자동 갱신)
 */
export async function getStoreToken(store: StoreInfo): Promise<string> {
  const cached = tokenCache[store.id];
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.access;
  }

  // 캐시에 없거나 만료 임박 → 캐시 초기화
  if (!cached) {
    tokenCache[store.id] = {
      access: store.access_token,
      refresh: store.refresh_token,
      expiresAt: store.token_expires_at
        ? new Date(store.token_expires_at).getTime()
        : Date.now() + 2 * 60 * 60 * 1000,
      mallId: store.mall_id,
    };
  }

  const entry = tokenCache[store.id];
  if (entry.expiresAt > Date.now() + 60_000) {
    return entry.access;
  }

  return refreshStoreToken(store.id);
}

/**
 * 토큰 갱신 → 메모리 캐시 + Supabase 저장
 */
export async function refreshStoreToken(storeId: string): Promise<string> {
  const entry = tokenCache[storeId];
  if (!entry) throw new Error(`스토어 ${storeId} 토큰 캐시 없음`);

  const res = await fetch(
    `https://${entry.mallId}.cafe24api.com/api/v2/oauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: entry.refresh,
      }),
    }
  );

  if (!res.ok) throw new Error(`토큰 갱신 실패 [${entry.mallId}]: ${res.status}`);

  const data = await res.json();
  tokenCache[storeId] = {
    access: data.access_token,
    refresh: data.refresh_token,
    expiresAt: new Date(data.expires_at).getTime(),
    mallId: entry.mallId,
  };

  // Supabase에도 저장
  const sb = getServiceClient();
  await sb
    .from("stores")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: data.expires_at,
    })
    .eq("id", storeId);

  return data.access_token;
}

/**
 * 카페24 API 호출 (401 시 자동 토큰 갱신 + 재시도)
 */
export async function cafe24Fetch(
  store: StoreInfo,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const token = await getStoreToken(store);
  const url = `https://${store.mall_id}.cafe24api.com/api/v2/admin${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Cafe24-Api-Version": API_VERSION,
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const newToken = await refreshStoreToken(store.id);
    headers.Authorization = `Bearer ${newToken}`;
    return fetch(url, { ...options, headers });
  }

  return res;
}
