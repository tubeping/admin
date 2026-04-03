-- CS 채널 계정 관리 (네이버톡톡, 카카오 상담톡 등)
-- 각 계정별 인증 정보를 저장하여 멀티 계정 연동 지원

CREATE TABLE IF NOT EXISTS cs_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES stores(id),                     -- 연결된 카페24 스토어 (optional)

  -- 채널 정보
  channel_type TEXT NOT NULL,                               -- naver_talk / kakao / channeltalk
  name TEXT NOT NULL,                                       -- 표시 이름 (예: "신산 네이버톡톡")
  account_id TEXT,                                          -- 채널 계정 식별자 (네이버 파트너ID 등)

  -- 인증
  auth_key TEXT,                                            -- Authorization 키
  webhook_url TEXT,                                         -- 웹훅 수신 URL (자동 생성)
  webhook_secret TEXT,                                      -- 웹훅 검증 시크릿

  -- 상태
  status TEXT NOT NULL DEFAULT 'pending',                   -- pending / active / error / paused
  last_event_at TIMESTAMPTZ,                                -- 마지막 이벤트 수신 시각
  total_chats INTEGER NOT NULL DEFAULT 0,                   -- 누적 대화 수

  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 트리거
CREATE TRIGGER cs_channels_updated_at
  BEFORE UPDATE ON cs_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_cs_channels_type ON cs_channels(channel_type);
CREATE INDEX IF NOT EXISTS idx_cs_channels_status ON cs_channels(status);
CREATE INDEX IF NOT EXISTS idx_cs_channels_store_id ON cs_channels(store_id);

-- RLS
ALTER TABLE cs_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on cs_channels"
  ON cs_channels FOR ALL USING (true) WITH CHECK (true);

-- cs_tickets에 cs_channel_id 컬럼 추가 (어느 CS채널에서 온 문의인지)
ALTER TABLE cs_tickets ADD COLUMN IF NOT EXISTS cs_channel_id UUID REFERENCES cs_channels(id);
CREATE INDEX IF NOT EXISTS idx_cs_tickets_cs_channel_id ON cs_tickets(cs_channel_id);
