"use client";

import { useState } from "react";
import type { Review } from "../page";

const CATEGORIES = ["주방가전", "생활가전", "계절가전", "디지털/IT", "뷰티/헬스", "육아용품"];
const BADGES = [
  { value: "", label: "없음" },
  { value: "best", label: "베스트픽" },
  { value: "value", label: "가성비픽" },
  { value: "premium", label: "프리미엄픽" },
  { value: "plus", label: "플러스픽" },
];

const SCORE_LABELS: Record<string, string> = {
  performance: "성능",
  costEfficiency: "가성비",
  design: "디자인",
  convenience: "편의성",
  durability: "내구성",
};

type Props = {
  review: Review;
  onSave: (review: Review) => void;
  onBack: () => void;
};

export default function ReviewEditor({ review, onSave, onBack }: Props) {
  const [form, setForm] = useState<Review>({ ...review });
  const [prosText, setProsText] = useState(review.pros.join("\n"));
  const [consText, setConsText] = useState(review.cons.join("\n"));

  const updateField = <K extends keyof Review>(key: K, value: Review[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateScore = (key: string, value: number) => {
    const newScores = { ...form.scores, [key]: value };
    const avg = Math.round(
      Object.values(newScores).reduce((a, b) => a + b, 0) / 5
    );
    setForm((prev) => ({ ...prev, scores: newScores, totalScore: avg }));
  };

  const addSpec = () => {
    setForm((prev) => ({
      ...prev,
      specs: [...prev.specs, { key: "", value: "" }],
    }));
  };

  const updateSpec = (index: number, field: "key" | "value", value: string) => {
    const newSpecs = [...form.specs];
    newSpecs[index] = { ...newSpecs[index], [field]: value };
    setForm((prev) => ({ ...prev, specs: newSpecs }));
  };

  const removeSpec = (index: number) => {
    setForm((prev) => ({
      ...prev,
      specs: prev.specs.filter((_, i) => i !== index),
    }));
  };

  const handleSave = (status: Review["status"]) => {
    const saved: Review = {
      ...form,
      status,
      pros: prosText.split("\n").filter((s) => s.trim()),
      cons: consText.split("\n").filter((s) => s.trim()),
    };
    onSave(saved);
  };

  const scoreColor = (score: number) => {
    if (score >= 90) return "bg-green-500";
    if (score >= 80) return "bg-blue-500";
    if (score >= 70) return "bg-yellow-500";
    if (score > 0) return "bg-red-500";
    return "bg-gray-200";
  };

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {review.title ? "리뷰 수정" : "새 리뷰 작성"}
            </h1>
            <p className="text-sm text-gray-500 mt-1">🦉 리뷰양이</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSave("초안")}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
          >
            초안 저장
          </button>
          <button
            onClick={() => handleSave("검토중")}
            className="px-4 py-2.5 text-sm font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100 transition-colors cursor-pointer"
          >
            검토 요청
          </button>
          <button
            onClick={() => handleSave("발행됨")}
            className="px-4 py-2.5 text-sm font-medium text-white bg-[#C41E1E] rounded-lg hover:bg-[#A01818] transition-colors cursor-pointer"
          >
            발행하기
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {/* 기본 정보 */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">기본 정보</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">리뷰 제목</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => updateField("title", e.target.value)}
                placeholder="예: LG 디오스 오브제컬렉션 냉장고 심층 리뷰"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상품명</label>
                <input
                  type="text"
                  value={form.product}
                  onChange={(e) => updateField("product", e.target.value)}
                  placeholder="예: LG 디오스 오브제컬렉션 M874GBB551"
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                  <select
                    value={form.category}
                    onChange={(e) => updateField("category", e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E] cursor-pointer"
                  >
                    <option value="">선택</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">등급</label>
                  <select
                    value={form.badge}
                    onChange={(e) => updateField("badge", e.target.value as Review["badge"])}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E] cursor-pointer"
                  >
                    {BADGES.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">한줄 요약</label>
              <input
                type="text"
                value={form.summary}
                onChange={(e) => updateField("summary", e.target.value)}
                placeholder="한 문장으로 이 상품을 설명해주세요"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
              />
            </div>
          </div>
        </section>

        {/* 점수 평가 */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">점수 평가</h2>
            {form.totalScore > 0 && (
              <div className={`px-4 py-2 rounded-xl text-white font-bold text-lg ${scoreColor(form.totalScore)}`}>
                종합 {form.totalScore}점
              </div>
            )}
          </div>
          <div className="space-y-4">
            {Object.entries(SCORE_LABELS).map(([key, label]) => {
              const value = form.scores[key as keyof typeof form.scores];
              return (
                <div key={key} className="flex items-center gap-4">
                  <span className="w-16 text-sm font-medium text-gray-600">{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={value}
                    onChange={(e) => updateScore(key, Number(e.target.value))}
                    className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-[#C41E1E]"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={value}
                    onChange={(e) => updateScore(key, Math.min(100, Math.max(0, Number(e.target.value))))}
                    className="w-16 px-2 py-1.5 text-sm text-center border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                  <div className={`w-2 h-2 rounded-full ${scoreColor(value)}`} />
                </div>
              );
            })}
          </div>
        </section>

        {/* 장단점 */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">장단점</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-green-700 mb-1">👍 장점 (줄바꿈으로 구분)</label>
              <textarea
                value={prosText}
                onChange={(e) => setProsText(e.target.value)}
                rows={4}
                placeholder={"업계 최대 용량\n오브제 디자인\n1등급 에너지효율"}
                className="w-full px-4 py-2.5 text-sm border border-green-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 bg-green-50/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-red-700 mb-1">👎 단점 (줄바꿈으로 구분)</label>
              <textarea
                value={consText}
                onChange={(e) => setConsText(e.target.value)}
                rows={4}
                placeholder={"높은 가격대\n무거운 무게"}
                className="w-full px-4 py-2.5 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 bg-red-50/30"
              />
            </div>
          </div>
        </section>

        {/* 스펙 */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">주요 스펙</h2>
            <button
              onClick={addSpec}
              className="text-sm text-[#C41E1E] hover:text-[#A01818] font-medium cursor-pointer"
            >
              + 스펙 추가
            </button>
          </div>
          {form.specs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              스펙을 추가해주세요.
            </p>
          ) : (
            <div className="space-y-2">
              {form.specs.map((spec, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input
                    type="text"
                    value={spec.key}
                    onChange={(e) => updateSpec(i, "key", e.target.value)}
                    placeholder="항목명 (예: 용량)"
                    className="w-36 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                  <input
                    type="text"
                    value={spec.value}
                    onChange={(e) => updateSpec(i, "value", e.target.value)}
                    placeholder="값 (예: 870L)"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                  <button
                    onClick={() => removeSpec(i)}
                    className="p-1.5 text-gray-400 hover:text-[#C41E1E] cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 리뷰 본문 */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">리뷰 본문</h2>
          <textarea
            value={form.content}
            onChange={(e) => updateField("content", e.target.value)}
            rows={12}
            placeholder="상세 리뷰 내용을 작성해주세요. 마크다운 형식을 지원합니다."
            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E] font-mono leading-relaxed"
          />
        </section>
      </div>
    </div>
  );
}
