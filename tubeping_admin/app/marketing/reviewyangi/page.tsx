"use client";

import { useEffect, useState } from "react";

type ReviewItem = {
  id: string;
  slug: string;
  title: string;
  category: string;
  subcategory?: string;
  totalScore?: number;
  badge?: string;
  price?: number;
  image?: string;
  updatedAt: string;
  views?: number;
  status?: string;
};

type GuideItem = {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  updatedAt: string;
};

type HotdealItem = {
  id: string;
  title: string;
  category: string;
  subcategory?: string;
  price?: number;
  store?: string;
  url: string;
  source?: string;
  createdAt: string;
  status?: string;
};

type GscRow = {
  query?: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type Gsc = {
  period?: { start: string; end: string };
  totals?: { clicks: number; impressions: number; ctr: number; position: number };
  daily?: (GscRow & { date: string })[];
  queries?: GscRow[];
  pages?: GscRow[];
  fetchedAt?: string;
  error?: string;
};

type Kpi = {
  generatedAt: string;
  content: { reviews: number; guides: number; hotdeals: number };
  weeklyNew: { reviews: number; guides: number };
  guideImageCoverage: { total: number; with_image: number; pct: number };
  audit: { errors: number | null; warnings: number | null; report: string | null; ran_at: string | null };
  hotdealFreshness: { count: number; latest_created: string | null; stale_hours: number | null };
  quality?: {
    reviews?: { count: number; avg: number; above_90_count: number; below_70_count: number };
    guides?: { count: number; avg: number; above_90_count: number; below_70_count: number };
  };
  history?: { date: string; reviews: number; guides: number }[];
  contentList?: { reviews: ReviewItem[]; guides: GuideItem[]; hotdeals: HotdealItem[] };
  gsc?: Gsc;
};

const KPI_URL = "https://reviewyangi.com/api/kpi.json";

type Tab = "overview" | "reviews" | "guides" | "hotdeals" | "search";

export default function ReviewYangiAdminPage() {
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`${KPI_URL}?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setKpi)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">로딩 중...</div>;
  if (error || !kpi) {
    return (
      <div className="p-8">
        <p className="text-red-600 font-semibold mb-2">KPI 데이터 로드 실패</p>
        <p className="text-sm text-gray-500">{error || "데이터 없음"}</p>
        <p className="text-xs text-gray-400 mt-2">URL: {KPI_URL}</p>
      </div>
    );
  }

  const fmt = (n?: number) => (n ?? 0).toLocaleString("ko-KR");
  const fmtDate = (iso?: string) => {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  };

  const list = kpi.contentList || { reviews: [], guides: [], hotdeals: [] };
  const filter = <T extends { title?: string; slug?: string; category?: string }>(arr: T[]) =>
    search.trim()
      ? arr.filter((x) =>
          [x.title, x.slug, x.category]
            .filter(Boolean)
            .some((s) => (s as string).toLowerCase().includes(search.toLowerCase()))
        )
      : arr;

  const reviewsSorted = [...list.reviews].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const guidesSorted = [...list.guides].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const hotdealsSorted = [...list.hotdeals].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">🦉 리뷰양이 자동화 현황</h2>
          <p className="text-xs text-gray-500 mt-1">
            reviewyangi.com 실시간 데이터 · 마지막 갱신 {fmtDate(kpi.generatedAt)}
          </p>
        </div>
        <a
          href="https://reviewyangi.com"
          target="_blank"
          rel="noopener"
          className="text-sm text-blue-600 hover:underline"
        >
          사이트 방문 →
        </a>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <Stat label="총 리뷰" value={kpi.content.reviews} accent="text-red-600" />
        <Stat label="총 가이드" value={kpi.content.guides} accent="text-blue-600" />
        <Stat label="활성 핫딜" value={kpi.content.hotdeals} accent="text-green-600" />
        <Stat
          label="주간 신규"
          value={kpi.weeklyNew.reviews + kpi.weeklyNew.guides}
          subtitle={`R${kpi.weeklyNew.reviews}+G${kpi.weeklyNew.guides}`}
        />
        <Stat
          label="audit"
          value={kpi.audit.errors ?? "-"}
          subtitle={`${kpi.audit.warnings ?? 0} warnings`}
          accent={(kpi.audit.errors ?? 0) > 0 ? "text-red-600" : "text-green-600"}
        />
        <Stat
          label="핫딜 신선도"
          value={`${kpi.hotdealFreshness.stale_hours ?? "-"}h`}
          subtitle="최근 갱신"
        />
      </div>

      {/* Quality grid */}
      {kpi.quality && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="리뷰 평균 점수" value={`${kpi.quality.reviews?.avg ?? "-"}점`} accent="text-purple-600" />
          <Stat
            label="90+ 리뷰"
            value={`${kpi.quality.reviews?.above_90_count ?? 0} / ${kpi.quality.reviews?.count ?? 0}`}
          />
          <Stat label="가이드 평균" value={`${kpi.quality.guides?.avg ?? "-"}점`} accent="text-purple-600" />
          <Stat
            label="이미지 커버"
            value={`${kpi.guideImageCoverage.pct}%`}
            accent={kpi.guideImageCoverage.pct >= 100 ? "text-green-600" : "text-amber-600"}
          />
        </div>
      )}

      {/* External dashboards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        <ExtLink href="https://partners.coupang.com/#affiliate/reports/days" label="쿠팡 파트너스" sub="클릭·수익" color="red" />
        <ExtLink href="https://search.google.com/search-console" label="Google Search Console" sub="색인·노출" color="blue" />
        <ExtLink href="https://searchadvisor.naver.com" label="네이버 서치어드바이저" sub="수집 요청" color="green" />
        <ExtLink href="https://vercel.com/choijun-2600s-projects/reviewyangi/analytics" label="Vercel Analytics" sub="방문자" color="purple" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { k: "overview", l: `📊 개요` },
          { k: "search", l: `🔍 검색 노출` },
          { k: "reviews", l: `📝 리뷰 (${kpi.content.reviews})` },
          { k: "guides", l: `📖 가이드 (${kpi.content.guides})` },
          { k: "hotdeals", l: `🔥 핫딜 (${kpi.content.hotdeals})` },
        ] as { k: Tab; l: string }[]).map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-md text-sm font-medium cursor-pointer ${
              tab === t.k ? "bg-white text-[#C41E1E] shadow-sm" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* Search */}
      {tab !== "overview" && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목·slug·카테고리 검색..."
          className="w-full mb-4 px-3 py-2 text-sm border border-gray-200 rounded-md outline-none focus:border-[#C41E1E]"
        />
      )}

      {/* Overview: 14-day history */}
      {tab === "overview" && kpi.history && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">
            작성 추이 (최근 14일)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left p-2 pl-4">날짜</th>
                <th className="text-right p-2">리뷰</th>
                <th className="text-right p-2">가이드</th>
                <th className="text-right p-2 pr-4">합계</th>
              </tr>
            </thead>
            <tbody>
              {kpi.history.slice(0, 14).map((h) => (
                <tr key={h.date} className="border-t border-gray-100">
                  <td className="p-2 pl-4 text-gray-700">{h.date}</td>
                  <td className="p-2 text-right">{h.reviews}</td>
                  <td className="p-2 text-right">{h.guides}</td>
                  <td className="p-2 pr-4 text-right font-semibold">{h.reviews + h.guides}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reviews tab */}
      {tab === "reviews" && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left p-3">제목</th>
                <th className="text-left p-3">카테고리</th>
                <th className="text-right p-3">점수</th>
                <th className="text-right p-3">조회</th>
                <th className="text-right p-3">가격</th>
                <th className="text-left p-3">갱신</th>
              </tr>
            </thead>
            <tbody>
              {filter(reviewsSorted).map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3">
                    <a
                      href={`https://reviewyangi.com/review/${r.slug}`}
                      target="_blank"
                      rel="noopener"
                      className="text-blue-600 hover:underline"
                    >
                      {r.title}
                    </a>
                    <div className="text-xs text-gray-400">{r.slug}</div>
                  </td>
                  <td className="p-3 text-gray-600 text-xs">
                    {r.category} {r.subcategory ? `· ${r.subcategory}` : ""}
                  </td>
                  <td className="p-3 text-right font-semibold">{r.totalScore ?? "-"}</td>
                  <td className="p-3 text-right text-gray-500">{fmt(r.views)}</td>
                  <td className="p-3 text-right text-gray-500">{fmt(r.price)}원</td>
                  <td className="p-3 text-gray-500 text-xs">{r.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Guides tab */}
      {tab === "guides" && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left p-3">제목</th>
                <th className="text-left p-3">카테고리</th>
                <th className="text-left p-3">발췌</th>
                <th className="text-left p-3">갱신</th>
              </tr>
            </thead>
            <tbody>
              {filter(guidesSorted).map((g) => (
                <tr key={g.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3">
                    <a
                      href={`https://reviewyangi.com/guide/${g.slug}`}
                      target="_blank"
                      rel="noopener"
                      className="text-blue-600 hover:underline"
                    >
                      {g.title}
                    </a>
                  </td>
                  <td className="p-3 text-gray-600 text-xs">{g.category}</td>
                  <td className="p-3 text-gray-500 text-xs line-clamp-2 max-w-md">{g.excerpt}</td>
                  <td className="p-3 text-gray-500 text-xs">{g.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Search (GSC) tab */}
      {tab === "search" && (
        <div className="space-y-4">
          {kpi.gsc?.error || !kpi.gsc?.totals ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
              <p className="font-semibold mb-1">Google Search Console 데이터 없음</p>
              <p className="text-xs">{kpi.gsc?.error || "다음 자동 사이클에서 수집됨"}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="총 클릭" value={kpi.gsc.totals.clicks} accent="text-blue-600" />
                <Stat label="총 노출" value={fmt(kpi.gsc.totals.impressions)} accent="text-blue-600" />
                <Stat label="CTR" value={`${kpi.gsc.totals.ctr}%`} />
                <Stat label="평균 순위" value={kpi.gsc.totals.position} subtitle="낮을수록 좋음" />
              </div>
              <p className="text-xs text-gray-500">
                기간: {kpi.gsc.period?.start} ~ {kpi.gsc.period?.end} · 갱신:{" "}
                {fmtDate(kpi.gsc.fetchedAt)}
              </p>

              {/* Top queries */}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">
                  TOP 검색어 ({kpi.gsc.queries?.length ?? 0})
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left p-2 pl-4">검색어</th>
                      <th className="text-right p-2">클릭</th>
                      <th className="text-right p-2">노출</th>
                      <th className="text-right p-2">CTR</th>
                      <th className="text-right p-2 pr-4">평균 순위</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(kpi.gsc.queries ?? []).map((q, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="p-2 pl-4 text-gray-700">{q.query}</td>
                        <td className="p-2 text-right font-semibold">{q.clicks}</td>
                        <td className="p-2 text-right text-gray-600">{fmt(q.impressions)}</td>
                        <td className="p-2 text-right text-gray-500">{q.ctr}%</td>
                        <td className="p-2 pr-4 text-right text-gray-500">{q.position}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Top pages */}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">
                  TOP 페이지 ({kpi.gsc.pages?.length ?? 0})
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left p-2 pl-4">URL</th>
                      <th className="text-right p-2">클릭</th>
                      <th className="text-right p-2">노출</th>
                      <th className="text-right p-2">CTR</th>
                      <th className="text-right p-2 pr-4">평균 순위</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(kpi.gsc.pages ?? []).map((p, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="p-2 pl-4 text-blue-600 text-xs break-all">
                          <a href={p.page} target="_blank" rel="noopener" className="hover:underline">
                            {(p.page || "").replace("https://reviewyangi.com", "")}
                          </a>
                        </td>
                        <td className="p-2 text-right font-semibold">{p.clicks}</td>
                        <td className="p-2 text-right text-gray-600">{fmt(p.impressions)}</td>
                        <td className="p-2 text-right text-gray-500">{p.ctr}%</td>
                        <td className="p-2 pr-4 text-right text-gray-500">{p.position}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Hotdeals tab */}
      {tab === "hotdeals" && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left p-3">제목</th>
                <th className="text-left p-3">카테고리</th>
                <th className="text-right p-3">가격</th>
                <th className="text-left p-3">스토어</th>
                <th className="text-left p-3">수집</th>
              </tr>
            </thead>
            <tbody>
              {filter(hotdealsSorted).slice(0, 50).map((h) => (
                <tr key={h.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3">
                    <a href={h.url} target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                      {h.title}
                    </a>
                  </td>
                  <td className="p-3 text-gray-600 text-xs">
                    {h.category} {h.subcategory ? `· ${h.subcategory}` : ""}
                  </td>
                  <td className="p-3 text-right text-gray-500">{h.price ? `${fmt(h.price)}원` : "-"}</td>
                  <td className="p-3 text-gray-500 text-xs">{h.store || h.source}</td>
                  <td className="p-3 text-gray-500 text-xs">{fmtDate(h.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent || "text-gray-900"}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ExtLink({
  href,
  label,
  sub,
  color,
}: {
  href: string;
  label: string;
  sub: string;
  color: "red" | "blue" | "green" | "purple";
}) {
  const cls = {
    red: "border-red-200 bg-red-50 hover:bg-red-100",
    blue: "border-blue-200 bg-blue-50 hover:bg-blue-100",
    green: "border-green-200 bg-green-50 hover:bg-green-100",
    purple: "border-purple-200 bg-purple-50 hover:bg-purple-100",
  }[color];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className={`rounded-lg border p-3 transition-colors ${cls}`}
    >
      <p className="text-xs font-semibold text-gray-700">{label}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub} →</p>
    </a>
  );
}
