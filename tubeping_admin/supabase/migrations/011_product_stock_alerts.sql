-- 011_product_stock_alerts.sql
-- 공급사 품절/재입고 알림 (Gmail 자동 수집 + 수동 입력)

CREATE TABLE IF NOT EXISTS product_stock_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'out_of_stock',  -- out_of_stock / restock / discontinued / price_change
  product_names TEXT[] DEFAULT '{}',                 -- 공급사 메일에 언급된 상품명 리스트
  option_info TEXT,                                  -- 옵션 상세 (있을 경우)
  effective_from DATE,                               -- 품절/재입고 시작일
  effective_to DATE,                                 -- 재고 회복 예정일 (있을 경우)
  title TEXT NOT NULL,
  detail TEXT,
  matched_product_ids UUID[] DEFAULT '{}',           -- products 테이블 매칭 결과
  status TEXT NOT NULL DEFAULT 'pending',            -- pending / applied / ignored
  source TEXT NOT NULL DEFAULT 'manual',             -- manual / gmail
  source_ref TEXT,                                   -- gmail thread id
  applied_at TIMESTAMPTZ,
  applied_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_alerts_status ON product_stock_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_supplier ON product_stock_alerts(supplier_id);

-- 중복 방지 (같은 source_ref는 한 번만)
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_alerts_unique_source
  ON product_stock_alerts(source_ref)
  WHERE source_ref IS NOT NULL;
