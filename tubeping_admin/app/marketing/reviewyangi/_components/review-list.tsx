"use client";

import { useState } from "react";
import type { Review } from "../page";

const STATUS_STYLE: Record<string, string> = {
  "발행됨": "bg-green-100 text-green-700",
  "초안": "bg-gray-100 text-gray-600",
  "검토중": "bg-yellow-100 text-yellow-700",
};

const BADGE_LABEL: Record<string, { label: string; color: string }> = {
  best: { label: "베스트픽", color: "bg-[#C41E1E] text-white" },
  value: { label: "가성비픽", color: "bg-blue-500 text-white" },
  premium: { label: "프리미엄픽", color: "bg-purple-500 text-white" },
  plus: { label: "플러스픽", color: "bg-green-500 text-white" },
};

const CATEGORIES = ["전체", "주방가전", "생활가전", "계절가전", "디지털/IT", "뷰티/헬스", "육아용품"];

type Props = {
  reviews: Review[];
  onEdit: (review: Review) => void;
  onCreate: () => void;
  onDelete: (id: number) => void;
};

export default function ReviewList({ reviews, onEdit, onCreate, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("전체");
  const [statusFilter, setStatusFilter] = useState("전체");

  const filtered = reviews.filter((r) => {
    const matchSearch =
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.product.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === "전체" || r.category === categoryFilter;
    const matchStatus = statusFilter === "전체" || r.status === statusFilter;
    return matchSearch && matchCategory && matchStatus;
  });

  const stats = {
    total: reviews.length,
    published: reviews.filter((r) => r.status === "발행됨").length,
    draft: reviews.filter((r) => r.status === "초안").length,
    review: reviews.filter((r) => r.status === "검토중").length,
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🦉</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">리뷰양이</h1>
            <p className="text-sm text-gray-500 mt-1">상품 리뷰를 작성하고 관리합니다.</p>
          </div>
        </div>
        <button
          onClick={onCreate}
          className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] transition-colors cursor-pointer"
        >
          + 새 리뷰 작성
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "전체 리뷰", value: stats.total, color: "text-gray-900" },
          { label: "발행됨", value: stats.published, color: "text-green-600" },
          { label: "초안", value: stats.draft, color: "text-gray-500" },
          { label: "검토중", value: stats.review, color: "text-yellow-600" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <input
          type="text"
          placeholder="리뷰 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E] cursor-pointer"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E] cursor-pointer"
        >
          <option value="전체">전체 상태</option>
          <option value="발행됨">발행됨</option>
          <option value="초안">초안</option>
          <option value="검토중">검토중</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              <th className="text-left px-6 py-3 font-medium">리뷰 제목</th>
              <th className="text-left px-3 py-3 font-medium">카테고리</th>
              <th className="text-center px-3 py-3 font-medium">등급</th>
              <th className="text-center px-3 py-3 font-medium">점수</th>
              <th className="text-center px-3 py-3 font-medium">상태</th>
              <th className="text-right px-3 py-3 font-medium">조회수</th>
              <th className="text-right px-3 py-3 font-medium">날짜</th>
              <th className="text-center px-6 py-3 font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((review) => (
              <tr key={review.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                <td className="px-6 py-3.5">
                  <button
                    onClick={() => onEdit(review)}
                    className="text-sm font-medium text-gray-900 hover:text-[#C41E1E] text-left cursor-pointer"
                  >
                    {review.title || "(제목 없음)"}
                  </button>
                  <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[300px]">
                    {review.product}
                  </p>
                </td>
                <td className="px-3 py-3.5 text-sm text-gray-500">{review.category || "-"}</td>
                <td className="px-3 py-3.5 text-center">
                  {review.badge && BADGE_LABEL[review.badge] ? (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${BADGE_LABEL[review.badge].color}`}>
                      {BADGE_LABEL[review.badge].label}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">-</span>
                  )}
                </td>
                <td className="px-3 py-3.5 text-center">
                  {review.totalScore > 0 ? (
                    <span className={`text-sm font-bold ${
                      review.totalScore >= 90 ? "text-green-600" :
                      review.totalScore >= 80 ? "text-blue-600" :
                      review.totalScore >= 70 ? "text-yellow-600" : "text-gray-500"
                    }`}>
                      {review.totalScore}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">-</span>
                  )}
                </td>
                <td className="px-3 py-3.5 text-center">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLE[review.status]}`}>
                    {review.status}
                  </span>
                </td>
                <td className="px-3 py-3.5 text-sm text-gray-500 text-right">
                  {review.views.toLocaleString()}
                </td>
                <td className="px-3 py-3.5 text-sm text-gray-500 text-right">{review.date}</td>
                <td className="px-6 py-3.5 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => onEdit(review)}
                      className="text-xs text-gray-500 hover:text-[#C41E1E] cursor-pointer"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => onDelete(review.id)}
                      className="text-xs text-gray-400 hover:text-[#C41E1E] cursor-pointer"
                    >
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-sm text-gray-400">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
