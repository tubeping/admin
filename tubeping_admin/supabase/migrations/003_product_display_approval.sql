-- 상품 진열 상태 + 승인 상태 추가
-- Supabase Dashboard → SQL Editor에서 실행

-- 1. 진열 상태 (T=진열함, F=진열안함)
ALTER TABLE products ADD COLUMN IF NOT EXISTS display TEXT NOT NULL DEFAULT 'T';

-- 2. 승인 상태
ALTER TABLE products ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';
-- 값: pending(승인대기), requested(승인요청), re_requested(재승인요청), approved(승인완료), rejected(반려)

-- 3. 인덱스
CREATE INDEX IF NOT EXISTS idx_products_display ON products(display);
CREATE INDEX IF NOT EXISTS idx_products_approval ON products(approval_status);
