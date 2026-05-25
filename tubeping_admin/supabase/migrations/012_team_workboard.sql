-- ─────────────────────────────────────────────
-- 012_team_workboard.sql — 업무보드 (team / tasks / events / kakao)
-- ─────────────────────────────────────────────
-- 조직관리 > 업무보드 페이지에서 사용.
-- 카카오톡 채널 1:1 입력으로 카드 자동 생성하는 흐름까지 커버.
-- 회사 OKR(objectives/key_results)는 006_okrs.sql 그대로 재사용.
-- ─────────────────────────────────────────────

-- 1. 팀원 (사람 + 카카오 매핑)
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT,                              -- "편집" / "디자인" / "공급사" / "운영"
  emoji TEXT DEFAULT '👤',
  color TEXT DEFAULT 'sky',               -- sky/violet/emerald/amber/rose/gray

  -- 이번 주(또는 이번 달) 핵심 목표
  goal_text TEXT,                         -- "주 2회 영상 업로드"
  goal_target NUMERIC,                    -- 2
  goal_current NUMERIC DEFAULT 0,         -- 1
  goal_unit TEXT,                         -- "편" / "%" / "곳" / "만원"

  -- 카카오 매핑
  kakao_user_id TEXT UNIQUE,              -- 매핑 후 카카오 사용자 식별자
  kakao_link_code TEXT UNIQUE,            -- LINK-XXXX 발급 코드 (1회용)
  kakao_link_code_expires_at TIMESTAMPTZ, -- 코드 만료
  kakao_linked_at TIMESTAMPTZ,            -- 연결 완료 시각

  status TEXT DEFAULT 'active',           -- active / inactive
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_members_kakao_user ON team_members(kakao_user_id) WHERE kakao_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_link_code ON team_members(kakao_link_code) WHERE kakao_link_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_status ON team_members(status);

-- 2. 업무 카드
CREATE TABLE IF NOT EXISTS team_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date DATE,
  priority TEXT DEFAULT 'normal',         -- low / normal / high
  tag TEXT,                               -- "디자인" / "편집" / "미팅" / "발주" 등
  status TEXT DEFAULT 'doing',            -- doing / wait / block / done
  memo TEXT,
  block_reason TEXT,                      -- 블록 사유

  -- 입력 출처 추적
  source TEXT DEFAULT 'web',              -- web / kakao / telegram
  source_message_id TEXT,                 -- 카카오 메시지 ID 등 원본 추적

  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_tasks_member ON team_tasks(member_id);
CREATE INDEX IF NOT EXISTS idx_team_tasks_due ON team_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_team_tasks_status ON team_tasks(status);
CREATE INDEX IF NOT EXISTS idx_team_tasks_member_status ON team_tasks(member_id, status);

-- 3. 일정 (전사 마일스톤·미팅 등 — 캘린더 표시용)
CREATE TABLE IF NOT EXISTS team_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  end_date DATE,                          -- 다일 일정인 경우
  member_ids UUID[],                      -- 참여 멤버 (NULL이면 전사 일정)
  category TEXT,                          -- 라이브 / 미팅 / 마감 / 마일스톤
  color TEXT,                             -- 멤버 색 또는 카테고리 색
  is_milestone BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'scheduled',        -- scheduled / done / cancelled
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_events_date ON team_events(event_date);
CREATE INDEX IF NOT EXISTS idx_team_events_milestone ON team_events(is_milestone) WHERE is_milestone = true;

-- 4. 카카오 메시지 원본 로그 (디버깅·복구·감사 추적)
CREATE TABLE IF NOT EXISTS kakao_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kakao_user_id TEXT NOT NULL,
  member_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
  raw_text TEXT NOT NULL,                 -- 사용자가 보낸 원문
  parsed_intent TEXT,                     -- add / complete / list / block / postpone / link / unknown
  parsed_payload JSONB,                   -- Gemini 파싱 결과 전체
  resulting_task_id UUID REFERENCES team_tasks(id) ON DELETE SET NULL,
  bot_response TEXT,                      -- 봇이 사용자에게 응답한 텍스트
  ok BOOLEAN DEFAULT true,                -- 처리 성공 여부
  error_message TEXT,
  received_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kakao_messages_user ON kakao_messages(kakao_user_id);
CREATE INDEX IF NOT EXISTS idx_kakao_messages_received ON kakao_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_kakao_messages_member ON kakao_messages(member_id) WHERE member_id IS NOT NULL;

-- 5. updated_at 자동 갱신 (admin의 기존 update_updated_at() 함수 재사용)
DROP TRIGGER IF EXISTS trg_team_members_updated_at ON team_members;
CREATE TRIGGER trg_team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_team_tasks_updated_at ON team_tasks;
CREATE TRIGGER trg_team_tasks_updated_at
  BEFORE UPDATE ON team_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_team_events_updated_at ON team_events;
CREATE TRIGGER trg_team_events_updated_at
  BEFORE UPDATE ON team_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 6. 카드 완료 시 completed_at 자동 기록
CREATE OR REPLACE FUNCTION trg_team_tasks_set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at = now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_team_tasks_completed_at ON team_tasks;
CREATE TRIGGER trg_team_tasks_completed_at
  BEFORE UPDATE OF status ON team_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_team_tasks_set_completed_at();

-- 7. RLS (admin 기존 패턴: service role full access)
ALTER TABLE team_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kakao_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access team_members"
  ON team_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access team_tasks"
  ON team_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access team_events"
  ON team_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access kakao_messages"
  ON kakao_messages FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────
-- 시드: 비워둠. admin UI에서 첫 멤버(본인) 추가하면서 사용 시작.
-- ─────────────────────────────────────────────
