-- 문자주문 관리 테이블
-- 안드로이드 폰에서 수신된 SMS를 파싱하여 주문 관리

-- ============================================================
-- 1. sms_raw_messages (수신 원본 문자)
-- ============================================================
CREATE TABLE IF NOT EXISTS sms_raw_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_phone TEXT NOT NULL,              -- 발신번호 (고객 전화번호)
  receiver_phone TEXT NOT NULL DEFAULT '070-7706-7778', -- 수신번호 (KT 인터넷전화)
  raw_text TEXT NOT NULL,                  -- 원본 문자 내용
  forwarded_text TEXT,                     -- 통화매니저가 전달한 전체 텍스트
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- 문자 수신 시각
  parsed_at TIMESTAMPTZ,                   -- 파싱 완료 시각
  parse_status TEXT NOT NULL DEFAULT 'pending', -- pending/parsed/failed/ignored
  parse_result JSONB,                      -- 파싱 결과 (JSON)
  sms_order_id UUID,                       -- 생성된 주문 ID (파싱 후 연결)
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. sms_orders (문자주문)
-- ============================================================
CREATE TABLE IF NOT EXISTS sms_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,             -- 주문번호 (SMS-20260522-001)
  raw_message_id UUID REFERENCES sms_raw_messages(id), -- 원본 문자 참조
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- 상품 정보
  product_name TEXT NOT NULL,
  option_text TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,

  -- 가격
  unit_price INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,

  -- 주문자/입금 정보
  orderer_name TEXT,                             -- 주문자명 (문자 발신자)
  orderer_phone TEXT,                            -- 주문자 전화번호
  depositor_name TEXT,                           -- 입금자명
  payment_status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid/paid
  paid_at TIMESTAMPTZ,

  -- 수령인 정보
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT,
  recipient_zipcode TEXT,
  recipient_address TEXT,
  delivery_message TEXT,

  -- 배송 정보
  shipping_company TEXT,
  tracking_number TEXT,
  shipped_at TIMESTAMPTZ,

  -- 상태
  status TEXT NOT NULL DEFAULT 'pending',        -- pending/confirmed/transferred/cancelled

  -- 파싱 신뢰도
  parse_confidence TEXT DEFAULT 'low',           -- low/medium/high
  needs_review BOOLEAN DEFAULT true,             -- 사람 확인 필요 여부

  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 주문번호 자동 생성 함수
-- ============================================================
CREATE OR REPLACE FUNCTION generate_sms_order_number(order_dt DATE DEFAULT CURRENT_DATE)
RETURNS TEXT AS $$
DECLARE
  date_str TEXT;
  next_seq INTEGER;
BEGIN
  date_str := TO_CHAR(order_dt, 'YYYYMMDD');

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_number FROM LENGTH('SMS-' || date_str || '-') + 1) AS INTEGER)
  ), 0) + 1
  INTO next_seq
  FROM sms_orders
  WHERE order_number LIKE 'SMS-' || date_str || '-%';

  RETURN 'SMS-' || date_str || '-' || LPAD(next_seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. 트리거
-- ============================================================
CREATE TRIGGER sms_raw_messages_updated_at
  BEFORE UPDATE ON sms_raw_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sms_orders_updated_at
  BEFORE UPDATE ON sms_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 5. 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sms_raw_messages_parse_status ON sms_raw_messages(parse_status);
CREATE INDEX IF NOT EXISTS idx_sms_raw_messages_sender_phone ON sms_raw_messages(sender_phone);
CREATE INDEX IF NOT EXISTS idx_sms_raw_messages_received_at ON sms_raw_messages(received_at);
CREATE INDEX IF NOT EXISTS idx_sms_orders_order_date ON sms_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_sms_orders_status ON sms_orders(status);
CREATE INDEX IF NOT EXISTS idx_sms_orders_payment_status ON sms_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_sms_orders_recipient_name ON sms_orders(recipient_name);
CREATE INDEX IF NOT EXISTS idx_sms_orders_raw_message_id ON sms_orders(raw_message_id);

-- ============================================================
-- 6. RLS
-- ============================================================
ALTER TABLE sms_raw_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on sms_raw_messages"
  ON sms_raw_messages FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on sms_orders"
  ON sms_orders FOR ALL USING (true) WITH CHECK (true);
