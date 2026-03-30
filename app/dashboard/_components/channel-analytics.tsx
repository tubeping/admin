"use client";

import { useState } from "react";

const DUMMY_CATEGORIES = [
  "IT/가전", "뷰티", "건강식품", "패션", "생활용품", "식품", "육아",
];

const DUMMY_RECOMMENDATIONS = [
  {
    id: "r1",
    category: "IT/가전",
    name: "프리미엄 무선 이어폰 Pro",
    estimatedSales: "월 320개",
    margin: 32,
  },
  {
    id: "r2",
    category: "건강식품",
    name: "유산균 프로바이오틱스 30포",
    estimatedSales: "월 580개",
    margin: 28,
  },
  {
    id: "r3",
    category: "생활용품",
    name: "스테인리스 진공 텀블러 500ml",
    estimatedSales: "월 450개",
    margin: 35,
  },
];

export default function ChannelAnalytics() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [instaAccount, setInstaAccount] = useState("");

  return (
    <div className="flex h-full">
      {/* Center panel */}
      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">채널 분석 + 상품 추천</h2>

        {/* Channel input */}
        <section className="mb-8">
          <h3 className="text-base font-bold text-gray-900 mb-3">채널 입력</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">유튜브 채널 URL</label>
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://youtube.com/@채널명"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/30 focus:border-[#C41E1E]"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">인스타그램 계정</label>
              <input
                type="text"
                value={instaAccount}
                onChange={(e) => setInstaAccount(e.target.value)}
                placeholder="@계정명"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/30 focus:border-[#C41E1E]"
              />
            </div>
          </div>
        </section>

        {/* Channel persona */}
        <section className="mb-8">
          <h3 className="text-base font-bold text-gray-900 mb-3">채널 페르소나</h3>

          {/* Age bar (dummy) */}
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">시청자 연령 분포</p>
            <div className="flex gap-1 h-8 items-end">
              {[
                { label: "10대", pct: 8 },
                { label: "20대", pct: 35 },
                { label: "30대", pct: 42 },
                { label: "40대", pct: 12 },
                { label: "50+", pct: 3 },
              ].map((age) => (
                <div key={age.label} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-[#C41E1E]/80 rounded-t"
                    style={{ height: `${age.pct * 0.8}px` }}
                  />
                  <span className="text-[10px] text-gray-500">{age.label}</span>
                  <span className="text-[10px] font-semibold text-gray-700">{age.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Interest category tags */}
          <div>
            <p className="text-sm text-gray-600 mb-2">관심 카테고리</p>
            <div className="flex flex-wrap gap-2">
              {DUMMY_CATEGORIES.map((cat) => (
                <span
                  key={cat}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs font-medium"
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Product recommendations */}
        <section>
          <h3 className="text-base font-bold text-gray-900 mb-3">상품 추천</h3>
          <div className="grid grid-cols-3 gap-3">
            {DUMMY_RECOMMENDATIONS.map((rec) => (
              <div
                key={rec.id}
                className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col"
              >
                <span className="text-xs text-gray-400 mb-1">{rec.category}</span>
                <p className="text-sm font-semibold text-gray-900 mb-2">{rec.name}</p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-gray-500">예상판매: {rec.estimatedSales}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">
                    마진 {rec.margin}%
                  </span>
                </div>
                <button className="mt-auto w-full px-3 py-2 bg-[#C41E1E] text-white rounded-lg text-sm font-semibold hover:bg-[#A01818] transition-colors cursor-pointer">
                  담기
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Right panel */}
      <div className="w-[280px] border-l border-gray-200 bg-gray-50 p-5 flex flex-col gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-gray-900">채널 연동</p>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">유튜브</span>
              <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">연동됨</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">인스타그램</span>
              <span className="text-xs font-semibold px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">미연동</span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-gray-900">유튜브 직접 입력 + API</p>
          <p className="text-xs text-gray-500 mt-2">
            채널 URL을 입력하면 YouTube Data API로 구독자 수, 평균 조회수, 카테고리를 자동으로 분석합니다.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-gray-900">네이버 + 아이보스 연동</p>
          <p className="text-xs text-gray-500 mt-2">
            네이버 검색 트렌드 API와 아이보스 데이터를 연동하면 더 정확한 상품 추천이 가능합니다.
          </p>
        </div>
      </div>
    </div>
  );
}
