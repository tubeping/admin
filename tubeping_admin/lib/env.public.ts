/**
 * 공개 환경변수 (NEXT_PUBLIC_*)
 *
 * 빌드 시점에 클라이언트 번들에 인라인됨 — 시크릿 넣지 말 것.
 * client/server 양쪽에서 import 가능.
 */

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required public env: ${key}`);
  return v;
}

function opt(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: req("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: req("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  NEXT_PUBLIC_BASE_URL: opt("NEXT_PUBLIC_BASE_URL", "https://tubepingadmin.vercel.app"),
} as const;
