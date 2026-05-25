-- 주문 주소검증 결과를 DB에 영구 저장
-- orders 테이블에 주소검증 상태 컬럼 추가

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS address_verify_status TEXT,          -- valid / invalid / unknown / null(미검증)
  ADD COLUMN IF NOT EXISTS address_verify_reason TEXT,          -- 검증 실패 사유
  ADD COLUMN IF NOT EXISTS address_verified_at TIMESTAMPTZ;     -- 검증 시각

CREATE INDEX IF NOT EXISTS idx_orders_address_verify ON orders(address_verify_status)
  WHERE address_verify_status IS NOT NULL;
