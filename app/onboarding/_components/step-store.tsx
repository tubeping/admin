'use client'

import { useState, useEffect } from 'react'
import { useOnboarding } from '../_context/onboarding-context'

const themes = [
  {
    id: 'minimal' as const,
    name: '미니멀',
    desc: '깔끔하고 심플한',
    colors: ['#ffffff', '#111111', '#f5f5f5'],
  },
  {
    id: 'bold' as const,
    name: '볼드',
    desc: '강렬하고 임팩트있는',
    colors: ['#FF0050', '#000000', '#FFE500'],
  },
  {
    id: 'playful' as const,
    name: '플레이풀',
    desc: '밝고 귀여운',
    colors: ['#A855F7', '#EC4899', '#FDE68A'],
  },
]

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function StepStore() {
  const { data, updateData, next, prev } = useOnboarding()

  const channelName = data.channelInfo?.title || ''
  const [storeName, setStoreName] = useState(data.storeName || channelName)
  const [slug, setSlug] = useState(data.storeSlug || toSlug(channelName))
  const [theme, setTheme] = useState(data.theme)
  const [slugEdited, setSlugEdited] = useState(false)

  useEffect(() => {
    if (!slugEdited) {
      setSlug(toSlug(storeName))
    }
  }, [storeName, slugEdited])

  function handleNext() {
    if (!storeName.trim() || !slug.trim()) return
    updateData({ storeName: storeName.trim(), storeSlug: slug.trim(), theme })
    next()
  }

  return (
    <div>
      <button
        onClick={prev}
        className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        이전
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          몰 설정
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          굿즈몰의 이름과 테마를 정해주세요
        </p>

        <div className="space-y-5">
          {/* Store Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              몰 이름
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="예: 홍길동 굿즈샵"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Slug / URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              몰 주소
            </label>
            <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary">
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.replace(/[^a-z0-9-]/g, ''))
                  setSlugEdited(true)
                }}
                className="flex-1 px-4 py-2.5 text-sm focus:outline-none"
                placeholder="my-store"
              />
              <span className="pr-4 text-sm text-gray-400 whitespace-nowrap">
                .tubeping.com
              </span>
            </div>
          </div>

          {/* Theme */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              테마
            </label>
            <div className="grid grid-cols-3 gap-3">
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    theme === t.id
                      ? 'border-primary bg-primary-light'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex gap-1 mb-2">
                    {t.colors.map((c) => (
                      <div
                        key={c}
                        className="w-4 h-4 rounded-full border border-gray-200"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <p className="text-sm font-semibold text-gray-800">
                    {t.name}
                  </p>
                  <p className="text-[11px] text-gray-500">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleNext}
          disabled={!storeName.trim() || !slug.trim()}
          className="w-full mt-6 px-4 py-3 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          다음
        </button>
      </div>
    </div>
  )
}
