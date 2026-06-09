-- 031. 공급사 코드 접두사 + 판매사몰 가격 레이어
-- 상품관리 개편: (1) 마스터(공급사) 상품코드를 '공급사명_TP…' 로,
--                (2) 판매사 자사몰별 판매가·배송비를 product_cafe24_mappings 에 오버레이.
-- Supabase Dashboard → SQL Editor 또는 서비스 DB psql 에서 실행.
-- 선행: 001_products.sql, 002_orders.sql

-- ============================================================
-- 1. products — 공급사 배송비 컬럼 (정산 supMap/prodMap 이 이미 supply_shipping_fee 를 읽음)
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS supply_shipping_fee INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 2. product_cafe24_mappings — 판매사(자사몰)별 판매가·배송비·코드 레이어
--    한 상품(products) × 판매사몰(store) 매핑 행에 그 판매사의 실제 판매정보를 오버레이.
-- ============================================================
ALTER TABLE product_cafe24_mappings
  ADD COLUMN IF NOT EXISTS seller_price INTEGER,             -- 판매사 판매가 (자사몰 price)
  ADD COLUMN IF NOT EXISTS seller_shipping_fee INTEGER,      -- 판매사 배송비 (shipping_rates)
  ADD COLUMN IF NOT EXISTS seller_product_code TEXT,         -- 표시용 '판매사명_코어' (예: 코믹마트_TPCZ00872)
  ADD COLUMN IF NOT EXISTS seller_synced_at TIMESTAMPTZ;     -- 판매사몰에서 가져온 시각

-- ============================================================
-- 3. 데이터 마이그레이션 — 마스터 상품 tp_code 를 '공급사명_' 접두사화 (되돌리기 가능)
--    공급사가 있고 아직 접두사가 없는(언더바 없는) 상품만 대상. 코어가 유일하므로 접두사 후에도 유일.
--    복구: UPDATE products SET tp_code = split_part(tp_code,'_',array_length(...)) — 즉 마지막 '_' 뒤만 남기면 됨.
--    ⚠️ 실행 전 products(id, tp_code, supplier) CSV 백업 필수.
-- ============================================================
UPDATE products
   SET tp_code = supplier || '_' || tp_code
 WHERE supplier IS NOT NULL
   AND btrim(supplier) <> ''
   AND supplier <> '-'
   AND position('_' in tp_code) = 0;

-- 인덱스(tp_code 는 001 에서 이미 UNIQUE + idx). 판매사 코드 조회용 보조 인덱스.
CREATE INDEX IF NOT EXISTS idx_mappings_seller_code ON product_cafe24_mappings(seller_product_code);
