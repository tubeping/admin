'use client'

import { useOnboarding } from '../_context/onboarding-context'

const labels = ['로그인', '채널 연결', '몰 설정', '상품 선택']

export default function ProgressBar() {
  const { step } = useOnboarding()

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-primary">
            tubeping
          </span>
          <span className="text-xs text-gray-400">{step} / 4</span>
        </div>
        <div className="flex gap-2">
          {labels.map((label, i) => (
            <div key={label} className="flex-1">
              <div
                className={`h-1 rounded-full transition-colors ${
                  i + 1 <= step ? 'bg-primary' : 'bg-gray-200'
                }`}
              />
              <span
                className={`text-[10px] mt-1 block ${
                  i + 1 <= step ? 'text-gray-700' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </header>
  )
}
