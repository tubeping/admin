-- 인스타 공구 아웃리치 발송 기록
-- DM/이메일/인포크 발송 시 클릭한 날짜로 기록, 답장 추적

create table if not exists instagram_outreach_log (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  channel text not null default 'dm',      -- dm | email | inpock
  status text not null default 'sent',      -- sent | replied | rejected
  sent_at timestamptz not null default now(),
  replied_at timestamptz,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_instagram_outreach_username
  on instagram_outreach_log (username);
create index if not exists idx_instagram_outreach_sent_at
  on instagram_outreach_log (sent_at desc);
