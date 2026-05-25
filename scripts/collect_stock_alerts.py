"""
공급사 품절/재입고/판매종료 메일 자동 수집기.

흐름:
  1. master@shinsananalytics.com Gmail IMAP 접속
  2. 최근 N일 메일에서 제목 키워드(품절·단종·판매종료·시즌아웃·재입고·가격변경) 검색
  3. 발주요청서 패턴(`튜핑에서 ... 보내드리는`) 제외
  4. 제목·본문에서 supplier·alert_type·product_names 추출
  5. 동일 토큰 기반으로 products 테이블 매칭
  6. supabase product_stock_alerts 에 idempotent insert (source_ref = gmail thread id)

환경변수 (tubeping_admin/.env.local 자동 로드):
  - SMTP_USER, SMTP_PASS : Gmail 계정 + 앱비밀번호 (IMAP 공유)
  - NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

사용법:
  python3 collect_stock_alerts.py                     # 최근 7일 수집
  python3 collect_stock_alerts.py --days 30           # 최근 30일
  python3 collect_stock_alerts.py --dry-run           # DB 쓰기 없이 미리보기
  python3 collect_stock_alerts.py --since 2026-04-01  # 특정 시점 이후
"""
from __future__ import annotations

import argparse
import calendar
import email
import imaplib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, "tubeping_admin", ".env.local")
ALL_MAIL = '"[Gmail]/&yATMtLz0rQDVaA-"'
IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993

# 제목에서 alert_type 분류 — 우선순위 순서 (단종 > 판매종료 > 품절 > 재입고 > 가격)
ALERT_TYPE_RULES = [
    ("discontinued", re.compile(r"단종|판매\s*종료|시즌\s*아웃|판매중지|폐기|취급중단", re.I)),
    ("restock",      re.compile(r"재입고|입고\s*완료|판매\s*재개", re.I)),
    ("price_change", re.compile(r"가격\s*변경|가격\s*인상|가격\s*인하|단가\s*조정", re.I)),
    ("out_of_stock", re.compile(r"품절|품귀|재고\s*소진|결품", re.I)),
]
# 제외 패턴 — 발주요청서 / 결제 / 정산 등
EXCLUDE_SUBJECT_RE = re.compile(
    r"발주\s*요청서|발주서|보내드리는|정산\s*안내|입금\s*확인|결제\s*완료|광고|이벤트|회원\s*가입",
    re.I,
)

# 제목 패턴: [품절안내] 상품A / [판매종료안내] 상품B / 의류 품절 안내 등
SUBJECT_PRODUCT_RE = re.compile(
    r"\[\s*(?:품절|단종|판매\s*종료|재입고|가격\s*변경)\s*(?:안내|공지)?\s*\]\s*(.+)",
    re.I,
)
# 귀빈정식 제목: `[수리취떡]상품이 품절되어 ...` — 첫 [xxx] 안이 상품명
SUBJECT_BRACKET_RE = re.compile(r"\[([^\]]{2,40})\](?:상품|제품|이|은|는)?\s*(?:이|가)?\s*품절|단종|판매")
# 본문 리스트 줄: `- AMI xxx`, `· 상품A`, `* 상품B` — 단, 별표 2개 이상(`**`)은 disclaimer 라인이라 제외
BODY_LIST_RE = re.compile(r"^\s*(?:[-·▶•◦]|\*(?!\*))\s*(.+?)\s*$", re.M)
# 본문에서 제외할 라인 패턴 (안내문/footer)
NOISE_LINE_RE = re.compile(
    r"본\s*공지는|일괄\s*발송|업체에도\s*전달|양해\s*부탁|문의\s*주시기|감사합니다|업무에\s*참고|"
    r"품절일|발주\s*가능|불가능|사유\s*[:：]|이후\s*생산|재개일|전달\s*드리|시즌\s*종료|"
    r"재고\s*부족|일정\s*확인",
    re.I,
)

# Gmail 폴더 한글 인코딩
SAFE_NAME_RE = re.compile(r'[\\/:*?"<>|\r\n\t]+')


# ---------- 환경설정 ----------

def load_env():
    if not os.path.exists(ENV_PATH):
        sys.exit(f"환경파일 없음: {ENV_PATH}")
    env = {}
    for line in open(ENV_PATH, "r", encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# ---------- 헬퍼 ----------

def _decode(h):
    if not h:
        return ""
    return "".join(
        s.decode(enc or "utf-8", errors="replace") if isinstance(s, bytes) else s
        for s, enc in decode_header(h)
    )


def _imap_since(dt: datetime) -> str:
    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    return f"{dt.day:02d}-{months[dt.month-1]}-{dt.year}"


def classify_alert(subject: str) -> str | None:
    """제목으로 alert_type 분류. 매칭 안되면 None."""
    if EXCLUDE_SUBJECT_RE.search(subject):
        return None
    for atype, regex in ALERT_TYPE_RULES:
        if regex.search(subject):
            return atype
    return None


def extract_supplier(from_header: str, subject: str) -> str:
    """From 헤더와 제목에서 공급사명 추출."""
    # 1) "이름 <email>" 패턴
    m = re.match(r"\s*(.+?)\s*<(.+?)>\s*$", from_header)
    name = m.group(1).strip() if m else from_header.strip()
    addr = m.group(2).strip() if m else ""
    # 2) 제목 끝 ` / (주)XXX` 패턴
    m2 = re.search(r"/\s*(\(주\)\S+|주식회사\s*\S+|㈜\S+)\s*$", subject)
    if m2:
        return m2.group(1).strip()
    if name and not name.startswith("<"):
        return name.strip('"').strip("'")
    return addr or "(미상)"


def extract_product_names(subject: str, body: str, alert_type: str) -> list[str]:
    """제목과 본문에서 상품명 후보 추출."""
    names: list[str] = []

    # 1) 제목 패턴: [품절안내] 상품A
    m = SUBJECT_PRODUCT_RE.search(subject)
    if m:
        cand = m.group(1).strip()
        cand = re.sub(r"\s*(시즌\s*아웃|단종|판매\s*종료|품절|재입고|일시품절|즉시품절|안내)\s*$", "", cand).strip()
        if cand:
            names.append(cand)

    # 1-2) 귀빈정식: `[상품명]상품이 품절되어...`
    m = re.search(r"\[([^\]]{2,40})\]\s*상품(?:이|은)?\s*(?:품절|단종|판매)", subject)
    if m and m.group(1):
        names.append(m.group(1).strip())

    # 2) 미페마식: 첫 문단 직후 단일 상품명 라인
    m = re.search(r"입니다\.?\s*\n+\s*(.+?)\s*\n+\s*해당제품", body)
    if m:
        cand = m.group(1).strip()
        if cand and len(cand) < 80 and not NOISE_LINE_RE.search(cand):
            names.append(cand)

    # 3) 리스트 행
    for li in BODY_LIST_RE.findall(body):
        cand = li.strip()
        if not (5 <= len(cand) <= 80):
            continue
        if not re.search(r"[가-힣A-Za-z]", cand):
            continue
        if NOISE_LINE_RE.search(cand):
            continue
        names.append(cand)

    # 4) 후보 정리 — 중복/노이즈 제거
    seen = set()
    out = []
    for n in names:
        n = n.strip()
        if not n or n in seen or len(n) < 2:
            continue
        if NOISE_LINE_RE.search(n):
            continue
        seen.add(n)
        out.append(n)
    return out[:20]


def tokenize_for_match(name: str) -> list[str]:
    """매칭용 토큰화 — 공백/괄호/단위 제거, 핵심 키워드만."""
    # 괄호 안 제거: "한라봉(340ml)" → "한라봉"
    s = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", name)
    # 단위 제거
    s = re.sub(r"\b\d+\s*(kg|g|ml|개|입|팩|세트|박스|매|장|병|포|봉|인분|과)\b", " ", s, flags=re.I)
    # 특수문자 → 공백
    s = re.sub(r"[/+,·\-_~!@#$%^&*=<>?:;\"\'\\|]+", " ", s)
    # 분리
    toks = [t for t in re.split(r"\s+", s) if len(t) >= 2]
    # 보조어/일반어 제외
    stopwords = {"상품", "전상품", "옵션", "해외", "병행", "수입", "기타", "외", "등", "안내"}
    toks = [t for t in toks if t not in stopwords]
    # 중복 제거 + 순서 유지
    seen = set()
    out = []
    for t in toks:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


# ---------- Supabase ----------

class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def _req(self, method: str, path: str, params: dict | None = None, body=None):
        url = f"{self.base}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params, safe="*.,()")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            return {"_error": e.read().decode(), "_status": e.code}

    def match_products(self, tokens: list[str], limit: int = 5) -> list[dict]:
        """토큰 OR로 products 검색. 신뢰도 점수 부여."""
        if not tokens:
            return []
        # 가장 긴 토큰부터 시도, 결과 점수 누적
        scored: dict[str, dict] = {}
        for tok in tokens:
            if len(tok) < 2:
                continue
            r = self._req("GET", "/products", {
                "select": "id,tp_code,product_name,selling",
                "product_name": f"ilike.*{tok}*",
                "limit": str(limit * 3),
            })
            if not isinstance(r, list):
                continue
            for p in r:
                pid = p["id"]
                if pid not in scored:
                    scored[pid] = {**p, "_hits": 0, "_tokens": []}
                scored[pid]["_hits"] += 1
                scored[pid]["_tokens"].append(tok)
        # 점수 높은 순 정렬, 최소 1개 토큰 히트
        ranked = sorted(scored.values(), key=lambda x: -x["_hits"])
        return ranked[:limit]

    def existing_source_refs(self, refs: list[str]) -> set[str]:
        if not refs:
            return set()
        # PostgREST in.() 필터
        in_list = ",".join(f'"{r}"' for r in refs)
        r = self._req("GET", "/product_stock_alerts", {
            "select": "source_ref",
            "source_ref": f"in.({in_list})",
        })
        if not isinstance(r, list):
            return set()
        return {x["source_ref"] for x in r if x.get("source_ref")}

    def insert_alert(self, row: dict) -> dict | None:
        return self._req("POST", "/product_stock_alerts", body=row)


# ---------- 메인 ----------

def parse_message(msg) -> dict | None:
    subject = _decode(msg.get("Subject", ""))
    from_h = _decode(msg.get("From", ""))
    date_h = msg.get("Date", "")
    try:
        sent_dt = parsedate_to_datetime(date_h) if date_h else None
    except Exception:
        sent_dt = None

    atype = classify_alert(subject)
    if not atype:
        return None

    # 본문 추출 (text/plain 우선, 없으면 html → 텍스트)
    body = ""
    for part in msg.walk():
        ct = (part.get_content_type() or "").lower()
        if ct == "text/plain":
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                try:
                    body = payload.decode(charset, errors="replace")
                except LookupError:
                    body = payload.decode("utf-8", errors="replace")
                break
    if not body:
        for part in msg.walk():
            ct = (part.get_content_type() or "").lower()
            if ct == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        html = payload.decode(charset, errors="replace")
                    except LookupError:
                        html = payload.decode("utf-8", errors="replace")
                    body = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
                    body = re.sub(r"</p>", "\n\n", body, flags=re.I)
                    body = re.sub(r"<[^>]+>", " ", body)
                    body = re.sub(r"[ \t]+", " ", body)
                    body = re.sub(r"\n{3,}", "\n\n", body)
                    break

    supplier = extract_supplier(from_h, subject)
    products = extract_product_names(subject, body, atype)
    # detail은 본문 앞부분
    detail = (body[:600].strip()) if body else ""

    return {
        "subject": subject,
        "from": from_h,
        "supplier": supplier,
        "alert_type": atype,
        "product_names": products,
        "detail": detail,
        "sent_dt": sent_dt,
    }


def run(args):
    env = load_env()
    user = env.get("SMTP_USER")
    pw = (env.get("SMTP_PASS") or "").replace(" ", "")
    sb_url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    sb_key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (user and pw and sb_url and sb_key):
        sys.exit("환경변수 누락: SMTP_USER / SMTP_PASS / SUPABASE_URL / SERVICE_ROLE_KEY")
    sb = Supabase(sb_url, sb_key)

    # 검색 기간
    if args.since:
        since_dt = datetime.strptime(args.since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    else:
        since_dt = datetime.now(timezone.utc) - timedelta(days=args.days)
    since_str = _imap_since(since_dt)

    print(f"[수집 시작] since={since_str} dry_run={args.dry_run}")

    M = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    M.login(user, pw)
    M.select(ALL_MAIL, readonly=True)

    # Gmail X-GM-RAW 로 서버 측 검색 (한글 키워드 OR)
    gmail_query = (
        f'after:{since_dt.strftime("%Y/%m/%d")} '
        f'subject:(품절 OR 단종 OR 판매종료 OR 시즌아웃 OR 재입고 OR 가격변경 OR 품귀 OR 결품 OR 판매중지)'
    )
    # UTF-8 literal 로 한글 검색어 전달
    M.literal = gmail_query.encode("utf-8")
    typ, data = M.search("UTF-8", "X-GM-RAW")
    if typ != "OK" or not data or not data[0]:
        # 폴백: SINCE만
        typ, data = M.search(None, f'(SINCE "{since_str}")')
    if typ != "OK" or not data or not data[0]:
        print("메일 0건")
        M.logout()
        return
    ids = data[0].split()
    print(f"기간 내 메일 {len(ids)}건 — 분류 시작")

    # 1) 후보 수집 (thread id 기준)
    candidates: list[dict] = []
    for mid in ids:
        try:
            typ, raw = M.fetch(mid, "(X-GM-THRID BODY[HEADER.FIELDS (SUBJECT FROM DATE)])")
            if typ != "OK" or not raw:
                continue
            # X-GM-THRID
            thrid = None
            for item in raw:
                if isinstance(item, tuple) and item[0]:
                    head_meta = item[0].decode("utf-8", errors="replace")
                    m = re.search(r"X-GM-THRID\s+(\d+)", head_meta)
                    if m:
                        thrid = format(int(m.group(1)), "x")
                    break
            # 헤더로 빠른 필터
            full = b""
            for item in raw:
                if isinstance(item, tuple) and len(item) > 1 and item[1]:
                    full += item[1]
            head_msg = email.message_from_bytes(full)
            subj = _decode(head_msg.get("Subject", ""))
            if not classify_alert(subj):
                continue
            candidates.append({"mid": mid, "thrid": thrid, "subject": subj})
        except Exception as e:
            print(f"  header fetch 실패 {mid}: {e}")

    print(f"제목 기준 후보 {len(candidates)}건")

    # 2) 중복 제거 (DB에 이미 있는 source_ref 제외)
    existing = sb.existing_source_refs([c["thrid"] for c in candidates if c["thrid"]])
    new_candidates = [c for c in candidates if c["thrid"] and c["thrid"] not in existing]
    print(f"신규 후보 {len(new_candidates)}건 (이미 있음: {len(candidates) - len(new_candidates)}건)")

    # 3) 본문 fetch + 추출 + 매칭 + insert
    inserted = 0
    skipped = 0
    errors = []
    for c in new_candidates:
        try:
            typ, raw = M.fetch(c["mid"], "(RFC822)")
            if typ != "OK" or not raw or not raw[0]:
                continue
            # raw[0] 는 (header_meta, body) 튜플
            payload = raw[0][1] if isinstance(raw[0], tuple) else None
            if not payload:
                skipped += 1
                continue
            msg = email.message_from_bytes(payload)
            info = parse_message(msg)
            if not info:
                skipped += 1
                continue

            # 매칭
            all_tokens = []
            for name in info["product_names"]:
                all_tokens.extend(tokenize_for_match(name))
            matched = sb.match_products(all_tokens, limit=5)
            matched_ids = [m["id"] for m in matched]

            row = {
                "supplier_name": info["supplier"],
                "alert_type": info["alert_type"],
                "product_names": info["product_names"],
                "title": info["subject"],
                "detail": info["detail"],
                "effective_from": info["sent_dt"].date().isoformat() if info["sent_dt"] else None,
                "matched_product_ids": matched_ids,
                "source": "gmail",
                "source_ref": c["thrid"],
            }

            print(f"  [{info['alert_type']:13}] {info['supplier']:20} | {info['subject'][:50]}")
            print(f"      products={info['product_names']} matched={len(matched_ids)}")

            if args.dry_run:
                continue
            r = sb.insert_alert(row)
            if isinstance(r, dict) and r.get("_error"):
                errors.append(f"{c['thrid']}: {r['_error']}")
            else:
                inserted += 1
        except Exception as e:
            import traceback
            errors.append(f"{c['thrid']}: parse/insert {e} :: {traceback.format_exc().splitlines()[-3]}")

    M.logout()

    print()
    print(f"[완료] 신규삽입={inserted} 스킵={skipped} 에러={len(errors)}")
    for e in errors[:10]:
        print("  ERR:", e)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="최근 N일 (기본 7)")
    ap.add_argument("--since", help="YYYY-MM-DD 이후 (--days 무시)")
    ap.add_argument("--dry-run", action="store_true", help="DB 쓰기 없이 미리보기")
    run(ap.parse_args())
