import { describe, expect, it } from 'vitest'
import { isTechnicalEmail, loginPattern, signInEmail } from '@/lib/users'

describe('signInEmail', () => {
  it('turns a login into the technical address', () => {
    expect(signInEmail(' Ivanov ')).toBe('ivanov@inventory.local')
  })
  it('keeps a real email', () => {
    expect(signInEmail('kb09062001@gmail.com')).toBe('kb09062001@gmail.com')
  })
})

describe('login rules', () => {
  it('accepts allowed logins', () => {
    expect(loginPattern.test('ivan.petrov-2_x')).toBe(true)
  })
  it('rejects short and odd logins', () => {
    expect(loginPattern.test('ab')).toBe(false)
    expect(loginPattern.test('иван')).toBe(false)
  })
  it('detects technical email', () => {
    expect(isTechnicalEmail('a@inventory.local')).toBe(true)
    expect(isTechnicalEmail('a@gmail.com')).toBe(false)
  })
})
