import {
  defaultLabelSettings,
  labelTemplates,
  type LabelFieldSettings,
  type LabelTemplateId,
} from '@/lib/label-templates'

const STORAGE_KEY = 'inventory.label-settings'

function isTemplateId(value: string): value is LabelTemplateId {
  return labelTemplates.some((item) => item.id === value)
}

export function readLabelSettings(): LabelFieldSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultLabelSettings
    const parsed = JSON.parse(raw) as Partial<LabelFieldSettings>
    const templateId =
      typeof parsed.templateId === 'string' && isTemplateId(parsed.templateId)
        ? parsed.templateId
        : defaultLabelSettings.templateId
    return {
      templateId,
      showName: parsed.showName !== false,
      showInventory: parsed.showInventory === true,
      showSerial: parsed.showSerial === true,
    }
  } catch {
    return defaultLabelSettings
  }
}

export function writeLabelSettings(settings: LabelFieldSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Настройки останутся до перезагрузки вкладки.
  }
}

const SELECTION_KEY = 'inventory.label-codes'

export function stashLabelCodes(codes: string[]) {
  sessionStorage.setItem(SELECTION_KEY, JSON.stringify(codes))
}

export function peekLabelCodes(): string[] {
  try {
    const raw = sessionStorage.getItem(SELECTION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    )
  } catch {
    return []
  }
}

export function parseLabelCodes(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
