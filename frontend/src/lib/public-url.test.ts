import { describe, expect, it } from 'vitest'
import { qrPayload } from '@/lib/label-templates'
import { normalizeScannedCode } from '@/lib/scan-code'
import {
  DEFAULT_PUBLIC_APP_URL,
  normalizePublicAppUrl,
  passwordResetRedirect,
  unitPublicUrl,
} from '@/lib/public-url'
import { TEST_SUPABASE_URL, resolveSupabaseUrl } from '@/lib/connection'

describe('публичный адрес', () => {
  it('по умолчанию ведёт на GitHub Pages и снимает хвостовые слэши', () => {
    expect(normalizePublicAppUrl(undefined)).toBe(DEFAULT_PUBLIC_APP_URL)
    expect(normalizePublicAppUrl('  ')).toBe(DEFAULT_PUBLIC_APP_URL)
    expect(normalizePublicAppUrl('https://plant.example/app/')).toBe('https://plant.example/app')
    expect(normalizePublicAppUrl('notaurl')).toBe(DEFAULT_PUBLIC_APP_URL)
    expect(normalizePublicAppUrl('javascript:alert(1)')).toBe(DEFAULT_PUBLIC_APP_URL)
  })

  it('собирает ссылку на карточку и на сброс пароля', () => {
    expect(unitPublicUrl(' KYOC-001 ', 'https://mfk096.github.io/-')).toBe(
      'https://mfk096.github.io/-/units/KYOC-001',
    )
    expect(passwordResetRedirect('https://mfk096.github.io/-/')).toBe(
      'https://mfk096.github.io/-/reset-password',
    )
  })

  it('QR содержит ссылку, а сканер вытаскивает из неё код', () => {
    const payload = qrPayload('KYOC-001')
    expect(payload.startsWith(`${DEFAULT_PUBLIC_APP_URL}/units/`)).toBe(true)
    expect(normalizeScannedCode(payload)).toBe('KYOC-001')
    expect(normalizeScannedCode('kyoc-001')).toBe('KYOC-001')
  })

  it('без переменной адрес Supabase — тестовый проект', () => {
    expect(resolveSupabaseUrl(undefined)).toBe(TEST_SUPABASE_URL)
    expect(resolveSupabaseUrl('  ')).toBe(TEST_SUPABASE_URL)
    expect(resolveSupabaseUrl('https://other.supabase.co/')).toBe('https://other.supabase.co')
  })
})
