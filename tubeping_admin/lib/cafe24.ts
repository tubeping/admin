/**
 * 카페24 API 공통 유틸 — 멀티 스토어 지원
 * 각 스토어별 토큰을 Supabase에서 조회/갱신
 */

import { getServiceClient } from "./supabase";
import { env } from "./env.server";

// 단일 카페24 앱(z87...)으로 통일
const CLIENT_ID = env.CAFE24_CLIENT_ID;
const CLIENT_SECRET = env.CAFE24_CLIENT_SECRET;

const API_VERSION = "2026-03-01";

const FETCH_TIMEOUT = 30_000; // 30초

// 스토어별 토큰 메모리 캐시
const tokenCache: Record<
  string,
  { access: string; refresh: string; expiresAt: number; mallId: string }
> = {};

// 토큰 갱신 중복 방지 (race condition 해소)
const refreshInFlight: Record<string, Promise<string>> = {};

export interface StoreInfo {
  id: string;
  mall_id: string;
  name: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
}

/**
 * 실제 카페24 mall 여부 (manual_/excel_/test_는 엑셀 수동등록용 pseudo 스토어)
 */
export function isCafe24Mall(mallId: string): boolean {
  return !(mallId.startsWith("manual_") || mallId.startsWith("excel_") || mallId.startsWith("test_"));
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
 * 카페24 API 호출 대상 (실제 카페24 mall만)
 */
export async function getCafe24Stores(): Promise<StoreInfo[]> {
  const all = await getActiveStores();
  return all.filter((s) => isCafe24Mall(s.mall_id));
}

/**
 * 특정 스토어의 유효한 토큰 반환 (캐시 + 자동 갱신)
 */
export async function getStoreToken(store: StoreInfo): Promise<string> {
  const cached = tokenCache[store.id];
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.access;
  }

  // 캐시가 없거나 만료됨 → 전달받은 store(=DB 최신값)로 캐시 재동기화.
  // refresh-tokens 크론이 토큰을 out-of-band로 회전시키므로, 캐시에 남은
  // 옛 refresh_token으로 갱신을 시도하면 400(invalid_grant)이 난다.
  tokenCache[store.id] = {
    access: store.access_token,
    refresh: store.refresh_token,
    expiresAt: store.token_expires_at
      ? new Date(store.token_expires_at).getTime()
      : Date.now() + 2 * 60 * 60 * 1000,
    mallId: store.mall_id,
  };

  const entry = tokenCache[store.id];
  if (entry.expiresAt > Date.now() + 60_000) {
    return entry.access;
  }

  return refreshStoreToken(store.id);
}

/**
 * 토큰 갱신 → 메모리 캐시 + Supabase 저장
 * 여러 앱 자격증명을 순차 시도해 어느 하나라도 성공하면 사용
 */
export async function refreshStoreToken(storeId: string): Promise<string> {
  // 이미 갱신 중이면 동일 promise 재사용 (race condition 방지)
  if (refreshInFlight[storeId]) return refreshInFlight[storeId];

  const promise = _doRefresh(storeId);
  refreshInFlight[storeId] = promise;
  try {
    return await promise;
  } finally {
    delete refreshInFlight[storeId];
  }
}

async function _doRefresh(storeId: string): Promise<string> {
  const entry = tokenCache[storeId];
  if (!entry) throw new Error(`스토어 ${storeId} 토큰 캐시 없음`);

  let errMsg = "";
  try {
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
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.access_token) {
        tokenCache[storeId] = {
          access: data.access_token,
          refresh: data.refresh_token,
          expiresAt: new Date(data.expires_at).getTime(),
          mallId: entry.mallId,
        };
        const sb = getServiceClient();
        await sb
          .from("stores")
          .update({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            token_expires_at: data.expires_at,
            status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("id", storeId);
        return data.access_token;
      }
      errMsg = "no access_token";
    } else {
      errMsg = `${res.status}`;
    }
  } catch (e) {
    errMsg = e instanceof Error ? e.message : "unknown";
  }

  // 실패 — 재인증 필요 표시
  const sb = getServiceClient();
  await sb
    .from("stores")
    .update({ status: "auth_failed", updated_at: new Date().toISOString() })
    .eq("id", storeId);

  throw new Error(`토큰 갱신 실패 [${entry.mallId}]: ${errMsg} — OAuth 재인증 필요`);
}

/**
 * 카페24 API 호출 (401 자동 갱신 + 429/5xx 재시도 + timeout)
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

  const doFetch = (hdrs: Record<string, string>) =>
    fetch(url, { ...options, headers: hdrs, signal: AbortSignal.timeout(FETCH_TIMEOUT) });

  let res = await doFetch(headers);

  if (res.status === 401) {
    const newToken = await refreshStoreToken(store.id);
    headers.Authorization = `Bearer ${newToken}`;
    res = await doFetch(headers);
  }

  // 429 또는 5xx → 최대 2회 재시도 (지수 백오프)
  for (let retry = 0; retry < 2 && (res.status === 429 || res.status >= 500); retry++) {
    const delay = (retry + 1) * 1000; // 1초, 2초
    await new Promise((r) => setTimeout(r, delay));
    res = await doFetch(headers);
  }

  return res;
}
