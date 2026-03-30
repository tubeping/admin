import { OnboardingProvider } from './_context/onboarding-context'

export const metadata = {
  title: 'Tubeping - 내 유튜브 굿즈몰 만들기',
  description: '유튜브 크리에이터를 위한 굿즈몰 개설',
}

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <OnboardingProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {children}
      </div>
    </OnboardingProvider>
  )
}
