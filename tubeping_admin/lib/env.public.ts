/**
 * 공개 환경변수 (NEXT_PUBLIC_*)
 *
 * 빌드 시점에 클라이언트 번들에 인라인됨 — 시크릿 넣지 말 것.
 * client/server 양쪽에서 import 가능.
 *
 * ⚠️ 반드시 `process.env.NEXT_PUBLIC_XXX` 정적 참조를 쓸 것.
 * `process.env[key]` 같은 동적 접근은 Next/Turbopack이 클라이언트 번들에
 * 인라인하지 못해 브라우저에서 undefined가 되고, 모듈 평가 중 throw하면
 * 그 페이지 청크가 통째로 죽어 "This page couldn't load"가 난다.
 * (그래서 throw 대신 빈 문자열 폴백 사용)
 */

export const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL ?? "https://tubepingadmin.vercel.app",
} as const;
