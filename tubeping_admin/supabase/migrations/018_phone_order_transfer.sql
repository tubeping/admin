-- 전화주문 발주 이관 추적 컬럼 추가
ALTER TABLE phone_orders ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;
ALTER TABLE phone_orders ADD COLUMN IF NOT EXISTS transferred_order_id UUID;

CREATE INDEX IF NOT EXISTS idx_phone_orders_transferred_at ON phone_orders(transferred_at);
