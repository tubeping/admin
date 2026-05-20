-- 공급사 정산 테이블: 공급사별 월간 정산 상태 추적
-- 플로우: draft(자료작성) → sent(자료전달) → confirmed(확인완료) → invoiced(세금계산서) → paid(지급완료)

CREATE TABLE IF NOT EXISTS supplier_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id),
  supplier_name TEXT NOT NULL,
  period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',

  -- 금액 집계
  total_supply INTEGER DEFAULT 0,
  total_shipping INTEGER DEFAULT 0,
  total_amount INTEGER DEFAULT 0,
  total_sales INTEGER DEFAULT 0,
  item_count INTEGER DEFAULT 0,
  total_quantity INTEGER DEFAULT 0,

  -- 상태 타임스탬프
  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  invoiced_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,

  -- 세금계산서 정보
  invoice_no TEXT,

  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(supplier_id, period)
);

CREATE INDEX IF NOT EXISTS idx_supplier_settlements_period ON supplier_settlements(period);
CREATE INDEX IF NOT EXISTS idx_supplier_settlements_status ON supplier_settlements(status);
CREATE INDEX IF NOT EXISTS idx_supplier_settlements_supplier ON supplier_settlements(supplier_id);

-- updated_at 자동 업데이트 트리거
CREATE TRIGGER set_supplier_settlements_updated_at
  BEFORE UPDATE ON supplier_settlements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE supplier_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON supplier_settlements FOR ALL USING (true) WITH CHECK (true);
