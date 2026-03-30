'use client'

import { useOnboarding } from '../_context/onboarding-context'

export default function StepLogin() {
  const { updateData, next } = useOnboarding()

  function handleLogin(method: string) {
    updateData({ authMethod: method })
    next()
  }

  return (
    <div className="text-center">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          <span className="text-primary">tubeping</span>
        </h1>
        <p className="text-gray-500 text-sm">
          유튜브 크리에이터를 위한 굿즈몰
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-6">
          시작하기
        </h2>

        <div className="space-y-3">
          <button
            onClick={() => handleLogin('google')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google로 계속하기
          </button>

          <button
            onClick={() => handleLogin('kakao')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-[#FEE500] rounded-xl hover:bg-[#FDD800] transition-colors text-sm font-medium text-[#391B1B]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#391B1B">
              <path d="M12 3C6.48 3 2 6.36 2 10.44c0 2.62 1.75 4.93 4.38 6.24l-1.12 4.16c-.1.35.3.64.6.44l4.97-3.28c.38.04.77.06 1.17.06 5.52 0 10-3.36 10-7.5S17.52 3 12 3z" />
            </svg>
            카카오로 계속하기
          </button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-400">또는</span>
            </div>
          </div>

          <button
            onClick={() => handleLogin('email')}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
          >
            이메일로 계속하기
          </button>
        </div>

        <p className="mt-6 text-[11px] text-gray-400 leading-relaxed">
          계속 진행하면 tubeping의{' '}
          <span className="underline cursor-pointer">이용약관</span> 및{' '}
          <span className="underline cursor-pointer">개인정보처리방침</span>에
          동의하게 됩니다.
        </p>
      </div>
    </div>
  )
}
