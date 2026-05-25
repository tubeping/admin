-- 007_fulfillment_warehouse.sql
-- 사입 상품의 창고발주 지원
--
-- 배경: 일부 상품은 공급사(예: 에스엘로하스)에서 사입해 자체 창고(이음로직스)에
-- 재고로 보유. 이 경우 주문이 들어오면 원 공급사가 아닌 창고로 발주가 나가야 함.
--
-- 설계: products 테이블에 fulfillment_warehouse_supplier_id 컬럼 추가
--   - NULL  → 직배송 (tp_code 기반 원 공급사가 출고)
--   - SET   → 지정된 창고 공급사(예: 이음로직스)가 출고
--
-- 창고도 suppliers 테이블에 하나의 row로 등록 (short_code 할당, po_config 설정 가능)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fulfillment_warehouse_supplier_id UUID
    REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_fulfillment_warehouse
  ON products(fulfillment_warehouse_supplier_id)
  WHERE fulfillment_warehouse_supplier_id IS NOT NULL;

COMMENT ON COLUMN products.fulfillment_warehouse_supplier_id IS
  '사입 상품의 출고 창고 (NULL이면 tp_code 기반 원 공급사가 직접 출고)';
