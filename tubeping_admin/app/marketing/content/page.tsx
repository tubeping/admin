"use client";

import { useState } from "react";
import BlogPage from "../blog/page";
import ContentMachinePage from "../content-machine/page";
import ReviewOwlPage from "../reviewyangi/page";

const TABS = [
  { key: "blog", label: "블로그", icon: "📝" },
  { key: "content-machine", label: "콘텐츠 머신", icon: "⚙️" },
  { key: "reviewyangi", label: "리뷰양이", icon: "🦉" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ContentHubPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("blog");

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">컨텐츠</h1>
        <p className="text-sm text-gray-500 mt-1">
          블로그 · 콘텐츠 머신 · 리뷰양이를 한 곳에서 관리합니다.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              activeTab === tab.key
                ? "bg-white text-[#C41E1E] shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content — 각 페이지의 p-8 래퍼를 제거하기 위해 -m-8 */}
      <div className="-mx-8 -mb-8">
        {activeTab === "blog" && <BlogPage />}
        {activeTab === "content-machine" && <ContentMachinePage />}
        {activeTab === "reviewyangi" && <ReviewOwlPage />}
      </div>
    </div>
  );
}
