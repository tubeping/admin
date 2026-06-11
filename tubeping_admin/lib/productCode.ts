/**
 * 상품코드(tp_code) 합성·파싱 유틸 — 한 곳에서 관리.
 *
 * 코드 체계:
 *   코어코드(core)         = 물리적 상품의 공유키.  예) TPCZ00872  (TP + 공급사 short_code 2자 + 일련번호)
 *                            전화/문자 자동상품 계열 TP0002053(공급사 없음), 레거시 TP-0001 도 코어로 취급.
 *   공급사 코드            = "공급사명_" + 코어.    예) 귀빈정_TPCZ00872   (마스터 products.tp_code)
 *   판매사 코드            = "판매사명_" + 코어.    예) 코믹마트_TPCZ00872 (판매사몰 매핑 표시용)
 *
 * 뒤의 코어가 공급사↔판매사 간 공유키가 되어 자동 조인된다.
 */

// 접두사(공급사명_/판매사명_)를 떼고 뒤쪽 코어만 추출.
// 채널 무관: 앞 2글자(TP=튜핑 / EV=이벤트 / AR=아튜브 / AC=액츠 / 공급사 자체코드 SP·VS 등) + 코어를 모두 인식.
// 이름과 코드는 '_'로 분리되므로 영문 공급사명(test_, 이음리테일3PL_)이 있어도 코드부만 안전하게 잡는다.
// 뒤쪽 '-N'(변형/분할 표기, 예: EV0V00167-1)도 코어에 포함.
const CORE_RE = /([A-Z]{2}-?[A-Z0-9]*\d+(?:-\d+)?)\s*$/i;

/** 접두사 유무와 무관하게 코어코드(채널2+코어)를 대문자로 반환. 없으면 입력값 트림. */
export function coreCode(code: string | null | undefined): string {
  if (!code) return "";
  const m = code.match(CORE_RE);
  return (m ? m[1] : code).trim().toUpperCase();
}

/** 두 코드가 같은 물리적 상품(코어 일치)인지. */
export function sameCore(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = coreCode(a);
  return ca !== "" && ca === coreCode(b);
}

/** "공급사명_코어" 합성. 이름이 없으면 코어 그대로. */
export function withSupplierPrefix(core: string, supplierName?: string | null): string {
  const c = coreCode(core);
  const n = (supplierName || "").trim();
  return n ? `${n}_${c}` : c;
}

/** "판매사명_코어" 합성. 이름이 없으면 코어 그대로. */
export function withSellerPrefix(core: string, sellerName?: string | null): string {
  const c = coreCode(core);
  const n = (sellerName || "").trim();
  return n ? `${n}_${c}` : c;
}

/** 상품명 정규화 매칭용 — 공백/괄호/특수문자 제거 + 소문자. (마스터↔판매사몰 상품명 매칭) */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\[\](){}【】〔〕「」『』<>＜＞,.·•!?~@#$%^&*_=+\-\\/|"'`:;]/g, "")
    .trim();
}

// 코어 포맷: [채널2][공급사short_code2][숫자]
const TP_CODE_RE = /^([A-Z]{2})([A-Z0-9]{2})\d+$/;

/**
 * 코드(접두사 포함 가능)에서 공급사 short_code(가운데 2자) 추출.
 * 매칭 실패 시 null. (전화/문자 자동상품 TP0002053 류는 "00" 등 → 상위에서 short_code 매칭 실패로 무시됨)
 */
export function parseSupplierShort(code: string | null | undefined): string | null {
  const m = coreCode(code).match(TP_CODE_RE);
  return m ? m[2] : null;
}
