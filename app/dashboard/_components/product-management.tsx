"use client";

import { useState } from "react";

interface Product {
  id: string;
  name: string;
  price: number;
  margin: number;
  image: string;
}

const DUMMY_GROUP_BUY: Product[] = [
  { id: "g1", name: "프리미엄 무선 이어폰", price: 39900, margin: 32, image: "/placeholder-product.png" },
  { id: "g2", name: "스테인리스 텀블러 500ml", price: 18900, margin: 28, image: "/placeholder-product.png" },
  { id: "g3", name: "비타민C 1000mg 60정", price: 24900, margin: 35, image: "/placeholder-product.png" },
];

const DUMMY_COUPANG: Product[] = [
  { id: "c1", name: "로봇청소기 X200", price: 289000, margin: 15, image: "/placeholder-product.png" },
  { id: "c2", name: "에어프라이어 5.5L", price: 79900, margin: 12, image: "/placeholder-product.png" },
  { id: "c3", name: "무선 충전 패드", price: 19900, margin: 18, image: "/placeholder-product.png" },
];

const DUMMY_NAVER: Product[] = [
  { id: "n1", name: "오가닉 코튼 티셔츠", price: 32000, margin: 22, image: "/placeholder-product.png" },
  { id: "n2", name: "핸드메이드 향초 세트", price: 28000, margin: 40, image: "/placeholder-product.png" },
  { id: "n3", name: "천연 수제 비누 3개입", price: 15000, margin: 30, image: "/placeholder-product.png" },
];

function ProductCard({
  product,
  onDelete,
}: {
  product: Product;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden relative group">
      <button
        onClick={() => onDelete(product.id)}
        className="absolute top-2 right-2 w-6 h-6 bg-gray-800/70 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      >
        X
      </button>
      <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
        <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm font-bold text-gray-900">
            {product.price.toLocaleString()}원
          </span>
          <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">
            마진 {product.margin}%
          </span>
        </div>
      </div>
    </div>
  );
}

function ProductSection({
  title,
  products,
  onDelete,
}: {
  title: string;
  products: Product[];
  onDelete: (id: string) => void;
}) {
  return (
    <div className="mb-8">
      <h3 className="text-base font-bold text-gray-900 mb-3">{title}</h3>
      <div className="grid grid-cols-3 gap-3">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

export default function ProductManagement() {
  const [groupBuy, setGroupBuy] = useState(DUMMY_GROUP_BUY);
  const [coupang, setCoupang] = useState(DUMMY_COUPANG);
  const [naver, setNaver] = useState(DUMMY_NAVER);
  const [linkInput, setLinkInput] = useState("");

  const deleteFrom = (
    setter: React.Dispatch<React.SetStateAction<Product[]>>,
  ) => (id: string) => {
    setter((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="flex h-full">
      {/* Center panel */}
      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">상품 관리</h2>

        <ProductSection title="공구 상품" products={groupBuy} onDelete={deleteFrom(setGroupBuy)} />
        <ProductSection title="쿠팡 파트너스" products={coupang} onDelete={deleteFrom(setCoupang)} />
        <ProductSection title="네이버/기타" products={naver} onDelete={deleteFrom(setNaver)} />

        {/* Link input */}
        <div className="flex gap-2 mt-4">
          <input
            type="text"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="상품 링크를 입력하세요"
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/30 focus:border-[#C41E1E]"
          />
          <button className="px-5 py-2.5 bg-[#C41E1E] text-white rounded-lg text-sm font-semibold hover:bg-[#A01818] transition-colors whitespace-nowrap cursor-pointer">
            상품 조르기
          </button>
        </div>
      </div>

      {/* Right panel */}
      <div className="w-[280px] border-l border-gray-200 bg-gray-50 p-5 flex flex-col gap-4">
        <h3 className="text-sm font-bold text-gray-900 mb-2">상품 가져오기</h3>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-gray-900">튜핑 인벤토리에서 가져오기</p>
          <p className="text-xs text-gray-500 mt-1">튜핑 소싱에서 저장한 상품을 내 쇼핑몰에 바로 등록합니다.</p>
          <button className="mt-3 w-full px-4 py-2 bg-[#C41E1E] text-white rounded-lg text-sm font-semibold hover:bg-[#A01818] transition-colors cursor-pointer">
            인벤토리 열기
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-gray-900">쿠팡파트너스 연동</p>
          <p className="text-xs text-gray-500 mt-1">쿠팡파트너스 API를 연결하면 상품을 자동으로 불러옵니다.</p>
          <button className="mt-3 w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors cursor-pointer">
            연동하기
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-gray-900">네이버 등 기타 파트너스 연동</p>
          <p className="text-xs text-gray-500 mt-1">네이버 커넥트, 아이보스 등 파트너스 링크를 연결합니다.</p>
          <button className="mt-3 w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors cursor-pointer">
            연동하기
          </button>
        </div>
      </div>
    </div>
  );
}
