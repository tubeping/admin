'use client'

import { useState } from 'react'
import { useOnboarding } from '../_context/onboarding-context'

interface Product {
  id: string
  name: string
  image: string
  cost: string
  price: string
  margin: number
}

interface SourceSection {
  id: string
  title: string
  description: string
  buttonLabel: string
  color: string
  iconBg: string
  icon: React.ReactNode
  products: Product[]
}

const sections: SourceSection[] = [
  {
    id: 'ali',
    title: '알리에서 가져오기',
    description: '알리익스프레스 인기 상품을 내 몰에 바로 등록',
    buttonLabel: '상품 둘러보기',
    color: '#E43225',
    iconBg: 'bg-red-50',
    icon: (
      <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    ),
    products: [
      { id: 'ali-1', name: '무선 LED 무드등', image: '💡', cost: '3,200', price: '12,900', margin: 75 },
      { id: 'ali-2', name: '커스텀 폰케이스', image: '📱', cost: '1,800', price: '15,900', margin: 89 },
      { id: 'ali-3', name: '미니 보조배터리', image: '🔋', cost: '5,500', price: '18,900', margin: 71 },
    ],
  },
  {
    id: 'coupang',
    title: '쿠팡파트너스 연동',
    description: '쿠팡 상품 링크로 수익 창출 (구매 시 수수료 적립)',
    buttonLabel: '쿠팡 연동하기',
    color: '#E63740',
    iconBg: 'bg-rose-50',
    icon: (
      <svg className="w-5 h-5 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="16" r="2" />
      </svg>
    ),
    products: [
      { id: 'cp-1', name: '게이밍 마우스패드 XL', image: '🖱️', cost: '0', price: '23,900', margin: 32 },
      { id: 'cp-2', name: '유튜버 조명 링라이트', image: '💡', cost: '0', price: '34,500', margin: 28 },
      { id: 'cp-3', name: '마이크 붐암 스탠드', image: '🎙️', cost: '0', price: '29,800', margin: 35 },
    ],
  },
  {
    id: 'naver',
    title: '네이버 등 기타 파트너스 연동',
    description: '네이버·11번가 등 다양한 제휴 플랫폼 상품 연동',
    buttonLabel: '연동하기',
    color: '#03C75A',
    iconBg: 'bg-green-50',
    icon: (
      <svg className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727v12.845z" transform="scale(0.75) translate(4,4)" />
      </svg>
    ),
    products: [
      { id: 'nv-1', name: '감성 레터링 머그컵', image: '☕', cost: '0', price: '16,900', margin: 24 },
      { id: 'nv-2', name: '크리에이터 굿즈 스티커', image: '🏷️', cost: '0', price: '4,500', margin: 40 },
      { id: 'nv-3', name: '캔버스 에코백 토트', image: '👜', cost: '0', price: '19,900', margin: 30 },
    ],
  },
]

function MarginBadge({ margin }: { margin: number }) {
  const color =
    margin >= 60 ? 'text-emerald-600 bg-emerald-50' :
    margin >= 30 ? 'text-amber-600 bg-amber-50' :
    'text-gray-600 bg-gray-100'

  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${color}`}>
      마진 {margin}%
    </span>
  )
}

export default function StepProducts() {
  const { data, updateData, next, prev } = useOnboarding()
  const [selected, setSelected] = useState<string[]>(data.selectedProducts)

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  const totalSelected = selected.length

  function handleNext() {
    updateData({ selectedProducts: selected })
    next()
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={prev}
        className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        이전
      </button>

      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">
          상품 소싱
        </h2>
        <p className="text-sm text-gray-500">
          판매할 상품을 가져오세요 · 나중에 언제든 추가할 수 있어요
        </p>
      </div>

      <div className="space-y-4">
        {sections.map((section) => {
          const sectionSelected = section.products.filter((p) =>
            selected.includes(p.id)
          ).length

          return (
            <div
              key={section.id}
              className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              {/* Section Header */}
              <div className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg ${section.iconBg} flex items-center justify-center`}>
                    {section.icon}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">
                      {section.title}
                    </h3>
                    <p className="text-[11px] text-gray-400">
                      {section.description}
                    </p>
                  </div>
                </div>
                <button
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-gray-600 whitespace-nowrap"
                >
                  {section.buttonLabel}
                </button>
              </div>

              {/* Product List */}
              <div className="px-6 pb-4">
                <div className="space-y-2">
                  {section.products.map((product) => {
                    const isSelected = selected.includes(product.id)
                    return (
                      <button
                        key={product.id}
                        onClick={() => toggle(product.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                          isSelected
                            ? 'border-primary bg-primary-light'
                            : 'border-gray-100 hover:border-gray-200 bg-gray-50'
                        }`}
                      >
                        {/* Product Image Placeholder */}
                        <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-xl shrink-0">
                          {product.image}
                        </div>

                        {/* Product Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {product.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-sm font-bold text-gray-900">
                              {product.price}원
                            </span>
                            <MarginBadge margin={product.margin} />
                          </div>
                        </div>

                        {/* Check */}
                        <div
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-primary border-primary'
                              : 'border-gray-300'
                          }`}
                        >
                          {isSelected && (
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>

                {sectionSelected > 0 && (
                  <p className="text-[11px] text-primary font-medium mt-2 pl-1">
                    {sectionSelected}개 선택됨
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom CTA */}
      <div className="mt-6 sticky bottom-4">
        <button
          onClick={handleNext}
          disabled={totalSelected === 0}
          className="w-full px-4 py-3.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg shadow-primary/20"
        >
          {totalSelected > 0
            ? `${totalSelected}개 상품으로 오픈하기`
            : '상품을 선택해주세요'}
        </button>
      </div>
    </div>
  )
}
