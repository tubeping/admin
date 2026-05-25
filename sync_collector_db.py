"""수집기 DB들을 대시보드 public 폴더에 통합 JSON으로 동기화"""
import json, os, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE = "C:/Users/maste/OneDrive/Desktop/유튜브 이메일 수집 자동화"
OUT_BUILDER = "c:/tubeping-sourcing/tubeping_builder/public/collector-db.json"
OUT_ADMIN = "c:/tubeping-sourcing/tubeping_admin/public/collector-db.json"
SENT_JSON_BUILDER = "c:/tubeping-sourcing/tubeping_builder/public/sent-emails.json"
SENT_JSON_ADMIN = "c:/tubeping-sourcing/tubeping_admin/public/sent-emails.json"

CATEGORIES = [
    {"key": "cook", "name": "요리/레시피", "db": f"{BASE}/튜핑_요리레시피_DB.json"},
    {"key": "politics", "name": "정치", "db": f"{BASE}/정치/튜핑_정치_DB.json"},
    {"key": "life_review", "name": "생활 리뷰", "db": f"{BASE}/생활 리뷰/튜핑_생활리뷰_DB.json"},
    {"key": "product", "name": "생활용품 리뷰", "db": f"{BASE}/튜핑_생활용품리뷰_DB.json"},
    {"key": "health", "name": "건강/운동", "db": f"{BASE}/건강운동/튜핑_채널DB.json"},
    {"key": "vtuber", "name": "버튜버", "db": f"{BASE}/튜핑_버튜버_DB.json"},
]

# 기발송 이메일 로드
sent_emails = set()
for _sf in [SENT_JSON_BUILDER, SENT_JSON_ADMIN]:
    if os.path.exists(_sf):
        with open(_sf, 'r', encoding='utf-8') as f:
            sent_emails.update(json.load(f))

# 제외 채널명 (계약 중 + 방송사/대기업/공공기관)
EXCLUDE_CHANNELS = [
    # 계약/진행 중
    "라쥬", "lajuu", "단정한 살림", "리하살림", "게굴자덕", "이트렌드",
    "코믹마트", "킬링타임", "누기", "떠먹여주는tv", "줌인센터", "줌인센타",
    "편들어주는 파생방송", "artube", "뉴스엔진", "뉴스반장", "완선부부",
    "빵시기", "트래블리즈", "노지고", "희예", "뽀록맨", "캠핑덕후",
    "배우리 프로", "신사임당", "정성산tv", "가로세로연구소", "박용민tv",
    "백운기의 정어리tv", "키즈", "머니코믹스", "슈카", "침착맨",
    "기안84", "이낙연", "강남허준 박용환", "아는형님",
    # 방송사
    "jtbc", "조선", "mnet", "sbs", "cj enm", "kbs", "ebs", "mbc",
    "tvn", "채널a", "연합뉴스", "ytn", "tbs",
    # 대기업
    "삼성", "현대", "롯데", "카카오", "네이버",
    # 금융
    "증권", "은행", "자산운용",
    # 엔터
    "sm entertainment", "yg entertainment", "jyp entertainment",
    "hybe", "빅히트", "멜론", "지니뮤직",
    # 게임사
    "넥슨", "넷마블", "크래프톤", "엔씨소프트",
    # e스포츠
    "lck", "gen.g", "kt rolster",
    # 공공
    "공단", "공사", "ministry", "청와대",
    # 기타
    "itsub잇섭", "kbs 다큐", "김작가 tv", "아는형님 knowingbros",
    "월급쟁이부자들tv", "이재명", "법륜스님", "고성국tv",
    "한국불교 대표방송", "유 퀴즈 온 더 튜브", "궁금소",
    "김용민tv", "윤석열", "정청래", "국민의힘tv", "인싸it",
    "짠한형 신동엽", "매불쇼", "mbc pd수첩", "wwe",
    "백종원", "보경 bokyoung", "m2", "세바시",
    "지식한입", "e트렌드", "주언규", "편들어주는 파생 방송",
]
EXCLUDE_SET = set(e.lower() for e in EXCLUDE_CHANNELS)

result = {"categories": [], "totalChannels": 0, "totalEmails": 0, "totalSent": 0}

for cat in CATEGORIES:
    try:
        with open(cat["db"], 'r', encoding='utf-8') as f:
            db = json.load(f)
    except:
        db = {}

    channels = []
    email_count = 0
    sent_count = 0
    excluded_count = 0
    for cid, info in db.items():
        name = info.get("채널명", "")
        name_lower = name.lower()
        # 제외 목록 체크
        is_excluded = any(ex in name_lower for ex in EXCLUDE_SET)
        if is_excluded:
            excluded_count += 1
            continue

        email = info.get("이메일", "")
        if email:
            email_count += 1
        is_sent = email.lower() in sent_emails if email else False
        if is_sent:
            sent_count += 1
        channels.append({
            "channelId": cid,
            "channelName": info.get("채널명", ""),
            "channelUrl": info.get("채널 URL", ""),
            "subscriberCount": info.get("구독자", 0),
            "viewCount": info.get("총조회수", 0),
            "videoCount": info.get("영상수", 0),
            "avgViewCount": info.get("평균조회수", 0),
            "email": email,
            "collectedAt": info.get("수집일시", ""),
            "sent": is_sent,
        })

    # 구독자 내림차순 정렬
    channels.sort(key=lambda x: x["subscriberCount"], reverse=True)

    result["categories"].append({
        "key": cat["key"],
        "name": cat["name"],
        "totalChannels": len(channels),
        "withEmail": email_count,
        "sentCount": sent_count,
        "channels": channels,
    })
    result["totalChannels"] += len(channels)
    result["totalEmails"] += email_count
    result["totalSent"] += sent_count

for _out in [OUT_BUILDER, OUT_ADMIN]:
    os.makedirs(os.path.dirname(_out), exist_ok=True)
    with open(_out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)

# sent-emails도 양쪽에 동기화
sent_list = sorted(sent_emails, key=str.lower)
for _sf in [SENT_JSON_BUILDER, SENT_JSON_ADMIN]:
    os.makedirs(os.path.dirname(_sf), exist_ok=True)
    with open(_sf, 'w', encoding='utf-8') as f:
        json.dump(sent_list, f, ensure_ascii=False, indent=2)

print(f"총 {result['totalChannels']}개 채널, 이메일 {result['totalEmails']}개, 기발송 {result['totalSent']}개")
print(f"저장: {OUT_ADMIN}, {OUT_BUILDER}")
