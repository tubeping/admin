import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "./env.public";
import { env } from "./env.server";

// publishable anon 키 클라이언트 (서버 라우트에서 RLS 적용된 단순 조회용)
export const supabase = createClient(
  publicEnv.NEXT_PUBLIC_SUPABASE_URL,
  publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// service role 클라이언트 (API 라우트 - 토큰 암호화 등 민감 작업)
export function getServiceClient() {
  return createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );
}
