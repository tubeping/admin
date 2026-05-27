-- ============================================================
-- 024_settlement_share_token.sql — 판매사 정산 확인 포털
-- ============================================================

-- 1. settlements 테이블 확장
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS seller_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS seller_confirmed_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS seller_confirmed_ip TEXT;

-- 2. 자동 토큰 생성 트리거
CREATE OR REPLACE FUNCTION set_settlement_share_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.share_token IS NULL THEN
    NEW.share_token := encode(gen_random_bytes(8), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_settlement_share_token ON settlements;
CREATE TRIGGER trg_set_settlement_share_token
  BEFORE INSERT ON settlements
  FOR EACH ROW
  EXECUTE FUNCTION set_settlement_share_token();

-- 3. 기존 정산에 토큰 부여
UPDATE settlements SET share_token = encode(gen_random_bytes(8), 'hex')
WHERE share_token IS NULL;

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_settlements_share_token ON settlements(share_token);
