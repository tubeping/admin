-- 판매처별 고유 조회 링크용 토큰
ALTER TABLE phone_order_clients
ADD COLUMN IF NOT EXISTS view_token TEXT UNIQUE;

-- 기존 판매처에 토큰 자동 생성
UPDATE phone_order_clients
SET view_token = encode(gen_random_bytes(4), 'hex')
WHERE view_token IS NULL;

-- 새 판매처 생성 시 자동 토큰 부여 (8자)
CREATE OR REPLACE FUNCTION set_default_view_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.view_token IS NULL THEN
    NEW.view_token := encode(gen_random_bytes(4), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_view_token ON phone_order_clients;
CREATE TRIGGER trg_set_view_token
  BEFORE INSERT ON phone_order_clients
  FOR EACH ROW
  EXECUTE FUNCTION set_default_view_token();
