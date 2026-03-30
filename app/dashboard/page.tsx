"use client";

import { useState } from "react";
import ProductManagement from "./_components/product-management";
import ChannelAnalytics from "./_components/channel-analytics";

type MenuKey = "shop" | "products" | "analytics" | "settlement";

const MENU_ITEMS: { key: MenuKey; label: string }[] = [
  { key: "shop", label: "쇼핑몰 꾸미기" },
  { key: "products", label: "상품 관리" },
  { key: "analytics", label: "채널 분석 + 상품 추천" },
  { key: "settlement", label: "정산 대시보드" },
];

const DUMMY_PRODUCTS = [
  { id: 1, name: "프리미엄 무선 이어폰", price: "39,900원" },
  { id: 2, name: "스테인리스 텀블러", price: "18,900원" },
  { id: 3, name: "비타민C 1000mg", price: "24,900원" },
  { id: 4, name: "로봇청소기 X200", price: "289,000원" },
  { id: 5, name: "에어프라이어 5.5L", price: "79,900원" },
  { id: 6, name: "무선 충전 패드", price: "19,900원" },
];

function ShopPreview() {
  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        {/* Channel info */}
        <div className="mb-8 text-center">
          <div className="w-20 h-20 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
            <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">내 쇼핑몰</h2>
          <p className="text-sm text-gray-500 mt-1">
            유튜브 크리에이터를 위한 큐레이션 쇼핑몰입니다.
          </p>
        </div>

        {/* Product grid */}
        <div className="grid grid-cols-3 gap-4">
          {DUMMY_PRODUCTS.map((product) => (
            <div
              key={product.id}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden"
            >
              <div className="w-full h-36 bg-gray-100 flex items-center justify-center">
                <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {product.name}
                </p>
                <p className="text-sm font-bold text-gray-900 mt-1">
                  {product.price}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettlementPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <p className="text-4xl mb-4">🔧</p>
        <p className="text-lg font-semibold text-gray-500">준비 중입니다</p>
        <p className="text-sm text-gray-400 mt-1">정산 대시보드를 준비하고 있어요.</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [activeMenu, setActiveMenu] = useState<MenuKey>("shop");

  const content: Record<MenuKey, React.ReactNode> = {
    shop: <ShopPreview />,
    products: <ProductManagement />,
    analytics: <ChannelAnalytics />,
    settlement: <SettlementPlaceholder />,
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-[260px] bg-black flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-6 py-6">
          <span className="text-2xl font-extrabold text-[#C41E1E] tracking-tight">
            tubeping
          </span>
        </div>

        {/* Menu */}
        <nav className="flex flex-col mt-2">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveMenu(item.key)}
              className={`text-left px-6 py-3.5 text-sm font-medium transition-colors cursor-pointer ${
                activeMenu === item.key
                  ? "bg-[#C41E1E] text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-white overflow-y-auto">{content[activeMenu]}</main>
    </div>
  );
}
