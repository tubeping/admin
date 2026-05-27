-- 022 product_options
-- 옵션별 공급가 + 판매가 관리 테이블
-- 정산/주문 enrichment에서 옵션 단위로 가격 조회
-- Supabase Dashboard → SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS product_options (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,                       -- 카페24 옵션 텍스트 (예: "선택=오리지날 1팩")
  supply_price INTEGER NOT NULL DEFAULT 0,         -- 옵션별 공급가 (수동)
  retail_price INTEGER NOT NULL DEFAULT 0,         -- 옵션별 판매가 (수동 가능, 0이면 orders/products.price fallback)
  supply_shipping_fee INTEGER NOT NULL DEFAULT 0,  -- 옵션별 공급배송비
  tax_type TEXT NOT NULL DEFAULT '과세',           -- 과세 / 면세
  variant_code TEXT,                                -- 카페24 variant_code (자동 불러오기 시)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, option_text)
);

CREATE INDEX IF NOT EXISTS idx_product_options_product_id ON product_options(product_id);
CREATE INDEX IF NOT EXISTS idx_product_options_option_text ON product_options(option_text);

CREATE TRIGGER product_options_updated_at
  BEFORE UPDATE ON product_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE product_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on product_options"
  ON product_options FOR ALL
  USING (true) WITH CHECK (true);
