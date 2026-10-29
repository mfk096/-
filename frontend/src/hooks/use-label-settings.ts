import { useCallback, useState } from 'react'
import { readLabelSettings, writeLabelSettings } from '@/lib/label-settings'
import type { LabelFieldSettings } from '@/lib/label-templates'

export function useLabelSettings() {
  const [settings, setSettings] = useState<LabelFieldSettings>(() => readLabelSettings())

  const update = useCallback((patch: Partial<LabelFieldSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      writeLabelSettings(next)
      return next
    })
  }, [])

  return { settings, update }
}
