'use client'

import { useOnboarding } from './_context/onboarding-context'
import StepLogin from './_components/step-login'
import StepChannel from './_components/step-channel'
import StepStore from './_components/step-store'
import StepProducts from './_components/step-products'
import StepComplete from './_components/step-complete'
import ProgressBar from './_components/progress-bar'

const steps = [StepLogin, StepChannel, StepStore, StepProducts, StepComplete]

export default function OnboardingPage() {
  const { step } = useOnboarding()
  const StepComponent = steps[step - 1]

  return (
    <>
      {step < 5 && <ProgressBar />}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className={`w-full ${step === 4 ? 'max-w-2xl' : 'max-w-lg'}`}>
          <StepComponent />
        </div>
      </main>
    </>
  )
}
