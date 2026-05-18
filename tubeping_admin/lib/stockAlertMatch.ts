import type { SupabaseClient } from "@supabase/supabase-js";

const STOPWORDS = new Set([
  "상품", "전상품", "옵션", "해외", "병행", "수입", "기타", "외", "등", "안내",
  "공지", "전제품", "포함", "변경", "신상품",
]);

/**
 * 상품명 후보 → 매칭용 토큰 분리.
 * - 괄호/대괄호 안 내용 제거 ("한라봉(340ml)" → "한라봉")
 * - 단위 제거 (kg, ml, 개, 팩 등)
 * - 특수문자 → 공백
 * - 2자 이상 토큰만 유지, 불용어 제거
 */
export function tokenizeForMatch(name: string): string[] {
  let s = name;
  s = s.replace(/[\(\[\{][^)\]}]*[\)\]\}]/g, " ");
  s = s.replace(/\b\d+\s*(kg|g|ml|개|입|팩|세트|박스|매|장|병|포|봉|인분|과)\b/gi, " ");
  s = s.replace(/[/+,·\-_~!@#$%^&*=<>?:;"'\\|]+/g, " ");
  const raw = s.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export interface MatchedProduct {
  id: string;
  tp_code: string;
  product_name: string;
  selling: string;
  _score: number;
  _hit_tokens: string[];
}

/**
 * 공급사명 정규화 — 가운데 공백/접두어/괄호 제거.
 * "(주)티알에스큐" → "티알에스큐"
 */
function normalizeSupplier(name: string): string {
  return name
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * 토큰 기반 상품 매칭.
 * - 토큰별 ILIKE OR 검색 → 히트 점수 누적
 * - supplierName 지정 시 그 공급사 상품 우선 (가산점)
 * - 최소 점수 미달은 제외
 */
export async function matchProductsByTokens(
  sb: SupabaseClient,
  tokens: string[],
  opts: { supplierName?: string | null; limit?: number; minScore?: number } = {}
): Promise<MatchedProduct[]> {
  const limit = opts.limit ?? 10;
  const minScore = opts.minScore ?? 1;
  if (tokens.length === 0) return [];

  const supNorm = opts.supplierName ? normalizeSupplier(opts.supplierName) : "";

  const scored = new Map<string, MatchedProduct>();

  for (const tok of tokens) {
    if (tok.length < 2) continue;
    const { data } = await sb
      .from("products")
      .select("id, tp_code, product_name, selling, supplier")
      .ilike("product_name", `%${tok}%`)
      .limit(limit * 3);
    for (const p of data || []) {
      const key = p.id as string;
      const existing = scored.get(key);
      const productSupNorm = p.supplier ? normalizeSupplier(p.supplier) : "";
      const supplierBonus =
        supNorm && productSupNorm && (productSupNorm.includes(supNorm) || supNorm.includes(productSupNorm))
          ? 0.5
          : 0;
      if (existing) {
        if (!existing._hit_tokens.includes(tok)) {
          existing._score += 1 + supplierBonus;
          existing._hit_tokens.push(tok);
        }
      } else {
        scored.set(key, {
          id: p.id,
          tp_code: p.tp_code,
          product_name: p.product_name,
          selling: p.selling,
          _score: 1 + supplierBonus,
          _hit_tokens: [tok],
        });
      }
    }
  }

  return Array.from(scored.values())
    .filter((p) => p._score >= minScore)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

/**
 * 상품명 리스트 → 토큰 통합 → 매칭.
 */
export async function matchProductsForAlert(
  sb: SupabaseClient,
  productNames: string[],
  opts: { supplierName?: string | null; limit?: number } = {}
): Promise<MatchedProduct[]> {
  const allTokens: string[] = [];
  const seen = new Set<string>();
  for (const name of productNames) {
    for (const tok of tokenizeForMatch(name)) {
      if (!seen.has(tok)) {
        seen.add(tok);
        allTokens.push(tok);
      }
    }
  }
  return matchProductsByTokens(sb, allTokens, opts);
}
