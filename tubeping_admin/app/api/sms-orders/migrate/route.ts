import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env.server";

/**
 * POST /api/sms-orders/migrate
 * 문자주문 테이블 생성 마이그레이션 (일회용)
 * Supabase Management API를 사용하여 SQL 실행
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectRef = "ypyhlrsuqkigwlpwhurf";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  // SQL migration
  const sql = `
-- 문자주문 관리 테이블
-- sms_raw_messages (수신 원본 문자)
CREATE TABLE IF NOT EXISTS sms_raw_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_phone TEXT NOT NULL,
  receiver_phone TEXT NOT NULL DEFAULT '070-7706-7778',
  raw_text TEXT NOT NULL,
  forwarded_text TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parsed_at TIMESTAMPTZ,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_result JSONB,
  sms_order_id UUID,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- sms_orders (문자주문)
CREATE TABLE IF NOT EXISTS sms_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  raw_message_id UUID REFERENCES sms_raw_messages(id),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  product_name TEXT NOT NULL,
  option_text TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  orderer_name TEXT,
  orderer_phone TEXT,
  depositor_name TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  paid_at TIMESTAMPTZ,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT,
  recipient_zipcode TEXT,
  recipient_address TEXT,
  delivery_message TEXT,
  shipping_company TEXT,
  tracking_number TEXT,
  shipped_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  parse_confidence TEXT DEFAULT 'low',
  needs_review BOOLEAN DEFAULT true,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 주문번호 자동 생성 함수
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

-- 트리거
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sms_raw_messages_updated_at') THEN
    CREATE TRIGGER sms_raw_messages_updated_at
      BEFORE UPDATE ON sms_raw_messages
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sms_orders_updated_at') THEN
    CREATE TRIGGER sms_orders_updated_at
      BEFORE UPDATE ON sms_orders
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sms_raw_messages_parse_status ON sms_raw_messages(parse_status);
CREATE INDEX IF NOT EXISTS idx_sms_raw_messages_sender_phone ON sms_raw_messages(sender_phone);
CREATE INDEX IF NOT EXISTS idx_sms_raw_messages_received_at ON sms_raw_messages(received_at);
CREATE INDEX IF NOT EXISTS idx_sms_orders_order_date ON sms_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_sms_orders_status ON sms_orders(status);
CREATE INDEX IF NOT EXISTS idx_sms_orders_payment_status ON sms_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_sms_orders_recipient_name ON sms_orders(recipient_name);
CREATE INDEX IF NOT EXISTS idx_sms_orders_raw_message_id ON sms_orders(raw_message_id);

-- RLS
ALTER TABLE sms_raw_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on sms_raw_messages') THEN
    CREATE POLICY "Service role full access on sms_raw_messages"
      ON sms_raw_messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on sms_orders') THEN
    CREATE POLICY "Service role full access on sms_orders"
      ON sms_orders FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
`;

  // Execute via Supabase's internal SQL execution
  // Method: Use the postgrest rpc or direct database connection
  try {
    // Try using the Supabase Management API
    const mgmtRes = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ query: sql }),
      }
    );

    if (mgmtRes.ok) {
      const data = await mgmtRes.json();
      return NextResponse.json({ success: true, method: "management-api", data });
    }

    // If management API doesn't work, return the SQL for manual execution
    return NextResponse.json({
      success: false,
      message: "Management API 접근 불가 - SQL Editor에서 수동 실행 필요",
      sql_url: `https://supabase.com/dashboard/project/${projectRef}/sql`,
      sql,
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: String(e),
      message: "SQL을 Supabase SQL Editor에서 직접 실행해주세요",
      sql_url: `https://supabase.com/dashboard/project/${projectRef}/sql`,
      sql,
    });
  }
}
