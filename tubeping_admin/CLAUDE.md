# TubePing Admin — Claude 작업 지침

## 🛑 절대 금지 영역

### tubeping.site — HARD BLOCK
- 어떤 경로든 tubeping-site·tubeping.site 폴더·파일 **절대 금지**
- settings.json 훅이 차단. 차단돼도 재시도 금지.

### builder 영역 직접 수정 금지
- `tubeping_builder/` 코드 직접 수정 금지
- 빌더와 통합 필요한 경우 **공유 DB(Supabase) 또는 API 경유**
- builder에서 받은 주문을 admin에서 처리하는 등 **데이터 레벨 통합만 허용**

### reviewyangi 영역 금지
- `dashboard/reviewyangi/`, `reviewyangi_engine/`, `buying_guide_hub/` 수정 금지

---

## 프로젝트 개요
TubePing 운영 어드민 허브. 대시보드, 영업/마케팅(컨텐츠·이메일영업), 종합몰(상품/발주/정산), 시스템(작업관리/조직관리), 디자인시스템.
운영사: ㈜신산애널리틱스 / 서비스명: 튜핑(TubePing)

## ⚠️ 다음주(2026-04-21 주간) Vultr 서버 이전 예정
- 현재 **Supabase + Vercel** 구성은 임시. 다음주 **Vultr VPS**로 전체 이전.
- 이전 전까지는 아래 기술 스택·배포 방식이 유효. 이전 후 재작성 필요.

## 기술 스택
- Next.js 16 App Router + TypeScript + Tailwind CSS v4
- basePath: `/admin` (모든 URL이 `/admin`으로 시작)
- 로컬 실행: `npm run dev` → localhost:3001/admin
- 배포: Vercel CLI 수동 배포 (`vercel --prod`) → tubepingadmin.vercel.app/admin
  - GitHub 연결 없음. 이 폴더의 `.vercel/project.json`이 Vercel 프로젝트와 연결됨
  - git push가 자동 배포를 트리거하지 않음

## 외부 연동 (lib/ 모듈)
- **Supabase** (`lib/supabase.ts`) — 상품·주문·정산·CS·OKR 등 DB
- **카페24** (`lib/cafe24.ts`) — 상품/주문/카테고리/CS/배송 양방향 동기화, 토큰 자동 갱신
- **메일** (`lib/mail.ts`) — 발주서·영업 이메일 발송
- **채팅 채널** — 카카오톡(`kakaotalk.ts`), 네이버톡(`navertalk.ts`), 채널톡(`channeltalk.ts`) CS 통합
- **공급사 매칭** (`lib/autoAssignSuppliers.ts`) — 상품→공급사 자동 배정 로직
- **크론 작업** (`app/api/cron/`) — 주문 수집, 토큰 갱신 등 주기 실행

## 브랜드 규칙
- 빨간색: `#C41E1E` (Tube)
- 검정: `#111111` (Ping)
- 로고 표기: **Tube**Ping (Tube=빨간색, Ping=검정, 항상 이 색상 조합 유지)
- 버튼 primary: bg `#C41E1E`, hover `#A01818`

## 파일 구조
```
app/
├── layout.tsx              ← 루트 레이아웃 (html/body)
├── globals.css             ← 디자인 토큰 + Tailwind
├── page.tsx                ← 대시보드 (사이드바 포함)
├── _components/
│   ├── sidebar.tsx         ← 네비게이션 사이드바
│   └── admin-shell.tsx     ← 사이드바+메인 래퍼 (서브페이지용)
│
├── marketing/              ← 영업/마케팅
│   ├── content/            ← 콘텐츠 허브 (블로그+콘텐츠머신+리뷰양이 탭)
│   ├── blog/               ← 블로그 발행 대시보드 (실데이터)
│   ├── content-machine/    ← 뉴스/AI 콘텐츠 생성
│   └── reviewyangi/         ← 리뷰양이 편집기
│
├── sales/
│   └── outreach/           ← 이메일 영업·CRM·발송 관리
│
├── mall/                   ← 종합몰 관리
│   ├── products/           ← 상품 관리 (카페24 동기화, 옵션/재고)
│   ├── orders/             ← 주문 관리
│   │   ├── lookup/         ← 주문 조회
│   │   ├── payment/        ← 결제 확인
│   │   ├── phone/          ← 전화 주문
│   │   └── verification/   ← 검증
│   ├── purchase-orders/    ← 발주서 (CSV·이메일 발송)
│   ├── settlement/         ← 정산 (판매사/공급사 분리, 송장등록일 기준)
│   ├── suppliers/          ← 공급사 관리
│   ├── supplier-holidays/  ← 공급사 휴무일
│   ├── sellers/            ← 판매사 관리
│   ├── stock-alerts/       ← 재고 알림
│   └── cs/                 ← CS 관리 (카톡/네이버톡/채널톡 통합)
│
├── system/
│   ├── okr/                ← OKR (분기 목표·한눈에 보기 그리드)
│   ├── organization/       ← 조직 관리 (7팀 25명 AI 에이전트 구조)
│   ├── stores/             ← 스토어 관리
│   ├── settings/           ← 시스템 설정
│   └── tasks/              ← 작업 관리
│
├── supplier/               ← 공급사 포털 (공급사 로그인용)
│
├── design-system/          ← 디자인 토큰·컴포넌트 카탈로그
│
└── api/                    ← API 라우트 (cafe24, cs, cron, okrs, kakaotalk, navertalk 등)
```

## 코딩 컨벤션
- 모든 파일 TypeScript (`.tsx`, `.ts`)
- 클라이언트 컴포넌트는 `"use client"` 명시
- Tailwind만 사용 — 인라인 style 객체 최소화
- 색상은 브랜드 규칙의 hex값 또는 CSS 변수 사용

## 금지 사항
- .env 직접 수정 금지
- 인증 정보 하드코딩 금지
