# TubePing Builder — Claude 작업 지침

## 프로젝트 개요
인플루언서 전용 쇼핑몰 빌더. 인플루언서가 5단계 온보딩을 완료하면 쇼핑몰이 개설되는 구조.
운영사: ㈜신산애널리틱스 / 서비스명: 튜핑(TubePing)

## 기술 스택
- Next.js 15 App Router + TypeScript + Tailwind CSS
- 현재 더미 데이터만 사용 (DB 미연결)
- 로컬 실행: `npm run dev` → localhost:3000

## 브랜드 규칙
- 빨간색: `#C41E1E` (Tube)
- 검정: `#111111` (Ping)
- 로고 표기: **Tube**Ping (Tube=빨간색, Ping=검정, 항상 이 색상 조합 유지)
- 버튼 primary: bg `#C41E1E`, hover `#A01818`
- 폰트: 시스템 기본 (별도 지정 없으면 Tailwind 기본값)

## 파일 구조 규칙
```
app/
├── page.tsx                     ← 루트 → /onboarding 리다이렉트만
├── onboarding/
│   ├── page.tsx                 ← 스텝 상태 관리 (부모)
│   ├── layout.tsx
│   └── _components/
│       ├── progress-bar.tsx     ← 상단 진행바
│       ├── step-login.tsx       ← S-01
│       ├── step-channel.tsx     ← S-02
│       ├── step-store.tsx       ← S-03
│       ├── step-products.tsx    ← S-04
│       └── step-complete.tsx    ← S-05
├── api/youtube/route.ts
└── dashboard/
    └── page.tsx                 ← 대시보드
```

- 컴포넌트는 반드시 `_components/` 폴더 안에 위치
- 새 페이지 추가 시 `app/` 하위에 폴더 + `page.tsx` 구조
- 공용 컴포넌트는 `components/` (루트 레벨)에 위치

## 코딩 컨벤션
- 모든 파일 TypeScript (`.tsx`, `.ts`) — `.js` 사용 금지
- 클라이언트 컴포넌트는 파일 최상단에 `"use client"` 명시
- 서버 컴포넌트가 기본값 — 불필요하게 `"use client"` 추가 금지
- 인터페이스명: `I` 접두사 없이 PascalCase (예: `StepProps`)
- Tailwind만 사용 — 인라인 style 객체 사용 금지
- 색상은 반드시 브랜드 규칙의 hex값 사용 (`text-red-600` 같은 Tailwind 기본 색상 금지)

## 온보딩 스텝 흐름
S-01 로그인 → S-02 채널 연결 → S-03 몰 설정 → S-04 카테고리 선택 → /dashboard 이동
- S-05(step-complete)는 현재 사용하지 않음 (S-04 완료 후 바로 /dashboard)
- 스텝 진행은 `onboarding/page.tsx`의 상태로 관리

## 대시보드 구조
사이드바(왼쪽) + 콘텐츠(오른쪽) 2단 레이아웃

### 메뉴 목록
| 메뉴 | 컴포넌트 | 상태 |
|------|---------|------|
| 쇼핑몰 꾸미기 | ShopPreview | 완료 |
| 상품 관리 | ProductManage | 완료 |
| 채널 분석+상품 추천 | ChannelAnalysis | 완료 |
| 정산 대시보드 | Settlement | "준비 중" 표시 |

- 새 메뉴 추가 시 사이드바 메뉴 배열 + 컴포넌트 추가 패턴 유지
- 각 메뉴 컴포넌트는 `dashboard/_components/` 안에 위치

## 현재 미구현 (건드리지 말 것)
- 실제 인증 (Google OAuth, 카카오, 네이버) — 현재는 버튼 UI만
- 카페24 API 연동
- Supabase DB 연결
- 모바일 반응형
- 유튜브 Data API 실제 연동 (API 키 없으면 더미 데이터 사용)

## 작업 요청 규칙
1. **한 번에 하나의 파일만 수정** — 여러 파일 동시 수정은 오류 추적이 어려움
2. **수정 전 반드시 현재 파일 내용 확인** — 기존 코드를 파악한 뒤 수정
3. **기존 스타일/구조 유지** — 새 컴포넌트도 기존 파일의 패턴을 따름
4. **더미 데이터는 파일 상단에 상수로 선언** — 컴포넌트 안에 하드코딩 금지
5. **에러 발생 시** — 에러 메시지 전체를 붙여넣고 어느 파일인지 명시

## 벤치마킹 레퍼런스
- **인포크**: 3분 개설 UX, 블록 조립 방식, 링크 클릭 통계
- **마플샵**: 크리에이터 전용 URL, 독립몰 느낌, 실시간 랭킹
→ UX 방향성 참고용. 기능 구현 시 이 두 서비스의 사용자 경험을 기준으로 판단
