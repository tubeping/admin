-- 010_supplier_holidays.sql
-- 공급사 휴무/배송 일정 캘린더

CREATE TABLE IF NOT EXISTS supplier_holidays (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  type TEXT NOT NULL DEFAULT 'holiday',       -- holiday / delay / notice
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL DEFAULT 'manual',      -- manual / gmail
  source_ref TEXT,                            -- gmail thread id 등
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_holidays_date ON supplier_holidays(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_supplier_holidays_supplier ON supplier_holidays(supplier_id);

-- 중복 방지: 같은 공급사, 같은 기간, 같은 출처는 한 번만
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_holidays_unique
  ON supplier_holidays(supplier_id, date_from, date_to, source_ref)
  WHERE source_ref IS NOT NULL;
