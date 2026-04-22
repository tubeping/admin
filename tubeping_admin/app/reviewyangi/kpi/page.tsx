import Link from "next/link";

type Kpi = {
  generatedAt: string;
  phase: number;
  phaseTargets: Record<string, number>;
  content: { reviews: number; guides: number; hotdeals: number };
  weeklyNew: { reviews: number; guides: number };
  guideImageCoverage: { total: number; with_image: number; pct: number };
  audit: {
    errors: number | null;
    warnings: number | null;
    report: string | null;
    ran_at: string | null;
  };
  hotdealFreshness: {
    count: number;
    latest_created: string | null;
    stale_hours: number | null;
  };
  recent: {
    kind: string;
    slug: string;
    title: string;
    category: string;
    updatedAt: string;
  }[];
  notes: string;
};

const KPI_URL = "https://reviewyangi.com/api/kpi.json";

export const revalidate = 300; // 5분 캐시

async function loadKpi(): Promise<Kpi | null> {
  try {
    const res = await fetch(KPI_URL, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as Kpi;
  } catch {
    return null;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatCard({
  label,
  value,
  target,
  suffix = "",
  highlight,
}: {
  label: string;
  value: number | string;
  target?: number | string;
  suffix?: string;
  highlight?: "good" | "warn" | "bad" | null;
}) {
  const color =
    highlight === "good"
      ? "border-green-200 bg-green-50"
      : highlight === "warn"
      ? "border-amber-200 bg-amber-50"
      : highlight === "bad"
      ? "border-red-200 bg-red-50"
      : "border-gray-200 bg-white";
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">
        {value}
        {suffix}
      </p>
      {target !== undefined && (
        <p className="mt-1 text-xs text-gray-400">목표 {target}{suffix}</p>
      )}
    </div>
  );
}

export default async function ReviewYangiKpiPage() {
  const kpi = await loadKpi();

  if (!kpi) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">리뷰양이 KPI 대시보드</h1>
        <p className="mt-4 text-gray-500">
          KPI 데이터를 불러올 수 없습니다. <code>{KPI_URL}</code> 접근 실패.
        </p>
      </div>
    );
  }

  const auditBadge =
    kpi.audit.errors && kpi.audit.errors > 0
      ? "bad"
      : kpi.audit.warnings && kpi.audit.warnings > 0
      ? "warn"
      : "good";
  const imageCovBadge =
    kpi.guideImageCoverage.pct >= 100
      ? "good"
      : kpi.guideImageCoverage.pct >= 50
      ? "warn"
      : "bad";
  const hotdealBadge =
    kpi.hotdealFreshness.stale_hours && kpi.hotdealFreshness.stale_hours > 12
      ? "warn"
      : "good";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            🐑 리뷰양이 KPI 대시보드
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Phase {kpi.phase} · 마지막 갱신 {formatDate(kpi.generatedAt)}
          </p>
        </div>
        <Link
          href="https://reviewyangi.com"
          target="_blank"
          className="text-sm text-blue-600 hover:underline"
        >
          사이트 방문 →
        </Link>
      </div>

      {/* Content stats */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">콘텐츠 현황</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="리뷰" value={kpi.content.reviews} />
          <StatCard label="가이드" value={kpi.content.guides} />
          <StatCard label="핫딜" value={kpi.content.hotdeals} />
          <StatCard
            label="이미지 커버율"
            value={kpi.guideImageCoverage.pct}
            target={kpi.phaseTargets.guide_image_coverage_pct}
            suffix="%"
            highlight={imageCovBadge}
          />
        </div>
      </section>

      {/* Production KPI */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          생산 · 품질 (주간)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="주간 신규 리뷰"
            value={kpi.weeklyNew.reviews}
          />
          <StatCard
            label="주간 신규 가이드"
            value={kpi.weeklyNew.guides}
          />
          <StatCard
            label="주간 신규 합계"
            value={kpi.weeklyNew.reviews + kpi.weeklyNew.guides}
            target={kpi.phaseTargets.weekly_new_content}
            highlight={
              kpi.weeklyNew.reviews + kpi.weeklyNew.guides >=
              kpi.phaseTargets.weekly_new_content
                ? "good"
                : "warn"
            }
          />
          <StatCard
            label="Audit Errors"
            value={kpi.audit.errors ?? "-"}
            target={kpi.phaseTargets.audit_errors}
            highlight={auditBadge}
          />
        </div>
      </section>

      {/* Hotdeal freshness */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">핫딜 신선도</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="활성 핫딜" value={kpi.hotdealFreshness.count} />
          <StatCard
            label="최근 수집 경과"
            value={kpi.hotdealFreshness.stale_hours ?? "-"}
            suffix="시간"
            highlight={hotdealBadge}
          />
          <StatCard
            label="Audit Warnings"
            value={kpi.audit.warnings ?? "-"}
          />
        </div>
      </section>

      {/* Recent feed */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          최근 변경 콘텐츠
        </h2>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left p-3">종류</th>
                <th className="text-left p-3">제목</th>
                <th className="text-left p-3">카테고리</th>
                <th className="text-left p-3">업데이트</th>
              </tr>
            </thead>
            <tbody>
              {kpi.recent.map((r, i) => (
                <tr
                  key={`${r.kind}-${r.slug}-${i}`}
                  className="border-t border-gray-100"
                >
                  <td className="p-3 text-xs uppercase text-gray-500">
                    {r.kind}
                  </td>
                  <td className="p-3">
                    <Link
                      href={`https://reviewyangi.com/${r.kind}/${r.slug}`}
                      target="_blank"
                      className="text-blue-600 hover:underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="p-3 text-gray-500">{r.category}</td>
                  <td className="p-3 text-gray-500 text-xs">
                    {formatDate(r.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phase note */}
      <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">Phase {kpi.phase} 기준</p>
        <p className="mt-1 text-blue-800">{kpi.notes}</p>
        <p className="mt-2 text-xs text-blue-700">
          Audit 리포트: {kpi.audit.report ?? "없음"} · 감사 시각:{" "}
          {formatDate(kpi.audit.ran_at)}
        </p>
      </section>
    </div>
  );
}
