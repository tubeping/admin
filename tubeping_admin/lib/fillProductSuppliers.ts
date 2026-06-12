import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSupplierShort, normalizeName } from "./productCode";

/**
 * 공급사 비어있는 products.supplier 를 자동 보정한다.
 *
 * 카페24 마스터몰(tubeping) import 는 product.supplier_code → 공급사명을 채우지만,
 * 전화/문자 자동상품·수기 등록 상품(TP0002xxx 계열)은 마스터몰에 없어 공급사가 빈다.
 * 판매사 자사몰은 공급사를 default(S0000000)로만 들고 있어 소스가 될 수 없다.
 * → 이미 공급사가 채워진 마스터 카탈로그 + 공급사 마스터(suppliers)에서 역으로 도출한다.
 *
 * 도출 우선순위 (먼저 맞는 것 채택):
 *   M1 short  : tp_code 가운데 2자 → suppliers.short_code (정상 코드 상품)
 *   M2 exact  : 같은(정규화) 상품명을 가진, 공급사 보유 카탈로그 상품
 *   M3 substr : 상품명이 카탈로그 상품명을 포함/피포함 (공유 길이 ≥ 8)
 *   M4 token  : 공급사명(정규화 길이 ≥ 3)이 상품명에 그대로 포함 (예: '…귀빈정 명품…' → 귀빈정)
 *
 * 안전장치:
 *   - supplier 가 비어있는(null/공백/'-') 상품만 대상. 기존값은 절대 덮어쓰지 않음.
 *   - dryRun=true 면 계획만 반환하고 쓰지 않음.
 */

export type FillMethod = "short" | "exact" | "substr" | "token";

export interface FillPlanItem {
  id: string;
  tp_code: string;
  product_name: string;
  supplier: string;
  method: FillMethod;
  via?: string; // 매칭 근거(카탈로그 상품명/공급사명)
}

export interface FillResult {
  emptyCount: number;
  plan: FillPlanItem[];
  applied: number;
  failed: number;
  unmatched: { tp_code: string; product_name: string }[];
  dryRun: boolean;
}

function isEmpty(s: string | null | undefined): boolean {
  return !s || !String(s).trim() || String(s).trim() === "-";
}

async function fetchAll<T>(
  sb: SupabaseClient,
  table: string,
  cols: string
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data || []) as T[]));
    if (!data || data.length < page) break;
    from += page;
  }
  return out;
}

export async function fillProductSuppliers(
  sb: SupabaseClient,
  opts: { dryRun?: boolean } = {}
): Promise<FillResult> {
  const dryRun = !!opts.dryRun;

  type Sup = { name: string | null; short_code: string | null };
  type Prod = { id: string; tp_code: string | null; product_name: string | null; supplier: string | null };

  const suppliers = await fetchAll<Sup>(sb, "suppliers", "name, short_code");
  const products = await fetchAll<Prod>(sb, "products", "id, tp_code, product_name, supplier");

  // short_code → 공급사명
  const shortToName = new Map<string, string>();
  // 공급사명 토큰 후보 (정규화 길이 ≥ 3): [정규화명, 원본명]
  const supplierTokens: { norm: string; name: string }[] = [];
  for (const s of suppliers) {
    const name = (s.name || "").trim();
    if (s.short_code) shortToName.set(String(s.short_code).trim().toUpperCase(), name || String(s.short_code));
    const n = normalizeName(name);
    if (name && n.length >= 3) supplierTokens.push({ norm: n, name });
  }
  // 긴 공급사명을 먼저 시도(더 구체적인 매칭 우선)
  supplierTokens.sort((a, b) => b.norm.length - a.norm.length);

  // 공급사 보유 카탈로그: 정규화명 → 공급사명 / 부분매칭용 목록
  const exactNameToSupplier = new Map<string, string>();
  const catalog: { norm: string; supplier: string }[] = [];
  for (const p of products) {
    if (isEmpty(p.supplier)) continue;
    const n = normalizeName(p.product_name || "");
    if (!n) continue;
    if (!exactNameToSupplier.has(n)) exactNameToSupplier.set(n, (p.supplier as string).trim());
    catalog.push({ norm: n, supplier: (p.supplier as string).trim() });
  }

  const empties = products.filter((p) => isEmpty(p.supplier));
  const plan: FillPlanItem[] = [];
  const unmatched: { tp_code: string; product_name: string }[] = [];

  for (const p of empties) {
    const name = p.product_name || "";
    const n = normalizeName(name);
    let supplier: string | null = null;
    let method: FillMethod | null = null;
    let via: string | undefined;

    // M1 short_code
    const sh = parseSupplierShort(p.tp_code);
    if (sh && shortToName.has(sh.toUpperCase())) {
      const cand = shortToName.get(sh.toUpperCase())!;
      if (!isEmpty(cand)) {
        supplier = cand;
        method = "short";
        via = sh.toUpperCase();
      }
    }

    // M2 exact catalog name
    if (!supplier && n && exactNameToSupplier.has(n)) {
      supplier = exactNameToSupplier.get(n)!;
      method = "exact";
      via = name.slice(0, 30);
    }

    // M3 substring catalog name (공유 길이 ≥ 8)
    if (!supplier && n.length >= 8) {
      for (const c of catalog) {
        if (c.norm === n) continue;
        const shared = Math.min(c.norm.length, n.length);
        if (shared >= 8 && (c.norm.includes(n) || n.includes(c.norm))) {
          supplier = c.supplier;
          method = "substr";
          via = c.norm.slice(0, 24);
          break;
        }
      }
    }

    // M4 공급사명 토큰
    if (!supplier && n) {
      for (const t of supplierTokens) {
        if (n.includes(t.norm)) {
          supplier = t.name;
          method = "token";
          via = t.name;
          break;
        }
      }
    }

    if (supplier && method) {
      plan.push({
        id: p.id,
        tp_code: p.tp_code || "",
        product_name: name,
        supplier,
        method,
        via,
      });
    } else {
      unmatched.push({ tp_code: p.tp_code || "", product_name: name });
    }
  }

  let applied = 0;
  let failed = 0;
  if (!dryRun) {
    for (const item of plan) {
      // 다시 한 번 비어있을 때만 갱신(동시성/안전)
      const { error } = await sb
        .from("products")
        .update({ supplier: item.supplier })
        .eq("id", item.id);
      if (error) {
        failed++;
        console.error("[fillProductSuppliers] update 실패:", item.tp_code, error.message);
      } else {
        applied++;
      }
    }
  }

  return {
    emptyCount: empties.length,
    plan,
    applied,
    failed,
    unmatched,
    dryRun,
  };
}
