"use client";

import { useEffect, useState } from "react";
import Sidebar from "./_components/sidebar";

type RecentPO = {
  id: string;
  po_number: string;
  order_date: string;
  supplier_name: string;
  order_count: number;
  tracked_count: number;
  status: string;
  status_label: string;
  sent_at: string | null;
  viewed_at: string | null;
  source: string;
};
type Task = { title: string; assignee: string; due: string; priority: string };

type DashboardData = {
  stats: {
    productCount: number;
    monthPoCount: number;
    unsettledAmount: number;
    blogPostCount: number;
    poStatusCounts: { sent: number; viewed: number; completed: number };
  };
  recentPOs: RecentPO[];
  activeTasks: Task[];
};

const PO_STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

const PRIORITY_COLORS: Record<string, string> = {
  "높음": "bg-red-100 text-red-700",
  "중간": "bg-yellow-100 text-yellow-700",
  "낮음": "bg-gray-100 text-gray-500",
};

const KRW = new Intl.NumberFormat("ko-KR");

function formatKST(isoStr: string | null): string {
  if (!isoStr) return "-";
  return new Date(new Date(isoStr).getTime() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
}

export default function AdminDashboard() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/admin/api/dashboard/stats", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: DashboardData) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const statCards = [
    { label: "총 상품 수", value: data ? KRW.format(data.stats.productCount) : "—" },
    { label: "이번 달 발주", value: data ? `${KRW.format(data.stats.monthPoCount)}건` : "—" },
    { label: "발주서 이메일 발송", value: data ? `${data.stats.poStatusCounts.sent}건` : "—", highlight: data && data.stats.poStatusCounts.sent > 0 },
    { label: "발주서 열람", value: data ? `${data.stats.poStatusCounts.viewed}건` : "—" },
    { label: "송장등록완료", value: data ? `${data.stats.poStatusCounts.completed}건` : "—" },
    { label: "미정산 금액", value: data ? `₩${KRW.format(data.stats.unsettledAmount)}` : "—" },
  ];

  return (
    <div className="flex h-screen bg-[#F9FAFB]">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main
        className={`flex-1 overflow-y-auto transition-all duration-300 ${
          sidebarCollapsed ? "ml-[72px]" : "ml-[260px]"
        }`}
      >
        <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
            <p className="text-sm text-gray-500 mt-1">TubePing 어드민 현황을 한눈에 확인하세요.</p>
            {error && (
              <p className="text-xs text-red-500 mt-2">데이터 로드 실패: {error}</p>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-6 gap-4 mb-8">
            {statCards.map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500">{stat.label}</p>
                <p className={`text-xl font-bold mt-1 ${stat.highlight ? "text-blue-600" : "text-gray-900"}`}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Recent POs */}
            <div className="col-span-2 bg-white rounded-xl border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">최근 발주서</h2>
                <span className="text-xs text-gray-400">최근 10건</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-50">
                    <th className="text-center px-3 py-3 font-medium">발주일</th>
                    <th className="text-left px-3 py-3 font-medium">발주번호</th>
                    <th className="text-left px-3 py-3 font-medium">공급사</th>
                    <th className="text-center px-3 py-3 font-medium">주문</th>
                    <th className="text-center px-3 py-3 font-medium">송장</th>
                    <th className="text-center px-3 py-3 font-medium">상태</th>
                    <th className="text-center px-3 py-3 font-medium">발송시점</th>
                    <th className="text-center px-3 py-3 font-medium">열람시점</th>
                  </tr>
                </thead>
                <tbody>
                  {data === null && (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-sm text-gray-400 text-center">
                        불러오는 중…
                      </td>
                    </tr>
                  )}
                  {data && data.recentPOs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-sm text-gray-400 text-center">
                        최근 발주서가 없습니다
                      </td>
                    </tr>
                  )}
                  {data?.recentPOs.map((po) => (
                    <tr key={po.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-3 py-3 text-sm text-gray-500 text-center">{po.order_date}</td>
                      <td className="px-3 py-3 text-sm font-medium text-gray-900">
                        <span className="flex items-center gap-1">
                          {po.po_number}
                          {po.source === "legacy" && (
                            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-purple-100 text-purple-700">발주모아</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">{po.supplier_name}</td>
                      <td className="px-3 py-3 text-sm text-gray-700 text-center">{po.order_count}</td>
                      <td className="px-3 py-3 text-sm text-center">
                        <span className={po.tracked_count < po.order_count ? "text-orange-600 font-medium" : "text-green-600"}>
                          {po.tracked_count}/{po.order_count}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${PO_STATUS_STYLE[po.status] || PO_STATUS_STYLE.draft}`}>
                          {po.status_label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500 text-center">{formatKST(po.sent_at)}</td>
                      <td className="px-3 py-3 text-xs text-gray-500 text-center">{formatKST(po.viewed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tasks */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">진행 중 작업</h2>
              </div>
              <div className="p-4 space-y-3">
                {data === null && (
                  <p className="text-sm text-gray-400 text-center py-4">불러오는 중…</p>
                )}
                {data && data.activeTasks.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">진행 중인 작업이 없습니다</p>
                )}
                {data?.activeTasks.map((task, idx) => (
                  <div key={`${task.title}-${idx}`} className="p-4 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
                    <p className="text-sm font-medium text-gray-900">{task.title}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-500">{task.assignee}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{task.due}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${PRIORITY_COLORS[task.priority] || "bg-gray-100 text-gray-500"}`}>
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
