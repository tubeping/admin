/** 판매방식별 주문번호 접두사 */
export const CHANNEL_PREFIX: Record<string, string> = {
  phone: "TEL",
  sms: "SMS",
  sample: "SPL",
  etc: "ETC",
  group: "JP",
  gift: "GFT",
};

/** 주문번호에서 접두사를 제거하여 정렬용 키 반환 */
export function orderIdSortKey(id: string): string {
  return id.replace(/^(TEL|SMS|SPL|ETC|JP|GFT|MR|EXCEL)-/, "");
}
