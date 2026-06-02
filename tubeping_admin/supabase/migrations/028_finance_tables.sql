-- 028_finance_tables.sql
-- 재무관리(finance) 네이티브화 — hub.eumlogics.kr/shinsan 의 localStorage DB를 Supabase로 이관.
-- 원천: shinsananalytics-hub/dashboard/public/data.js 의 PRELOADED + 브라우저 localStorage(shinsan_db_v6_*)
-- 엔티티 5종(sales/purchases/cardTx/bankIn/bankOut) + 신고정본(tax_returns).

create table if not exists fin_sales (
  id          bigint generated always as identity primary key,
  date        date    not null,
  partner     text,
  type        text,             -- 세계(세금계산서)/현영(현금영수증)/카드 등
  amount      bigint  default 0,-- 합계(공급가+세액)
  supply      bigint  default 0,-- 공급가액
  tax         bigint  default 0,-- 부가세
  category    text,
  corp_num    text,
  descr       text,
  memo        text,
  created_at  timestamptz default now()
);

create table if not exists fin_purchases (
  id          bigint generated always as identity primary key,
  date        date    not null,
  partner     text,
  type        text,
  amount      bigint  default 0,
  supply      bigint  default 0,
  tax         bigint  default 0,
  category    text,
  corp_num    text,
  descr       text,
  memo        text,
  created_at  timestamptz default now()
);

create table if not exists fin_card_tx (
  id          bigint generated always as identity primary key,
  date        date    not null,
  partner     text,
  amount      bigint  default 0,
  category    text,
  corp_num    text,
  descr       text,
  memo        text,
  created_at  timestamptz default now()
);

create table if not exists fin_bank_in (
  id          bigint generated always as identity primary key,
  date        date    not null,
  partner     text,
  amount      bigint  default 0,
  balance     bigint,
  category    text,
  corp_num    text,
  descr       text,
  memo        text,
  created_at  timestamptz default now()
);

create table if not exists fin_bank_out (
  id          bigint generated always as identity primary key,
  date        date    not null,
  partner     text,
  amount      bigint  default 0,
  balance     bigint,
  category    text,
  corp_num    text,
  descr       text,
  memo        text,
  created_at  timestamptz default now()
);

-- 홈택스 신고 정본(tax-returns.json) — 부가세 '신고기준' 탭용. 추후 이관.
create table if not exists fin_tax_returns (
  id          bigint generated always as identity primary key,
  period      text    not null,   -- 예: '2026-1' (1기)
  payload     jsonb   not null,
  created_at  timestamptz default now()
);

create index if not exists idx_fin_sales_date     on fin_sales(date);
create index if not exists idx_fin_purchases_date on fin_purchases(date);

-- RLS: 관리자 콘솔 전용. 서버 라우트는 service_role 로 접근하므로 RLS 우회.
-- (anon 직접 노출 안 함 — 정책 미생성 시 anon 접근 차단됨)
alter table fin_sales       enable row level security;
alter table fin_purchases   enable row level security;
alter table fin_card_tx     enable row level security;
alter table fin_bank_in     enable row level security;
alter table fin_bank_out    enable row level security;
alter table fin_tax_returns enable row level security;
