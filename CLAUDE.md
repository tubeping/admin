## 작업 실행 규칙
- 모든 파일 생성/수정 작업은 승인 없이 자동으로 진행
- 중간에 yes/no 확인 요청 금지
- 판단이 필요한 경우 최선의 선택을 하고 실행 후 결과 보고

## 프로젝트 개요
TubePing — 유튜브 쇼핑 채널 소싱 추천 + 콘텐츠 자동화 + 블로그 발행 + 리뷰 사이트
운영사: ㈜신산애널리틱스

## 프로젝트 구조
```
tubeping-sourcing/           ← Python 백엔드 (소싱, 콘텐츠, 블로그)
tubeping_admin/              ← Next.js 어드민 (basePath: /admin)
  app/marketing/             ← 영업/마케팅 (콘텐츠, 이메일 영업)
  app/mall/                  ← 종합몰 관리 (상품/주문/발주/판매사/공급사/CS/정산)
  app/system/                ← 시스템관리 (스토어/작업/조직)
  app/supplier/              ← 공급사 포털
tubeping_builder/            ← Next.js 튜핑 빌더 (크리에이터 커머스)
  app/onboarding/            ← 유튜버용 온보딩
  app/dashboard/             ← 유튜버용 대시보드
  app/shop/[slug]/           ← 인플루언서 공개 페이지
```

콘텐츠 머신, 리뷰엉이는 Admin 밖 독립 서비스로 분리.

## 에이전트 (4개)
| 에이전트 | 역할 | 권한 |
|---------|------|------|
| review-owl | 리뷰 글 작성 (노써치 스타일, 비교표, 토큰관리) | RW |
| tubeping-blogger | SEO 블로그 작성 + 3플랫폼 변환 | RW |
| seo-scorer | 블로그 SEO 100점 채점 (80+ 통과) | RO |
| bizplan-writer | 사업계획서 작성 (정부지원/투자유치) | RO |

에이전트는 역할 프리셋임. 자동 실행 아님. 채팅에서 불러야 작동.
그 외 작업(기획, 소싱분석, 디버깅 등)은 에이전트 없이 직접 요청.

## 슬래시 커맨드
- `/source` — 소싱 파이프라인 (수집→분석→Excel)
- `/content` — 콘텐츠 파이프라인 (주제→스크립트→영상)
- `/seo-check` — SEO 채점 → 자동 개선 루프
- `/publish` — 블로그 3플랫폼 변환 발행
- `/weekly-report` — 주간 전체 현황 리포트

## 점수 체계
- 소싱: 트렌드 35% + 마진 25% + 시즌 20% + 채널적합 20% → S/A/B/C/D
- SEO: 구조 30 + 콘텐츠 35 + 메타 20 + 링크 15 → 80+ 통과

## 반응형 규칙 (모바일 필수)
- 모든 페이지 신규 작업/수정 시 반드시 모바일 반응형 함께 구현
- 그리드: 모바일 1열 → 태블릿 2열 → 데스크톱 3~4열
- 사이드바: 모바일에서 햄버거 메뉴 or 오버레이
- 테이블: 모바일에서 카드형 or 가로 스크롤
- Tailwind breakpoint (sm/md/lg/xl) 활용

## 코딩 규칙 (중복/기술부채 방지)
- 기존 파일 수정 시 반드시 Read로 먼저 읽고 파악한 뒤 수정
- 새 파일 생성보다 기존 파일 수정 우선
- 같은 기능을 다른 파일에 중복 구현 금지 — 기존에 있는지 Grep으로 먼저 확인
- Python은 함수/클래스 재사용. 같은 로직 2곳 이상이면 공통 모듈로 추출
- Next.js는 공용 컴포넌트 components/, 페이지별 컴포넌트 _components/
- 하드코딩 금지 — 설정값은 config/ 또는 .env, 더미데이터는 파일 상단 상수

## 보안 규칙
- .env, client_secret.json 직접 수정 금지 (훅이 차단)
- 인증 정보(API 키, 비밀번호, 토큰)를 코드에 하드코딩 절대 금지
- 인증 정보는 반드시 .env에서 환경변수로 로드
- .env 파일은 .gitignore에 포함 — 커밋 금지
- 외부 URL은 사용자가 제공한 것만 사용

## 금지 사항
- 기존 작동하는 API 연동 코드 임의 변경 금지
- Write(전체 덮어쓰기) 대신 Edit(부분 수정) 사용
- 불필요한 패키지 설치 금지
- 테스트 안 된 코드 커밋 금지

## 기술 스택
- Python 3 + requests, pandas, openpyxl, pyyaml, beautifulsoup4, python-dotenv
- Next.js 15 + TypeScript + Tailwind CSS (tubeping_builder)
- 외부 API: Naver DataLab, SellerLife, YouTube Data API, Pexels, WordPress REST, Cafe24
- 배포: Vercel (tubepingadmin.vercel.app)
