-- 023 stores per-app credentials
-- 외부 입점몰(예: 하랑한의원 harangfirst)이 자기 카페24 계정으로 만든
-- 전용앱(별도 client_id/secret)을 admin에 연동할 수 있도록 store별 자격증명 지원.
--
-- 값이 NULL이면 기존 단일앱(env CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET = z87...)으로
-- 폴백한다. → 기존 13개 몰은 컬럼이 NULL이라 동작 100% 그대로, 무영향.
--
-- Supabase Dashboard → SQL Editor에서 실행

ALTER TABLE stores ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS client_secret TEXT;
