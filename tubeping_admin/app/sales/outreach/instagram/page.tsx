"use client";

export default function InstagramOutreachPage() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">인스타 공구 아웃리치</h1>
        <p className="text-sm text-gray-500 mt-1">
          인스타그램 공동구매 계정 수집 → DM/이메일 영업 → 계약 추적
        </p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
        <div className="text-4xl mb-4">🚧</div>
        <h2 className="text-lg font-semibold text-gray-700 mb-2">준비 중</h2>
        <p className="text-sm text-gray-500 mb-6">
          인스타 공구 계정 수집 파이프라인 연동 예정
        </p>
        <div className="text-xs text-gray-400 space-y-1">
          <p>구현 예정 기능</p>
          <ul className="text-left inline-block mt-2">
            <li>• 공구 계정 자동 수집 (기존 fetchers/gonggu_instagram.py 연동)</li>
            <li>• 팔로워/참여율 기준 우선순위 매기기</li>
            <li>• DM 템플릿 + 발송 추적</li>
            <li>• 수집 계정 프로필 분석 (카테고리/상품군)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
