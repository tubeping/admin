'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface ChannelInfo {
  id: string
  title: string
  thumbnail: string
  subscriberCount: string
  description: string
}

export interface OnboardingData {
  // S-01
  authMethod: string | null
  // S-02
  channelUrl: string
  channelInfo: ChannelInfo | null
  // S-03
  storeName: string
  storeSlug: string
  theme: 'minimal' | 'bold' | 'playful'
  // S-04
  selectedProducts: string[]
}

interface OnboardingContextType {
  step: number
  data: OnboardingData
  setStep: (step: number) => void
  updateData: (partial: Partial<OnboardingData>) => void
  next: () => void
  prev: () => void
}

const defaultData: OnboardingData = {
  authMethod: null,
  channelUrl: '',
  channelInfo: null,
  storeName: '',
  storeSlug: '',
  theme: 'minimal',
  selectedProducts: [],
}

const OnboardingContext = createContext<OnboardingContextType | null>(null)

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<OnboardingData>(defaultData)

  const updateData = useCallback((partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }))
  }, [])

  const next = useCallback(() => setStep((s) => Math.min(s + 1, 5)), [])
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 1)), [])

  return (
    <OnboardingContext.Provider value={{ step, data, setStep, updateData, next, prev }}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider')
  return ctx
}
