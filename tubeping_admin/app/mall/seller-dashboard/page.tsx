"use client";

import { useState, useEffect, useCallback } from "react";

interface SellerLink {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  status: string;
  view_token: string | null;
}

export default function SellerDashboardPage() {
  const [clients, setClients] = useState<SellerLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/admin/api/phone-order-clients?status=active");
    const data = await res.json();
    setClients((data.clients || []).filter((c: SellerLink) => c.view_token));
    setLoading(false);
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const copyLink = async (client: SellerLink) => {
    const url = `${baseUrl}/admin/seller/${client.view_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(client.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      prompt("링크를 복사하세요:", url);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">판매사 대시보드</h1>
        <p className="text-sm text-gray-500 mt-0.5">판매사별 주문 현황 조회 링크를 관리합니다</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="py-16 text-center text-gray-400">불러오는 중...</p>
        ) : clients.length === 0 ? (
          <p className="py-16 text-center text-gray-400">등록된 판매처가 없습니다</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">판매처명</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">담당자</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">대시보드 URL</th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const url = `${baseUrl}/admin/seller/${c.view_token}`;
                return (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-500">
                      {c.contact_name || "-"}
                      {c.phone && <span className="ml-2 text-gray-400">{c.phone}</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline font-mono"
                      >
                        /admin/seller/{c.view_token}
                      </a>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => copyLink(c)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            copied === c.id
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {copied === c.id ? "복사됨!" : "링크 복사"}
                        </button>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#C41E1E] text-white hover:bg-[#A01818] transition-colors"
                        >
                          열기
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
