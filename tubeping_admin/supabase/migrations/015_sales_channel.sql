-- 015_sales_channel.sql — 주문의 판매방식(전화/공구/일반) 분리
-- 기존: store_id가 "전화주문" 또는 "공구주문" pseudo-store를 가리킴 (판매방식과 판매사가 한 컬럼에 섞임)
-- 변경: sales_channel 컬럼 분리. store_id는 실제 판매사 (뉴스엔진뜰 등), sales_channel은 채널(phone/group/null)

ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_channel TEXT;

-- 기존 데이터 백필
UPDATE orders SET sales_channel = 'phone'
WHERE sales_channel IS NULL
  AND store_id IN (SELECT id FROM stores WHERE name = '전화주문');

UPDATE orders SET sales_channel = 'group'
WHERE sales_channel IS NULL
  AND store_id IN (SELECT id FROM stores WHERE name = '공구주문');

CREATE INDEX IF NOT EXISTS idx_orders_sales_channel
  ON orders(sales_channel)
  WHERE sales_channel IS NOT NULL;
