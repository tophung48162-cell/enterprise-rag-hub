import { useCallback, useEffect, useState } from 'react'
import { apiErrorMessage, hubApi } from './api'
import type {
  ObservabilityErrorDto,
  ObservabilityErrorGroupDto,
  ObservabilityRunDetailDto,
  ObservabilityRunDto,
  ObservabilitySpanDto,
  ObservabilitySummaryDto,
} from './api'
import {
  observabilityErrors as demoErrors,
  observabilityRuns as demoRuns,
  observabilitySpans as demoSpans,
} from './observabilityData'
import type { ObservabilityError, ObservabilityRun, ObservabilitySpan } from './observabilityData'

const displayTime = (value: string) => value
  .replace('T', ' ')
  .replace(/(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/, '')
  .slice(0, 19)

export function mapObservabilityRun(dto: ObservabilityRunDto): ObservabilityRun {
  return {
    id: dto.id,
    traceId: dto.trace_id,
    kind: dto.kind,
    name: dto.name,
    target: dto.target,
    secondaryTarget: dto.secondary_target,
    status: dto.status,
    startedAt: displayTime(dto.started_at),
    durationMs: dto.duration_ms,
    progress: dto.progress,
    provider: dto.provider,
    model: dto.model,
    usage: dto.usage,
    estimatedCost: dto.estimated_cost,
    costCoverage: dto.cost_coverage,
    errorCode: dto.error_code || undefined,
    query: dto.query,
    answer: dto.answer,
  }
}

export function mapObservabilitySpan(dto: ObservabilitySpanDto): ObservabilitySpan {
  return {
    id: dto.id,
    runId: dto.run_id,
    parentId: dto.parent_id,
    kind: dto.kind,
    name: dto.name,
    status: dto.status,
    offsetMs: dto.offset_ms,
    durationMs: dto.duration_ms,
    summary: dto.summary,
    input: dto.input,
    output: dto.output,
    provider: dto.provider || undefined,
    model: dto.model || undefined,
    usage: dto.usage || undefined,
    estimatedCost: dto.estimated_cost,
    attempt: dto.attempt,
    errorCode: dto.error_code || undefined,
    metadata: dto.metadata,
    contextSnapshot: dto.context_snapshot ? {
      id: dto.context_snapshot.id,
      messages: dto.context_snapshot.messages,
      metadata: dto.context_snapshot.metadata,
      createdAt: displayTime(dto.context_snapshot.created_at),
    } : null,
  }
}

export function mapObservabilityError(dto: ObservabilityErrorDto | ObservabilityErrorGroupDto): ObservabilityError {
  return {
    id: dto.id,
    runId: dto.run_id,
    spanId: dto.span_id || '',
    category: dto.category,
    severity: dto.severity,
    code: dto.code,
    message: dto.message,
    fingerprint: dto.fingerprint,
    count: dto.count,
    affectedRunCount: 'affected_run_count' in dto ? dto.affected_run_count : 1,
    firstOccurredAt: displayTime(dto.first_occurred_at),
    lastOccurredAt: displayTime(dto.last_occurred_at),
    retryable: dto.retryable,
  }
}

function mapDetail(dto: ObservabilityRunDetailDto) {
  return { run: mapObservabilityRun(dto.run), spans: dto.spans.map(mapObservabilitySpan) }
}

interface RemoteState<T> {
  data: T | null
  loading: boolean
  error: string
  reload: () => Promise<void>
}

function useRemote<T>(connected: boolean, loader: () => Promise<T>): RemoteState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    if (!connected) return
    setLoading(true)
    setError('')
    try {
      setData(await loader())
    } catch (reason) {
      setError(apiErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [connected, loader])
  useEffect(() => {
    if (!connected) {
      setData(null)
      setError('')
      setLoading(false)
      return
    }
    void reload()
  }, [connected, reload])
  return { data: connected ? data : null, loading: connected && loading, error: connected ? error : '', reload }
}

export function useObservabilityRuns(connected: boolean) {
  const loader = useCallback(async () => (await hubApi.listObservabilityRuns()).map(mapObservabilityRun), [])
  const remote = useRemote(connected, loader)
  return { ...remote, runs: connected ? remote.data || [] : demoRuns }
}

export function useObservabilityRun(connected: boolean, runId?: string) {
  const loader = useCallback(async () => mapDetail(await hubApi.getObservabilityRun(runId || '')), [runId])
  const remote = useRemote(connected && Boolean(runId), loader)
  const demoDetail = runId ? {
    run: demoRuns.find((run) => run.id === runId) || null,
    spans: demoSpans.filter((span) => span.runId === runId),
  } : null
  return { ...remote, detail: connected ? remote.data : demoDetail }
}

export function useObservabilityErrors(connected: boolean) {
  const loader = useCallback(async () => (await hubApi.listObservabilityErrorGroups()).map(mapObservabilityError), [])
  const remote = useRemote(connected, loader)
  return { ...remote, errors: connected ? remote.data || [] : demoErrors }
}

export function useObservabilityOverview(connected: boolean) {
  const loader = useCallback(async () => {
    const [summary, errors] = await Promise.all([hubApi.getObservabilitySummary(), hubApi.listObservabilityErrorGroups()])
    return { summary, errors: errors.map(mapObservabilityError) }
  }, [])
  return useRemote(connected, loader)
}

export type { ObservabilitySummaryDto }
