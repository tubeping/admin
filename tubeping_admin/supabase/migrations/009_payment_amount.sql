-- 009_payment_amount.sql
-- 고유 입금액 — 동명이인 구분용
-- order_amount: 실제 주문 금액 (정산용, 변경 금지)
-- payment_amount: 고객에게 안내할 입금 금액 (끝자리 1~9원 추가로 유일성 보장)

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_amount INTEGER;

COMMENT ON COLUMN orders.payment_amount IS
  '고객 안내용 입금 금액 (order_amount + 고유 끝자리). NULL이면 order_amount와 동일.';
