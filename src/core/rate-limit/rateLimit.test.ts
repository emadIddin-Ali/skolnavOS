import { describe, it, expect } from 'vitest'
import { checkRateLimit, RATE_LIMITS } from './rateLimit'

describe('rate limiter', () => {
  it('tillåter under gränsen och rapporterar återstående', () => {
    const r1 = checkRateLimit('absence.report', 'user:rl-test-1', 'org-lund')
    expect(r1.allowed).toBe(true)
    expect(r1.state).toBe('normal')
    expect(r1.remaining).toBe(RATE_LIMITS['absence.report'].limit - 1)
  })

  it('flaggar "närmar sig gräns" vid 85 %', () => {
    const limit = RATE_LIMITS['announcement'].limit // 10
    let last = checkRateLimit('announcement', 'user:rl-test-2', 'org-lund')
    for (let i = 1; i < limit; i++) last = checkRateLimit('announcement', 'user:rl-test-2', 'org-lund')
    expect(last.allowed).toBe(true)
    expect(last.state).toBe('narmar_grans')
  })

  it('blockerar över gränsen med svenskt meddelande', () => {
    const limit = RATE_LIMITS['login'].limit // 5
    let last = checkRateLimit('login', 'ip:rl-test-3', 'org-lund')
    for (let i = 0; i < limit + 1; i++) last = checkRateLimit('login', 'ip:rl-test-3', 'org-lund')
    expect(last.allowed).toBe(false)
    expect(last.state).toBe('blockerad')
    expect(last.message).toMatch(/För många försök/)
  })

  it('eskalerar vid kraftigt överskriden gräns', () => {
    const limit = RATE_LIMITS['absence.report'].limit
    let last = checkRateLimit('absence.report', 'user:rl-test-4', 'org-lund')
    for (let i = 0; i < limit * 2 + 2; i++) last = checkRateLimit('absence.report', 'user:rl-test-4', 'org-lund')
    expect(last.state).toBe('eskalerad')
  })

  it('okänd dimension är obegränsad (ingen regel)', () => {
    const r = checkRateLimit('finns.inte', 'user:x', 'org-lund')
    expect(r.allowed).toBe(true)
  })

  it('separata scope räknas separat', () => {
    const a = checkRateLimit('export', 'user:rl-a', 'org-lund')
    const b = checkRateLimit('export', 'user:rl-b', 'org-lund')
    expect(a.remaining).toBe(b.remaining)
  })
})
