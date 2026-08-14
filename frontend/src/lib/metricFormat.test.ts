import { describe, expect, it } from 'vitest'
import { EMPTY, formatCount, formatDuration, formatPercent, formatTokens } from './metricFormat'

// The formatters must tell a real zero apart from absence of telemetry (null → "—").
describe('metricFormat', () => {
  it('null/undefined render as the em dash, zero renders as a real value', () => {
    expect(formatDuration(null)).toBe(EMPTY)
    expect(formatTokens(undefined)).toBe(EMPTY)
    expect(formatCount(null)).toBe(EMPTY)
    expect(formatPercent(null)).toBe(EMPTY)
    expect(formatCount(0)).toBe('0')
    expect(formatTokens(0)).toBe('0')
    expect(formatDuration(0)).toBe('0ms')
    expect(formatPercent(0)).toBe('0%')
  })

  it('formatDuration scales ms → s → min → h', () => {
    expect(formatDuration(450)).toBe('450ms')
    expect(formatDuration(2500)).toBe('2.5s')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(90_000)).toBe('1.5min')
    expect(formatDuration(3_600_000)).toBe('1.0h')
  })

  it('formatTokens is compact', () => {
    expect(formatTokens(850)).toBe('850')
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(42_000)).toBe('42k')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })

  it('formatPercent rounds a 0..1 rate', () => {
    expect(formatPercent(0.75)).toBe('75%')
    expect(formatPercent(1)).toBe('100%')
  })
})
