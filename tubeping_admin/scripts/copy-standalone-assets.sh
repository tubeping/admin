#!/usr/bin/env bash
# Next.js `output: 'standalone'` 빌드는 .next/static 과 public 을 standalone 트리로
# 자동 복사하지 않는다(알려진 제약). pm2가 standalone server.js 로 직접 서빙하면
# 이 정적 자산이 없어서 _next/static 이 전부 404 → CSS/JS 깨짐.
#
# 이 스크립트가 빌드 직후(postbuild) standalone server.js 위치를 찾아
# .next/static 과 public 을 그 옆에 복사해 자산이 정상 서빙되게 한다.
# standalone을 안 쓰는 환경(예: Vercel)에선 server.js를 못 찾으면 그냥 건너뜀(무해).
#
# 절대 빌드를 실패시키지 않도록 set -e 미사용 + 항상 exit 0.
set -u

# node_modules 안에도 server.js 가 많으므로 반드시 제외 → standalone 루트 server.js만 선택
SERVER_JS="$(find .next/standalone -name server.js -not -path '*/node_modules/*' 2>/dev/null | head -1)"
if [ -z "${SERVER_JS}" ]; then
  echo "[copy-standalone-assets] standalone server.js 없음 — 건너뜀 (standalone 미사용 환경)"
  exit 0
fi

DEST="$(dirname "${SERVER_JS}")"

if [ -d .next/static ]; then
  rm -rf "${DEST}/.next/static"
  cp -r .next/static "${DEST}/.next/static" \
    && echo "[copy-standalone-assets] .next/static → ${DEST}/.next/static"
fi

if [ -d public ]; then
  mkdir -p "${DEST}/public"
  cp -r public/. "${DEST}/public/" 2>/dev/null \
    && echo "[copy-standalone-assets] public → ${DEST}/public"
fi

exit 0
