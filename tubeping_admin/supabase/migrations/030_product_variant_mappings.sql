-- 029 product_variant_cafe24_mappings + category_mappings
--
-- 목적:
--   - 옵션별로 자식 카페24의 variant_code를 (admin_variant_id, store_id) PK로 안정 매핑
--   - 자식 카페24 간 variant_code 우연 중복도 안전하게 식별
--   - 카테고리 매핑 테이블 신설 (UI는 Phase 2, 우선 스키마만)
--
-- 안전성: 신규 테이블만 추가. 기존 테이블 영향 0.

-- ─────────────────────────────────────────────
-- 1. product_variant_cafe24_mappings
--    옵션 단위로 자식 카페24의 variant_code를 자동 매핑
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variant_cafe24_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cafe24_variant_code TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (admin_variant_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_pvcm_store_id
  ON product_variant_cafe24_mappings(store_id);

CREATE INDEX IF NOT EXISTS idx_pvcm_admin_variant_id
  ON product_variant_cafe24_mappings(admin_variant_id);

-- 자식 카페24 안에서 variant_code 조회용 (sync 로직)
CREATE INDEX IF NOT EXISTS idx_pvcm_store_variant_code
  ON product_variant_cafe24_mappings(store_id, cafe24_variant_code);

DROP TRIGGER IF EXISTS product_variant_cafe24_mappings_updated_at ON product_variant_cafe24_mappings;
CREATE TRIGGER product_variant_cafe24_mappings_updated_at
  BEFORE UPDATE ON product_variant_cafe24_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE product_variant_cafe24_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on pvcm" ON product_variant_cafe24_mappings;
CREATE POLICY "Service role full access on pvcm"
  ON product_variant_cafe24_mappings FOR ALL
  USING (true) WITH CHECK (true);

COMMENT ON TABLE product_variant_cafe24_mappings IS
  '옵션 단위 카페24 variant_code 매핑. propagate/sync 시 자동 생성·갱신. 사용자 수동 편집 불필요.';

-- ─────────────────────────────────────────────
-- 2. category_mappings (Phase 2: UI는 나중, 스키마만 선반영)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS category_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_category TEXT NOT NULL,            -- products.category 값
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cafe24_category_no INTEGER NOT NULL,     -- 자식 mall의 카테고리 번호
  cafe24_category_name TEXT,               -- 표시용
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (admin_category, store_id)
);

CREATE INDEX IF NOT EXISTS idx_category_mappings_store
  ON category_mappings(store_id);

DROP TRIGGER IF EXISTS category_mappings_updated_at ON category_mappings;
CREATE TRIGGER category_mappings_updated_at
  BEFORE UPDATE ON category_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE category_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on category_mappings" ON category_mappings;
CREATE POLICY "Service role full access on category_mappings"
  ON category_mappings FOR ALL
  USING (true) WITH CHECK (true);

COMMENT ON TABLE category_mappings IS
  'admin 카테고리 ↔ 자식 카페24 카테고리 번호 매핑. UI는 Phase 2에서 도입.';
