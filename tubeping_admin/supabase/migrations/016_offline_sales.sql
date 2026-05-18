-- 오프라인 납품 관리 테이블
-- 선행: 001_products.sql (products 테이블 필요)

-- ============================================================
-- 1. offline_clients (오프라인 거래처)
-- ============================================================
CREATE TABLE IF NOT EXISTS offline_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,                          -- 거래처명 (매장명)
  contact_name TEXT,                           -- 담당자명
  phone TEXT,                                  -- 연락처
  address TEXT,                                -- 주소
  business_no TEXT,                            -- 사업자번호
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'active',       -- active/inactive
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. offline_orders (오프라인 납품 주문)
-- ============================================================
CREATE TABLE IF NOT EXISTS offline_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,            -- 납품번호 (OFF-20260518-001)
  client_id UUID NOT NULL REFERENCES offline_clients(id),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- 상품 정보
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  option_text TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,

  -- 가격
  purchase_price INTEGER NOT NULL DEFAULT 0,    -- 매입가 (제조사에서 사입 가격)
  supply_price INTEGER NOT NULL DEFAULT 0,      -- 공급가 (거래처에 납품 가격, 마진 포함)
  total_amount INTEGER NOT NULL DEFAULT 0,      -- 총 납품 금액 (supply_price × quantity)

  -- 배송
  shipping_method TEXT DEFAULT 'courier',       -- courier(택배) / freight(용달)
  shipping_company TEXT,                        -- 택배사 / 용달 업체
  tracking_number TEXT,                         -- 송장번호
  shipping_cost INTEGER NOT NULL DEFAULT 0,     -- 배송비
  shipped_at TIMESTAMPTZ,                       -- 출고일

  -- 상태
  status TEXT NOT NULL DEFAULT 'pending',       -- pending(대기)/confirmed(확정)/shipped(출고)/delivered(납품완료)/cancelled(취소)

  -- 정산
  payment_status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid/paid
  paid_at TIMESTAMPTZ,

  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 납품번호 자동 생성 함수
-- ============================================================
CREATE OR REPLACE FUNCTION generate_offline_order_number(order_dt DATE DEFAULT CURRENT_DATE)
RETURNS TEXT AS $$
DECLARE
  date_str TEXT;
  next_seq INTEGER;
BEGIN
  date_str := TO_CHAR(order_dt, 'YYYYMMDD');

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_number FROM LENGTH('OFF-' || date_str || '-') + 1) AS INTEGER)
  ), 0) + 1
  INTO next_seq
  FROM offline_orders
  WHERE order_number LIKE 'OFF-' || date_str || '-%';

  RETURN 'OFF-' || date_str || '-' || LPAD(next_seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. 트리거
-- ============================================================
CREATE TRIGGER offline_clients_updated_at
  BEFORE UPDATE ON offline_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER offline_orders_updated_at
  BEFORE UPDATE ON offline_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 5. 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_offline_clients_status ON offline_clients(status);
CREATE INDEX IF NOT EXISTS idx_offline_orders_client_id ON offline_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_offline_orders_product_id ON offline_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_offline_orders_order_date ON offline_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_offline_orders_status ON offline_orders(status);
CREATE INDEX IF NOT EXISTS idx_offline_orders_payment_status ON offline_orders(payment_status);

-- ============================================================
-- 6. RLS
-- ============================================================
ALTER TABLE offline_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on offline_clients"
  ON offline_clients FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on offline_orders"
  ON offline_orders FOR ALL USING (true) WITH CHECK (true);
