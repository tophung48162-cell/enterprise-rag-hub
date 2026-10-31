import { describe, expect, it } from 'vitest'

import {
  filterRuns,
  formatDuration,
  formatTokens,
  observabilityRuns,
  observabilitySpans,
  successRate,
  sumKnownTokens,
} from './observabilityData'

describe('observability prototype calculations', () => {
  it('keeps unavailable token and cost values visibly unknown', () => {
    const failed = observabilityRuns.find((run) => run.id === 'run-chat-030')!
    expect(failed.usage.total).toBeNull()
    expect(failed.usage.source).toBe('unavailable')
    expect(failed.estimatedCost).toBeNull()
    expect(formatTokens(failed.usage.total)).toBe('未提供')
  })

  it('sums only known token values without treating unknown as measured zero', () => {
    const expected = observabilityRuns.reduce((sum, run) => sum + (run.usage.total || 0), 0)
    expect(sumKnownTokens(observabilityRuns)).toBe(expected)
    expect(observabilityRuns.some((run) => run.usage.total === null)).toBe(true)
  })

  it('excludes running runs from the success-rate denominator', () => {
    expect(successRate(observabilityRuns)).toBe(40)
    expect(successRate([])).toBe(0)
  })

  it('filters runs by combined kind, status, provider and keyword', () => {
    expect(filterRuns(observabilityRuns, { status: 'failed' })).toHaveLength(2)
    expect(filterRuns(observabilityRuns, { kind: 'build', provider: 'AIHubmix' }).map((run) => run.id)).toEqual(['run-build-017'])
    expect(filterRuns(observabilityRuns, { search: '差旅报销' }).map((run) => run.id)).toEqual(['run-chat-031'])
    expect(filterRuns(observabilityRuns, { search: 'not-found' })).toEqual([])
  })

  it('keeps every span attached to an existing run and valid parent', () => {
    const runIds = new Set(observabilityRuns.map((run) => run.id))
    const spanIds = new Set(observabilitySpans.map((span) => span.id))
    expect(spanIds.size).toBe(observabilitySpans.length)
    observabilitySpans.forEach((span) => {
      expect(runIds.has(span.runId)).toBe(true)
      if (span.parentId) expect(spanIds.has(span.parentId)).toBe(true)
    })
    expect(formatDuration(842)).toBe('842 ms')
    expect(formatDuration(2840)).toBe('2.84 秒')
  })
})
