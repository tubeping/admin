-- ============================================================
-- 030_settlement_model.sql — 정산 모델 일반화 (자사몰형 / 공동구매형)
-- ============================================================
-- 기존 정산은 전부 'platform'(자사몰형): 신산이 고객결제 수취 → 비용 차감 →
-- 순익을 인플루언서/회사로 분배.
--
-- 'wholesale'(공동구매형): 판매사(예: 망넛이네)가 고객결제를 직접 수취하고,
-- 신산은 "공급자" 입장에서 공급대금만 청구한다.
--   신산 수취액 = Σ(공급가×수량) + 공급배송비 + 부가세(과세분 10% 별도)
--   → PG수수료·순익·70:30 분배·인플루언서 지급 개념 없음.
--
-- 코드는 컬럼이 없어도 'platform'으로 동작하도록 짜여 있으나,
-- 이 마이그레이션을 적용해야 wholesale 정산서가 정상 계산/표시된다.

-- 판매사(스토어)별 정산 모델
ALTER TABLE stores ADD COLUMN IF NOT EXISTS settlement_model TEXT NOT NULL DEFAULT 'platform';
COMMENT ON COLUMN stores.settlement_model IS 'platform=자사몰형(순익 분배) / wholesale=공동구매형(신산이 공급대금 청구)';

-- 정산서 스냅샷 (생성 시점 모델 + wholesale 신산 수취액)
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS settlement_model TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS supplier_payable INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN settlements.supplier_payable IS 'wholesale: 신산이 판매사에 청구하는 공급대금 합계(공급가+배송비+부가세). platform=0';

-- 망넛이네를 공동구매형으로 지정
UPDATE stores SET settlement_model = 'wholesale' WHERE name = '망넛이네';
