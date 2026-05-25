"use client";

import { useEffect, useState } from "react";
import Sidebar from "./_components/sidebar";

type StatCard = { label: string; value: string };
type Order = {
  id: string;
  product: string;
  channel: string;
  qty: number;
  status: string;
  date: string;
};
type Task = { title: string; assignee: string; due: string; priority: string };

type DashboardData = {
  stats: {
    productCount: number;
    monthPoCount: number;
    unsettledAmount: number;
    blogPostCount: number;
  };
  recentOrders: Order[];
  activeTasks: Task[];
};

const STATUS_COLORS: Record<string, string> = {
  "발주완료": "bg-blue-100 text-blue-700",
  "배송중": "bg-yellow-100 text-yellow-700",
  "정산대기": "bg-orange-100 text-orange-700",
  "배송완료": "bg-green-100 text-green-700",
  "대기": "bg-gray-100 text-gray-600",
  "취소": "bg-red-100 text-red-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  "높음": "bg-red-100 text-red-700",
  "중간": "bg-yellow-100 text-yellow-700",
  "낮음": "bg-gray-100 text-gray-500",
};

const KRW = new Intl.NumberFormat("ko-KR");

function buildStatCards(d: DashboardData | null): StatCard[] {
  return [
    { label: "총 상품 수", value: d ? KRW.format(d.stats.productCount) : "—" },
    { label: "이번 달 발주", value: d ? KRW.format(d.stats.monthPoCount) : "—" },
    { label: "미정산 금액", value: d ? `₩${KRW.format(d.stats.unsettledAmount)}` : "—" },
    { label: "블로그 게시글", value: d ? KRW.format(d.stats.blogPostCount) : "—" },
  ];
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

  const stats = buildStatCards(data);

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
          <div className="grid grid-cols-4 gap-5 mb-8">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Recent Orders */}
            <div className="col-span-2 bg-white rounded-xl border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">최근 발주</h2>
                <span className="text-xs text-gray-400">최근 5건</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-50">
                    <th className="text-left px-6 py-3 font-medium">주문번호</th>
                    <th className="text-left px-3 py-3 font-medium">상품</th>
                    <th className="text-left px-3 py-3 font-medium">채널</th>
                    <th className="text-right px-3 py-3 font-medium">수량</th>
                    <th className="text-center px-3 py-3 font-medium">상태</th>
                    <th className="text-right px-6 py-3 font-medium">날짜</th>
                  </tr>
                </thead>
                <tbody>
                  {data === null && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-sm text-gray-400 text-center">
                        불러오는 중…
                      </td>
                    </tr>
                  )}
                  {data && data.recentOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-sm text-gray-400 text-center">
                        최근 주문이 없습니다
                      </td>
                    </tr>
                  )}
                  {data?.recentOrders.map((order) => (
                    <tr key={order.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{order.id}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{order.product}</td>
                      <td className="px-3 py-3 text-sm text-gray-500">{order.channel}</td>
                      <td className="px-3 py-3 text-sm text-gray-700 text-right">{order.qty}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-600"}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500 text-right">{order.date}</td>
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
