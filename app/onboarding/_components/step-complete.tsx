'use client'

import { useOnboarding } from '../_context/onboarding-context'

export default function StepComplete() {
  const { data } = useOnboarding()
  const storeUrl = `${data.storeSlug}.tubeping.com`

  return (
    <div className="text-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        {/* Celebration */}
        <div className="text-6xl mb-4">
          {'\uD83C\uDF89'}
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          오픈 완료!
        </h2>
        <p className="text-sm text-gray-500 mb-8">
          <span className="font-semibold text-gray-800">{data.storeName}</span>{' '}
          몰이 성공적으로 개설되었어요
        </p>

        {/* Store URL Card */}
        <div className="bg-gray-50 rounded-xl p-5 mb-6">
          <p className="text-xs text-gray-400 mb-2">내 몰 주소</p>
          <p className="text-lg font-bold text-primary">{storeUrl}</p>
        </div>

        {/* Summary */}
        <div className="space-y-3 text-left mb-8">
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            {data.channelInfo?.thumbnail && (
              <img
                src={data.channelInfo.thumbnail}
                alt=""
                className="w-10 h-10 rounded-full"
              />
            )}
            <div>
              <p className="text-xs text-gray-400">연결된 채널</p>
              <p className="text-sm font-medium text-gray-800">
                {data.channelInfo?.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center text-primary text-sm font-bold">
              {data.selectedProducts.length}
            </div>
            <div>
              <p className="text-xs text-gray-400">등록된 상품</p>
              <p className="text-sm font-medium text-gray-800">
                {data.selectedProducts.length}개 상품
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button className="w-full px-4 py-3 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover transition-colors">
            내 몰 바로가기
          </button>
          <button className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            대시보드로 이동
          </button>
        </div>
      </div>
    </div>
  )
}
