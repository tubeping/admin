"use client";

import { useState, useEffect } from "react";

interface PurchaseOrder {
  id: string;
  po_number: string;
  order_date: string;
  total_items: number;
  total_amount: number;
  access_password: string;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  completed_at: string | null;
  created_at: string;
  suppliers: { name: string; email: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성중",
  sent: "발송완료",
  viewed: "열람",
  completed: "송장등록완료",
  cancelled: "취소",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPOs = async () => {
    setLoading(true);
    const res = await fetch("/admin/api/purchase-orders");
    const data = await res.json();
    setPos(data.purchase_orders || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchPOs();
  }, []);

  // 이메일 발송
  const handleSendEmail = async (po: PurchaseOrder) => {
    const res = await fetch("/admin/api/purchase-orders/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchase_order_id: po.id }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`이메일 발송 완료: ${po.suppliers?.email}`);
      fetchPOs();
    } else {
      alert(`발송 실패: ${data.error}`);
    }
  };

  // 통계
  const stats = {
    total: pos.length,
    draft: pos.filter((p) => p.status === "draft").length,
    sent: pos.filter((p) => p.status === "sent" || p.status === "viewed").length,
    completed: pos.filter((p) => p.status === "completed").length,
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">발주서 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            공급사별 발주서 현황. 주문관리에서 발주서를 생성합니다.
          </p>
        </div>
        {stats.sent > 0 && (
          <button
            onClick={async () => {
              const res = await fetch("/admin/api/purchase-orders/remind", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
              const data = await res.json();
              alert(`리마인더 발송: ${data.sent}건 완료\n\n${data.results?.map((r: { supplier: string; email: string; success: boolean }) => `${r.supplier}: ${r.success ? r.email : "실패"}`).join("\n") || ""}`);
              fetchPOs();
            }}
            className="px-4 py-2.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors cursor-pointer"
          >
            미응답 전체 리마인더 ({stats.sent}건)
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "전체 발주서", value: `${stats.total}건` },
          { label: "작성중", value: `${stats.draft}건`, highlight: stats.draft > 0 },
          { label: "발송/열람", value: `${stats.sent}건` },
          { label: "송장등록 완료", value: `${stats.completed}건` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-lg font-bold mt-1 ${s.highlight ? "text-[#C41E1E]" : "text-gray-900"}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : pos.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            발주서가 없습니다. 주문관리에서 주문을 선택하고 발주서를 생성하세요.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left px-6 py-3 font-medium">발주번호</th>
                <th className="text-left px-3 py-3 font-medium">공급사</th>
                <th className="text-right px-3 py-3 font-medium">상품수</th>
                <th className="text-right px-3 py-3 font-medium">금액</th>
                <th className="text-center px-3 py-3 font-medium">비밀번호</th>
                <th className="text-center px-3 py-3 font-medium">상태</th>
                <th className="text-center px-3 py-3 font-medium">발송</th>
                <th className="text-center px-3 py-3 font-medium">열람</th>
                <th className="text-right px-6 py-3 font-medium">발주일</th>
                <th className="text-center px-3 py-3 font-medium">액션</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => (
                <tr key={po.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                  <td className="px-6 py-3.5 text-sm font-medium text-gray-900">
                    {po.po_number}
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-700">
                    <div>{po.suppliers?.name}</div>
                    <div className="text-xs text-gray-400">{po.suppliers?.email}</div>
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                    {po.total_items}
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                    ₩{po.total_amount.toLocaleString()}
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <code className="text-sm font-mono bg-gray-100 px-2 py-0.5 rounded">
                      {po.access_password}
                    </code>
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full ${
                        STATUS_STYLE[po.status] || STATUS_STYLE.draft
                      }`}
                    >
                      {STATUS_LABEL[po.status] || po.status}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-xs text-gray-500 text-center">
                    {po.sent_at ? po.sent_at.slice(0, 16).replace("T", " ") : "-"}
                  </td>
                  <td className="px-3 py-3.5 text-xs text-gray-500 text-center">
                    {po.viewed_at ? po.viewed_at.slice(0, 16).replace("T", " ") : "-"}
                  </td>
                  <td className="px-6 py-3.5 text-sm text-gray-500 text-right">
                    {po.order_date}
                  </td>
                  <td className="px-3 py-3.5 text-center space-x-2">
                    {po.status === "draft" && (
                      <button
                        onClick={() => handleSendEmail(po)}
                        className="text-xs text-[#C41E1E] hover:underline cursor-pointer"
                      >
                        메일 발송
                      </button>
                    )}
                    {(po.status === "sent" || po.status === "viewed") && (
                      <button
                        onClick={async () => {
                          const res = await fetch("/admin/api/purchase-orders/remind", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ purchase_order_id: po.id }),
                          });
                          const data = await res.json();
                          alert(data.sent > 0 ? `리마인더 발송 완료: ${po.suppliers?.email}` : "발송 대상 없음");
                        }}
                        className="text-xs text-orange-600 hover:underline cursor-pointer"
                      >
                        리마인더
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
