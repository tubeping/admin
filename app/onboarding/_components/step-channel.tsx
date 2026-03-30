'use client'

import { useState } from 'react'
import { useOnboarding } from '../_context/onboarding-context'
import type { ChannelInfo } from '../_context/onboarding-context'

export default function StepChannel() {
  const { data, updateData, next, prev } = useOnboarding()
  const [url, setUrl] = useState(data.channelUrl)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [channel, setChannel] = useState<ChannelInfo | null>(data.channelInfo)

  async function handleLookup() {
    if (!url.trim()) {
      setError('채널 URL을 입력해주세요')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/youtube?url=${encodeURIComponent(url.trim())}`)
      const result = await res.json()

      if (!res.ok) {
        setError(result.error || '채널을 찾을 수 없습니다')
        setChannel(null)
        return
      }

      setChannel(result)
      updateData({ channelUrl: url.trim(), channelInfo: result })
    } catch {
      setError('네트워크 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  function handleNext() {
    if (!channel) {
      setError('채널을 먼저 연결해주세요')
      return
    }
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
          유튜브 채널 연결
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          굿즈몰에 연결할 유튜브 채널의 URL을 입력해주세요
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              채널 URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setError('')
                }}
                placeholder="https://youtube.com/@채널명"
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              />
              <button
                onClick={handleLookup}
                disabled={loading}
                className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {loading ? '조회중...' : '조회'}
              </button>
            </div>
            {error && (
              <p className="mt-1.5 text-xs text-red-500">{error}</p>
            )}
          </div>

          {channel && (
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
              <img
                src={channel.thumbnail}
                alt={channel.title}
                className="w-14 h-14 rounded-full object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">
                  {channel.title}
                </p>
                <p className="text-xs text-gray-500">
                  구독자 {channel.subscriberCount}명
                </p>
              </div>
              <svg className="w-5 h-5 text-accent shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          )}
        </div>

        <button
          onClick={handleNext}
          disabled={!channel}
          className="w-full mt-6 px-4 py-3 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          다음
        </button>
      </div>
    </div>
  )
}
