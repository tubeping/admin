-- 주문건별 비고 (어드민용, 판매사용)
ALTER TABLE mall_orders ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';
ALTER TABLE mall_orders ADD COLUMN IF NOT EXISTS seller_note TEXT DEFAULT '';
