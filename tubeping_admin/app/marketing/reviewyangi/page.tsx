"use client";

import { useState } from "react";
import ReviewList from "./_components/review-list";
import ReviewEditor from "./_components/review-editor";

export type Review = {
  id: number;
  title: string;
  product: string;
  category: string;
  status: "발행됨" | "초안" | "검토중";
  totalScore: number;
  scores: {
    performance: number;
    costEfficiency: number;
    design: number;
    convenience: number;
    durability: number;
  };
  pros: string[];
  cons: string[];
  summary: string;
  content: string;
  specs: { key: string; value: string }[];
  badge: "best" | "value" | "premium" | "plus" | "";
  author: string;
  date: string;
  views: number;
};

const INITIAL_REVIEWS: Review[] = [
  {
    id: 1,
    title: "LG 디오스 오브제컬렉션 냉장고 심층 리뷰",
    product: "LG 디오스 오브제컬렉션 M874GBB551",
    category: "주방가전",
    status: "발행됨",
    totalScore: 92,
    scores: { performance: 95, costEfficiency: 78, design: 96, convenience: 90, durability: 92 },
    pros: ["업계 최대 용량 870L", "오브제 디자인으로 인테리어 효과", "1등급 에너지효율"],
    cons: ["높은 가격대 (200만원 이상)", "무거운 무게로 설치 어려움"],
    summary: "대용량과 프리미엄 디자인을 모두 갖춘 LG의 플래그십 냉장고",
    content: "",
    specs: [
      { key: "용량", value: "870L" },
      { key: "타입", value: "4도어" },
      { key: "에너지등급", value: "1등급" },
      { key: "도어재질", value: "글라스" },
    ],
    badge: "best",
    author: "리뷰양이",
    date: "2026-03-28",
    views: 1543,
  },
  {
    id: 2,
    title: "삼성 비스포크 냉장고 가성비 리뷰",
    product: "삼성 비스포크 RF85B9121AP",
    category: "주방가전",
    status: "발행됨",
    totalScore: 89,
    scores: { performance: 90, costEfficiency: 88, design: 92, convenience: 85, durability: 88 },
    pros: ["비스포크 커스터마이징", "우수한 가성비", "정온냉동 기술"],
    cons: ["LG 대비 소음 다소 있음"],
    summary: "커스터마이징 디자인과 합리적 가격의 삼성 프리미엄 냉장고",
    content: "",
    specs: [
      { key: "용량", value: "846L" },
      { key: "타입", value: "4도어" },
      { key: "에너지등급", value: "1등급" },
    ],
    badge: "value",
    author: "리뷰양이",
    date: "2026-03-25",
    views: 982,
  },
  {
    id: 3,
    title: "다이슨 에어랩 vs 샤오미 헤어드라이어 비교 리뷰",
    product: "다이슨 에어랩 멀티스타일러",
    category: "뷰티/헬스",
    status: "초안",
    totalScore: 0,
    scores: { performance: 0, costEfficiency: 0, design: 0, convenience: 0, durability: 0 },
    pros: [],
    cons: [],
    summary: "",
    content: "",
    specs: [],
    badge: "",
    author: "리뷰양이",
    date: "2026-03-30",
    views: 0,
  },
  {
    id: 4,
    title: "로보락 S8 MaxV Ultra 로봇청소기 리뷰",
    product: "로보락 S8 MaxV Ultra",
    category: "생활가전",
    status: "검토중",
    totalScore: 88,
    scores: { performance: 92, costEfficiency: 80, design: 85, convenience: 94, durability: 85 },
    pros: ["강력한 흡입력", "자동 먼지비움+물걸레 세척", "장애물 인식 AI"],
    cons: ["높은 가격", "자동 비움 스테이션 소음"],
    summary: "AI 장애물 인식과 올인원 스테이션을 갖춘 프리미엄 로봇청소기",
    content: "",
    specs: [
      { key: "흡입력", value: "6000Pa" },
      { key: "물걸레", value: "지원 (자동세척)" },
      { key: "자동비움", value: "지원" },
    ],
    badge: "best",
    author: "리뷰양이",
    date: "2026-03-29",
    views: 0,
  },
];

export default function ReviewOwlPage() {
  const [reviews, setReviews] = useState<Review[]>(INITIAL_REVIEWS);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = () => {
    const newReview: Review = {
      id: Date.now(),
      title: "",
      product: "",
      category: "",
      status: "초안",
      totalScore: 0,
      scores: { performance: 0, costEfficiency: 0, design: 0, convenience: 0, durability: 0 },
      pros: [],
      cons: [],
      summary: "",
      content: "",
      specs: [],
      badge: "",
      author: "리뷰양이",
      date: new Date().toISOString().split("T")[0],
      views: 0,
    };
    setEditingReview(newReview);
    setIsCreating(true);
  };

  const handleSave = (review: Review) => {
    if (isCreating) {
      setReviews([review, ...reviews]);
    } else {
      setReviews(reviews.map((r) => (r.id === review.id ? review : r)));
    }
    setEditingReview(null);
    setIsCreating(false);
  };

  const handleDelete = (id: number) => {
    setReviews(reviews.filter((r) => r.id !== id));
  };

  const handleBack = () => {
    setEditingReview(null);
    setIsCreating(false);
  };

  if (editingReview) {
    return (
      <ReviewEditor
        review={editingReview}
        onSave={handleSave}
        onBack={handleBack}
      />
    );
  }

  return (
    <ReviewList
      reviews={reviews}
      onEdit={setEditingReview}
      onCreate={handleCreate}
      onDelete={handleDelete}
    />
  );
}
