-- 전화주문 관리 테이블
-- 스프레드시트 기반 전화주문을 시스템화

-- ============================================================
-- 1. phone_order_clients (전화주문 고객사/판매처)
-- ============================================================
CREATE TABLE IF NOT EXISTS phone_order_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,                    -- 판매처명 (뉴스엔진, 정상산tv 등)
  contact_name TEXT,                            -- 담당자명
  phone TEXT,                                   -- 연락처
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'active',        -- active/inactive
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. phone_orders (전화주문)
-- ============================================================
CREATE TABLE IF NOT EXISTS phone_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,             -- 주문번호 (TEL-20260520-001)
  client_id UUID NOT NULL REFERENCES phone_order_clients(id),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- 상품 정보
  product_name TEXT NOT NULL,
  option_text TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,

  -- 가격
  unit_price INTEGER NOT NULL DEFAULT 0,         -- 단가
  total_amount INTEGER NOT NULL DEFAULT 0,       -- 총 금액 (unit_price × quantity)

  -- 입금 정보
  depositor_name TEXT,                           -- 입금자명
  payment_status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid(미입금)/paid(입금확인)
  paid_at TIMESTAMPTZ,

  -- 수령인 정보
  recipient_name TEXT NOT NULL,                  -- 수령인
  recipient_phone TEXT,                          -- 수령인 전화번호
  recipient_zipcode TEXT,                        -- 수령인 우편번호
  recipient_address TEXT,                        -- 수령인 주소
  delivery_message TEXT,                         -- 배송 메시지

  -- 배송 정보
  shipping_company TEXT,                         -- 배송업체
  tracking_number TEXT,                          -- 운송장번호
  shipped_at TIMESTAMPTZ,                        -- 출고일

  -- 상태
  status TEXT NOT NULL DEFAULT 'pending',        -- pending(접수)/confirmed(확정)/shipping(배송중)/delivered(배송완료)/cancelled(취소)

  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 주문번호 자동 생성 함수
-- ============================================================
CREATE OR REPLACE FUNCTION generate_phone_order_number(order_dt DATE DEFAULT CURRENT_DATE)
RETURNS TEXT AS $$
DECLARE
  date_str TEXT;
  next_seq INTEGER;
BEGIN
  date_str := TO_CHAR(order_dt, 'YYYYMMDD');

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_number FROM LENGTH('TEL-' || date_str || '-') + 1) AS INTEGER)
  ), 0) + 1
  INTO next_seq
  FROM phone_orders
  WHERE order_number LIKE 'TEL-' || date_str || '-%';

  RETURN 'TEL-' || date_str || '-' || LPAD(next_seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. 트리거
-- ============================================================
CREATE TRIGGER phone_order_clients_updated_at
  BEFORE UPDATE ON phone_order_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER phone_orders_updated_at
  BEFORE UPDATE ON phone_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 5. 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_phone_order_clients_status ON phone_order_clients(status);
CREATE INDEX IF NOT EXISTS idx_phone_orders_client_id ON phone_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_phone_orders_order_date ON phone_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_phone_orders_status ON phone_orders(status);
CREATE INDEX IF NOT EXISTS idx_phone_orders_payment_status ON phone_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_phone_orders_recipient_name ON phone_orders(recipient_name);

-- ============================================================
-- 6. RLS
-- ============================================================
ALTER TABLE phone_order_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on phone_order_clients"
  ON phone_order_clients FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on phone_orders"
  ON phone_orders FOR ALL USING (true) WITH CHECK (true);
