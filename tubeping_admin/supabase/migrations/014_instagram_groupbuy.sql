-- TubePing 인스타 공동구매 DM 트래킹
-- 인플루언서에게 보낸 공구 제안 DM 관리

CREATE TABLE IF NOT EXISTS instagram_groupbuy_outreach (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ig_username TEXT NOT NULL,
  ig_url TEXT,
  ig_full_name TEXT,
  followers INTEGER,
  category TEXT,
  product_name TEXT NOT NULL,
  product_brand TEXT,
  proposed_margin TEXT,
  dm_content TEXT,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replied_at TIMESTAMPTZ,
  reply_content TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  campaign_date DATE,
  agreed_margin TEXT,
  sales_amount NUMERIC,
  assigned_to TEXT,
  memo TEXT,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_groupbuy_username ON instagram_groupbuy_outreach(ig_username);
CREATE INDEX IF NOT EXISTS idx_ig_groupbuy_status ON instagram_groupbuy_outreach(status);
CREATE INDEX IF NOT EXISTS idx_ig_groupbuy_proposed_at ON instagram_groupbuy_outreach(proposed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_groupbuy_product ON instagram_groupbuy_outreach(product_name);

CREATE TRIGGER ig_groupbuy_updated_at
  BEFORE UPDATE ON instagram_groupbuy_outreach
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE instagram_groupbuy_outreach ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on instagram_groupbuy_outreach"
  ON instagram_groupbuy_outreach FOR ALL USING (true) WITH CHECK (true);
