-- 023_discount_detail.sql
-- 할인 유형별 세부 컬럼 추가 (카페24 API 기준)

-- orders 테이블: 할인 유형별 금액
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_discount INTEGER DEFAULT 0,          -- 쿠폰할인
  ADD COLUMN IF NOT EXISTS app_discount INTEGER DEFAULT 0,             -- 앱할인 (즉시할인)
  ADD COLUMN IF NOT EXISTS additional_discount INTEGER DEFAULT 0;      -- 추가할인 (회원등급 등)

-- settlement_items 테이블: 정산서 세부 할인 + 판매방식
ALTER TABLE settlement_items
  ADD COLUMN IF NOT EXISTS coupon_discount INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS app_discount INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_discount INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_channel TEXT;
