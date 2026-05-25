-- 008_payment_logs.sql
-- 입금확인 이력 — 자동/수동 입금확인 흔적 보관

CREATE TABLE IF NOT EXISTS payment_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  depositor_name TEXT NOT NULL,
  amount INTEGER DEFAULT 0,
  sms_text TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched',    -- unmatched / confirmed
  matched_order_ids UUID[] DEFAULT '{}',
  cafe24_synced INTEGER DEFAULT 0,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_logs_created ON payment_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_logs_status ON payment_logs(status);
