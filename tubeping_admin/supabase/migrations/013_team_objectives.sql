-- ─────────────────────────────────────────────
-- 013_team_objectives.sql — 업무관리 > 전사 진행사항
-- ─────────────────────────────────────────────
-- 목표(title) + 내용(description) + KPI 배열 + 진행사항 점검(checkins)
-- 기존 OKR(/system/okr)과 분리. 업무관리 페이지 전용 가벼운 운영 보드.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,                 -- "시스템 개발"
  description TEXT,                    -- "내용" — 줄바꿈 포함 자유 텍스트
  category TEXT,                       -- "시스템" / "운영" / "마케팅" / "신규" / "투자"
  status TEXT DEFAULT 'active',        -- active / done / archived
  emoji TEXT DEFAULT '🎯',
  color TEXT DEFAULT 'gray',           -- sky/violet/emerald/amber/rose/gray

  -- KPI 배열 [{ title, current, target, unit, note, status? }, ...]
  kpis JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- 진행사항 점검 메모 [{ note, checked_at, checked_by? }, ...]
  checkins JSONB NOT NULL DEFAULT '[]'::jsonb,

  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_objectives_status ON team_objectives(status);
CREATE INDEX IF NOT EXISTS idx_team_objectives_sort ON team_objectives(sort_order);

DROP TRIGGER IF EXISTS trg_team_objectives_updated_at ON team_objectives;
CREATE TRIGGER trg_team_objectives_updated_at
  BEFORE UPDATE ON team_objectives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE team_objectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access team_objectives"
  ON team_objectives FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────
-- 시드 — 사용자가 정의한 5개 목표
-- ─────────────────────────────────────────────
INSERT INTO team_objectives (title, description, category, emoji, color, sort_order, kpis) VALUES

('시스템 개발',
 '어드민 안정화 + tubeping builder MVP 완성 및 배포',
 '시스템', '⚙️', 'sky', 1,
 '[
   {"title":"어드민 P0/P1 버그 0건","current":0,"target":1,"unit":"달성","note":""},
   {"title":"tubeping builder MVP 배포","current":0,"target":1,"unit":"배포","note":""},
   {"title":"베타 입점 유튜버","current":0,"target":5,"unit":"명","note":""}
 ]'::jsonb),

('종합몰 운영',
 '월 매출 1천만원 이상 유튜버 최소 5개 이상 확보 및 운영 + 기존 유튜버 매출 확대',
 '운영', '🛒', 'emerald', 2,
 '[
   {"title":"월 매출 1천만+ 유튜버 채널","current":0,"target":5,"unit":"개","note":""},
   {"title":"기존 유튜버 월 매출 증가율","current":0,"target":30,"unit":"%","note":""},
   {"title":"종합몰 월 매출","current":0,"target":5000,"unit":"만원","note":""}
 ]'::jsonb),

('마케팅 대행',
 '초이스온 마케팅 대행 외 신규 클라이언트 발굴',
 '마케팅', '📣', 'violet', 3,
 '[
   {"title":"초이스온 계약 체결","current":0,"target":1,"unit":"건","note":""},
   {"title":"마케팅 대행 신규 클라이언트","current":0,"target":2,"unit":"개","note":""}
 ]'::jsonb),

('병원 마케팅 방향성 고민',
 '병원 마케팅 사업 방향성 정의 및 검증',
 '신규', '🏥', 'rose', 4,
 '[
   {"title":"사업 방향성 문서","current":0,"target":1,"unit":"완성","note":""},
   {"title":"파일럿 미팅","current":0,"target":3,"unit":"건","note":""}
 ]'::jsonb),

('사업계획서 작성 및 선정',
 '정부지원사업 계획서 작성 및 선정 통과',
 '투자', '💰', 'amber', 5,
 '[
   {"title":"사업계획서 제출","current":0,"target":1,"unit":"건","note":""},
   {"title":"서류평가 통과","current":0,"target":1,"unit":"건","note":""},
   {"title":"최종 선정","current":0,"target":1,"unit":"건","note":""}
 ]'::jsonb)

ON CONFLICT DO NOTHING;
