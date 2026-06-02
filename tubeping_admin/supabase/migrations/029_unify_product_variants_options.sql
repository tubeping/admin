-- 028 product_variants + product_options dual-write 준비
--
-- 안전 모드:
--   - product_options 테이블은 DROP/VIEW 전환 없이 그대로 유지 (정산/seller-portal 영향 0)
--   - product_variants에 옵션 가격 컬럼만 추가
--   - 기존 product_options 데이터를 variants에 1회 카피 (검증용)
--   - 양쪽 동기화는 코드 레벨 dual-write (라우트에서 처리)
--   - UNIQUE index는 보류 (충돌 위험 차단, Phase 2에서 도입)

-- ─────────────────────────────────────────────
-- 1. product_variants 확장
--    DEFAULT 0/NULL이라 기존 데이터에 영향 없음
-- ─────────────────────────────────────────────
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS option_text TEXT,
  ADD COLUMN IF NOT EXISTS supply_price INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retail_price INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supply_shipping_fee INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_type TEXT NOT NULL DEFAULT '과세';

-- ─────────────────────────────────────────────
-- 2. option_text 백필
--    "옵션명=옵션값" 형식. 카페24 variant.options 텍스트 합치기와 동일.
-- ─────────────────────────────────────────────
UPDATE product_variants
SET option_text = NULLIF(TRIM(COALESCE(option_name, '') || '=' || COALESCE(option_value, '')), '=')
WHERE option_text IS NULL OR option_text = '';

-- ─────────────────────────────────────────────
-- 3. product_options → product_variants 1회 카피 (검증용)
--    product_options 테이블은 그대로 유지. 정산은 옛 테이블 그대로 SELECT.
--    이 카피는 새 sync 로직이 variants에서 supply_price를 참조할 수 있도록 채우는 용.
--    매칭 실패한 옵션은 variants에 별도 행으로 추가되지 않음 (정산 영향 차단).
--    → product_options에만 있는 옵션은 정산이 옛 테이블에서 그대로 봄.
-- ─────────────────────────────────────────────

-- 3-1. variant_code 일치 행에 옵션 가격 채우기
UPDATE product_variants v
SET
  supply_price = po.supply_price,
  retail_price = CASE WHEN v.retail_price > 0 THEN v.retail_price ELSE po.retail_price END,
  supply_shipping_fee = po.supply_shipping_fee,
  tax_type = po.tax_type
FROM product_options po
WHERE v.product_id = po.product_id
  AND v.variant_code IS NOT NULL
  AND v.variant_code = po.variant_code;

-- 3-2. option_text 일치 행에 옵션 가격 채우기 (variant_code 매칭 안 된 것 보강)
UPDATE product_variants v
SET
  supply_price = po.supply_price,
  retail_price = CASE WHEN v.retail_price > 0 THEN v.retail_price ELSE po.retail_price END,
  supply_shipping_fee = po.supply_shipping_fee,
  tax_type = po.tax_type,
  variant_code = COALESCE(v.variant_code, po.variant_code)
FROM product_options po
WHERE v.product_id = po.product_id
  AND v.option_text = po.option_text
  AND v.supply_price = 0
  AND po.supply_price > 0;

-- 주의: product_options에만 있는 옵션은 의도적으로 variants에 insert하지 않음.
--       정산은 그것을 옛 product_options 테이블에서 그대로 본다 (영향 0).
--       Phase 2에서 데이터 일치율 검증 후 통합 결정.

-- ─────────────────────────────────────────────
-- 4. 인덱스 (조회용. UNIQUE 아님)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_variants_option_text
  ON product_variants(product_id, option_text)
  WHERE option_text IS NOT NULL AND option_text != '';

CREATE INDEX IF NOT EXISTS idx_variants_variant_code
  ON product_variants(product_id, variant_code)
  WHERE variant_code IS NOT NULL;

-- ─────────────────────────────────────────────
-- 5. 검증용 진단 view (read-only, 운영 영향 0)
--    product_options와 product_variants의 일치/불일치 상태를 한눈에 보기 위한 뷰.
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_options_variants_diff AS
SELECT
  COALESCE(v.product_id, po.product_id) AS product_id,
  COALESCE(v.option_text, po.option_text) AS option_text,
  v.id AS variant_id,
  po.id AS option_id,
  v.supply_price AS v_supply_price,
  po.supply_price AS po_supply_price,
  v.retail_price AS v_retail_price,
  po.retail_price AS po_retail_price,
  CASE
    WHEN v.id IS NULL THEN 'options_only'
    WHEN po.id IS NULL THEN 'variants_only'
    WHEN v.supply_price = po.supply_price AND v.retail_price = po.retail_price THEN 'match'
    ELSE 'price_diff'
  END AS status
FROM product_variants v
FULL OUTER JOIN product_options po
  ON v.product_id = po.product_id
  AND v.option_text = po.option_text
WHERE COALESCE(v.option_text, po.option_text) IS NOT NULL;

COMMENT ON VIEW v_options_variants_diff IS
  '028 적용 후 product_options ↔ product_variants 데이터 정합성 확인용. SELECT status, COUNT(*) FROM v_options_variants_diff GROUP BY status;';
