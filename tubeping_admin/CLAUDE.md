# TubePing Admin — Claude 작업 지침

## 프로젝트 개요
TubePing 운영 어드민 허브. 대시보드, 영업/마케팅(컨텐츠·이메일영업), 종합몰(상품/발주/정산), 시스템(작업관리/조직관리), 디자인시스템.
운영사: ㈜신산애널리틱스 / 서비스명: 튜핑(TubePing)

## 기술 스택
- Next.js 16 App Router + TypeScript + Tailwind CSS v4
- basePath: `/admin` (모든 URL이 `/admin`으로 시작)
- 현재 더미 데이터만 사용 (DB 미연결)
- 로컬 실행: `npm run dev` → localhost:3001/admin
- Vercel 배포: tubepingadmin.vercel.app/admin

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
├── marketing/              ← 영업/마케팅 > 컨텐츠
│   ├── layout.tsx          ← AdminShell 래퍼
│   ├── content/page.tsx    ← 컨텐츠 허브 (블로그+콘텐츠머신+리뷰엉이 탭)
│   ├── blog/page.tsx
│   ├── content-machine/page.tsx
│   └── review-owl/
│       ├── page.tsx
│       └── _components/
├── sales/                  ← 영업/마케팅 > 이메일 영업
│   ├── layout.tsx
│   └── outreach/
│       ├── page.tsx
│       └── _components/
├── mall/
│   ├── layout.tsx
│   ├── products/page.tsx
│   ├── orders/page.tsx
│   └── settlement/page.tsx
├── system/
│   ├── layout.tsx
│   ├── tasks/page.tsx
│   └── organization/page.tsx
└── design-system/
    ├── layout.tsx
    └── page.tsx
```

## 코딩 컨벤션
- 모든 파일 TypeScript (`.tsx`, `.ts`)
- 클라이언트 컴포넌트는 `"use client"` 명시
- Tailwind만 사용 — 인라인 style 객체 최소화
- 색상은 브랜드 규칙의 hex값 또는 CSS 변수 사용

## 금지 사항
- .env 직접 수정 금지
- 인증 정보 하드코딩 금지
