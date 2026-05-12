# TubePing Admin — 새 PC 셋업 (Claude Code 이어 작업용)

다른 PC에서 이 프로젝트를 받아 Claude Code로 작업하기 위한 절차입니다.

---

## 사전 설치 (한 번만)

1. **Git** — https://git-scm.com/downloads
2. **Node.js LTS** — https://nodejs.org/ (v20 이상 권장)
3. **Claude Code CLI** — https://docs.claude.com/en/docs/claude-code/quickstart
   ```
   npm install -g @anthropic-ai/claude-code
   ```
   설치 후 `claude` 명령으로 인증.

---

## 프로젝트 받기

```bash
# 작업 디렉토리로 이동 후
git clone https://github.com/tubeping/admin.git tubeping_admin
cd tubeping_admin
npm install
```

---

## 환경변수 셋업

루트에 `.env.local` 파일 생성. 키 값은 **별도 안전한 채널(1Password / 회사 비밀저장소 / 직접 만남)** 로 전달받음. 절대 GitHub·이메일 평문 금지.

필요한 키:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CAFE24_CLIENT_ID=
CAFE24_CLIENT_SECRET=
CAFE24_REDIRECT_URI=
SMTP_USER=
SMTP_PASS=
CRON_SECRET=
NEXT_PUBLIC_BASE_URL=https://tubepingadmin.vercel.app
GEMINI_API_KEY=          # (선택) AI 콘텐츠 생성용
```

---

## 로컬 개발 서버 띄우기

```bash
npm run dev
# → http://localhost:3001/admin 열림 (port 3001 고정)
```

---

## Claude Code로 작업 시작

프로젝트 루트(`tubeping_admin/`)에서:

```bash
claude
```

자동으로 다음 컨텍스트 로드됨:
- **`CLAUDE.md`** — 프로젝트 지침 (브랜드 룰·금지 영역·기술 스택)
- **`SETUP.md`** — 이 문서
- 파일 구조·코딩 컨벤션

처음 시작 시 Claude에게:
```
이 프로젝트는 TubePing Admin이야. CLAUDE.md 먼저 읽고 작업 시작해줘.
```

---

## 코드 변경·반영 워크플로

```bash
# 1. 작업 시작 전 최신 받기
git pull origin master

# 2. 작업 후 commit
git add .
git commit -m "변경 요약"
git push origin master

# 3. master에 push되면 Vercel이 자동으로 prod 배포
#    (GitHub-Vercel 연결돼 있을 때. 없으면 'npx vercel --prod --yes' 수동 실행)
```

---

## 핵심 운영 정보

- **운영 URL**: https://tubepingadmin.vercel.app/admin
- **DB**: Supabase (`ypyhlrsuqkigwlpwhurf`)
- **카페24 멀티몰**: 13개 스토어 양방향 동기화
- **Vercel cron**: 21:00 토큰갱신, 22:00 주문수집 (Pro 플랜 — SLA 보장)
- **Function region**: icn1 (Seoul)
- **메일 발송**: Gmail SMTP (lib/mail.ts)
- **MacroDroid 입금 webhook**: `/admin/api/webhook/bank-sms`

---

## DB 스키마 추가 적용 (필요 시)

새로운 migration이 들어오면:

```
supabase/migrations/ 폴더의 SQL 파일들을
Supabase Dashboard → SQL Editor에서 순서대로 실행
```

---

## 절대 금지

- `.env.local` git에 commit 금지 (이미 .gitignore 처리)
- `client_secret*.json` 등 인증 파일 commit 금지
- `tubeping_builder/`, `dashboard/reviewyangi/`, `reviewyangi_engine/` 폴더 절대 건드리지 않음 (CLAUDE.md 참조)
- master에 직접 force-push 금지 (`git push -f` 금지)

---

## 문제 발생 시

- 배포 실패: `npx vercel --prod --yes`로 강제 재배포
- cron 누락: Vercel Dashboard → Crons 탭에서 실행 기록 확인
- DB 권한 오류: `SUPABASE_SERVICE_ROLE_KEY` 재확인 (anon key 아님)
- 카페24 401: `/admin/api/cron/refresh-tokens` 수동 호출로 토큰 갱신
