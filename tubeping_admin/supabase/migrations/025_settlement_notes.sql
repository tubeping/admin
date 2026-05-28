-- 주문건별 비고 (어드민용, 판매사용)
ALTER TABLE settlement_items ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';
ALTER TABLE settlement_items ADD COLUMN IF NOT EXISTS seller_note TEXT DEFAULT '';

-- 정산서 전체 메모 (판매사용 - 기존 memo는 어드민용으로 사용)
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS seller_memo TEXT DEFAULT '';
