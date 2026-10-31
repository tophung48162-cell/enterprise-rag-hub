import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hubApi, HubApiError, recognizeOcr, streamChat } from './api'
import type { OcrResultDto } from './api'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function ocrResult(status: OcrResultDto['status']): OcrResultDto {
  return {
    id: 'ocr-1', retry_of_id: null, file_name: '流程图.png', sha256: 'abc', status,
    text: status === 'ready' ? '真实 OCR 正文' : '', input_tokens: 10, output_tokens: 4,
    usage_source: 'provider', duration_ms: status === 'ready' ? 320 : null,
    error_code: status === 'failed' ? 'OCR_PROVIDER_FAILED' : null,
    created_at: '2026-10-27T00:00:00Z', completed_at: status === 'ready' || status === 'failed' ? '2026-10-27T00:00:01Z' : null,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('FastAPI client contracts', () => {
  it('rejects invalid list responses instead of treating them as an empty backend', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null))
    await expect(hubApi.listProviders()).rejects.toMatchObject({ code: 'API_INVALID_RESPONSE', retryable: false })
  })

  it('submits provider credentials only in the request and keeps them out of the returned DTO', async () => {
    const provider = { id: 'p1', kind: 'tongyi', name: '通义百炼', base_url: 'https://example.cn/v1', configured: true, enabled: true }
    fetchMock.mockResolvedValueOnce(jsonResponse(provider, 201))
    const result = await hubApi.createProvider({ kind: 'tongyi', name: '通义百炼', base_url: provider.base_url, api_key: 'secret-for-request' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/providers')
    expect(JSON.parse(init.body)).toMatchObject({ api_key: 'secret-for-request' })
    expect(result).toEqual(provider)
    expect(result).not.toHaveProperty('api_key')
  })

  it('creates a model with backend field names and optional dimensions', async () => {
    const model = { id: 'm1', provider_id: 'p1', remote_model_id: 'text-embedding-v4', capability: 'Embedding', dimensions: 1024, enabled: true }
    fetchMock.mockResolvedValueOnce(jsonResponse(model, 201))
    await expect(hubApi.createModel({ provider_id: 'p1', remote_model_id: model.remote_model_id, capability: 'Embedding', dimensions: 1024, enabled: true })).resolves.toEqual(model)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider_id: 'p1', remote_model_id: 'text-embedding-v4', capability: 'Embedding', dimensions: 1024, enabled: true })
  })

  it('creates a knowledge base with persistent model references and chunk settings', async () => {
    const knowledgeBase = { id: 'kb-1', name: '研发制度', description: '真实资料', department: '产品研发', published: false, managed: true, embedding_model_id: 'embed-1', rerank_model_id: 'rank-1', chunk_size: 800, chunk_overlap: 120, chunk_strategy: 'structure', document_count: 0, chunk_count: 0, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z' }
    fetchMock.mockResolvedValueOnce(jsonResponse(knowledgeBase, 201))
    await expect(hubApi.createKnowledgeBase({ name: '研发制度', description: '真实资料', department: '产品研发', embedding_model_id: 'embed-1', rerank_model_id: 'rank-1', published: false, chunk_size: 800, chunk_overlap: 120, chunk_strategy: 'structure' })).resolves.toEqual(knowledgeBase)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/knowledge-bases')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ embedding_model_id: 'embed-1', rerank_model_id: 'rank-1', chunk_strategy: 'structure' })
  })

  it('uploads Markdown as multipart without setting a JSON content type', async () => {
    const document = { id: 'doc-1', kb_id: 'kb-1', original_name: '研发规范.md', mime: 'text/markdown', extension: '.md', size_bytes: 24, sha256: 'abc', status: 'uploaded', parser_version: 'markdown-v1', error_code: null, chunk_count: 0, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z' }
    fetchMock.mockResolvedValueOnce(jsonResponse(document, 201))
    const file = new File(['# 研发规范\n\n正文'], '研发规范.md', { type: 'text/markdown' })
    await expect(hubApi.uploadDocument('kb-1', file)).resolves.toEqual(document)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/knowledge-bases/kb-1/documents')
    expect(init.body).toBeInstanceOf(FormData)
    const uploaded = init.body.get('file') as File
    expect(uploaded.name).toBe(file.name)
    expect(uploaded.size).toBe(file.size)
    expect(await uploaded.text()).toBe(await file.text())
    expect(init.headers).toBeUndefined()
  })

  it('previews persistent chunks and patches edited chunk text with backend contracts', async () => {
    const preview = { document: { id: 'doc-1', status: 'pending_index' }, chunks: [{ id: 'chunk-1', text: '服务端正文' }] }
    fetchMock.mockResolvedValueOnce(jsonResponse(preview)).mockResolvedValueOnce(jsonResponse({ id: 'chunk-1', text: '人工修订正文', status: 'pending_index' }))
    await hubApi.previewDocument('doc-1', { chunk_size: 600, chunk_overlap: 80, chunk_strategy: 'recursive' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/documents/doc-1/preview')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ chunk_size: 600, chunk_overlap: 80, chunk_strategy: 'recursive' })
    await hubApi.patchChunk('chunk-1', '人工修订正文')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/chunks/chunk-1')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ text: '人工修订正文' })
  })

  it('creates and queries immutable index versions with backend contracts', async () => {
    const version = {
      id: 'index-1', kb_id: 'kb-1', embedding_model_id: 'embed-1', dimensions: 1024,
      chunk_size: 800, chunk_overlap: 120, chunk_strategy: 'structure', status: 'queued', progress: 0,
      total_chunks: 2, embedded_chunks: 0, input_tokens: null, usage_source: 'unavailable', duration_ms: null,
      error_code: null, created_at: '2026-10-28T00:00:00Z', started_at: null, completed_at: null, activated_at: null,
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(version, 202))
      .mockResolvedValueOnce(jsonResponse([version]))
      .mockResolvedValueOnce(jsonResponse({ ...version, status: 'active', progress: 100 }))
    await expect(hubApi.createIndexVersion('kb-1')).resolves.toMatchObject({ id: 'index-1', status: 'queued' })
    await expect(hubApi.listIndexVersions('kb-1')).resolves.toHaveLength(1)
    await expect(hubApi.getIndexVersion('index-1')).resolves.toMatchObject({ status: 'active', progress: 100 })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/knowledge-bases/kb-1/index-versions',
      '/api/v1/knowledge-bases/kb-1/index-versions',
      '/api/v1/index-versions/index-1',
    ])
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('retrieves active index snapshots with vector and rerank contracts', async () => {
    const response = {
      index_version_id: 'index-1', candidate_count: 2, duration_ms: 36, embedding_duration_ms: 12, rerank_duration_ms: 8,
      results: [{ chunk_id: 'chunk-1', document_id: 'doc-1', document_name: '员工指南.md', sequence: 2, title: '报销申请', text: '需要合规发票', page_number: 2, vector_score: 0.82, rerank_score: 0.96 }],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(response))
    await expect(hubApi.retrieveKnowledge('kb-1', { query: '报销材料', top_k: 1, candidate_k: 20, similarity_threshold: 0.35, rerank: true })).resolves.toEqual(response)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/knowledge-bases/kb-1/retrieval')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ query: '报销材料', top_k: 1, candidate_k: 20, similarity_threshold: 0.35, rerank: true })
  })

  it('parses grounded SSE events across arbitrary network chunk boundaries', async () => {
    const payload = [
      'event: meta\ndata: {"conversation_id":"conv-1","user_message_id":"u1","answer_message_id":"a1","run_id":"run-1"}\n\n',
      'event: citations\ndata: {"items":[{"id":"cite-1"}]}\n\n',
      'event: token\ndata: {"text":"需要合规"}\n\n',
      'event: token\ndata: {"text":"发票。"}\n\n',
      'event: done\ndata: {"run_id":"run-1","message_id":"a1","status":"succeeded","input_tokens":10,"output_tokens":4,"total_tokens":14,"usage_source":"provider","first_token_ms":30,"total_ms":80,"citation_count":1}\n\n',
    ].join('')
    const bytes = new TextEncoder().encode(payload)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 41))
        controller.enqueue(bytes.slice(41, 113))
        controller.enqueue(bytes.slice(113))
        controller.close()
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const handlers = { onMeta: vi.fn(), onCitations: vi.fn(), onToken: vi.fn(), onDone: vi.fn() }
    await streamChat('conv-1', { query: '报销材料', role_context: 'user' }, handlers, new AbortController().signal)
    expect(handlers.onMeta).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'run-1' }))
    expect(handlers.onCitations).toHaveBeenCalledWith([{ id: 'cite-1' }])
    expect(handlers.onToken.mock.calls.map(([text]) => text).join('')).toBe('需要合规发票。')
    expect(handlers.onDone).toHaveBeenCalledWith(expect.objectContaining({ total_tokens: 14, usage_source: 'provider' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ query: '报销材料', role_context: 'user' })
  })

  it('surfaces safe SSE error events without treating them as successful answers', async () => {
    const body = 'event: error\ndata: {"code":"LLM_PROVIDER_FAILED","message":"LLM 服务商调用失败，请检查模型配置后重试","run_id":"run-1"}\n\n'
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const handlers = { onMeta: vi.fn(), onCitations: vi.fn(), onToken: vi.fn(), onDone: vi.fn() }
    await expect(streamChat('conv-1', { query: '问题', role_context: 'user' }, handlers, new AbortController().signal))
      .rejects.toMatchObject({ code: 'LLM_PROVIDER_FAILED', message: 'LLM 服务商调用失败，请检查模型配置后重试' })
    expect(handlers.onDone).not.toHaveBeenCalled()
  })

  it('uses observability filters and preserves real trace, context snapshot and unknown-usage contracts', async () => {
    const run = { id: 'run-obs', trace_id: 'trace-obs', kind: 'chat', usage: { input: null, output: null, total: null, source: 'unavailable' } }
    const contextSnapshot = {
      id: 'snapshot-obs',
      messages: [{ role: 'system', content: '真实系统提示词' }, { role: 'user', content: '真实当前问题' }],
      metadata: { context_hash: 'sha256:observed', message_count: 2, history_limit: 12 },
      created_at: '2026-10-31T12:00:00Z',
    }
    const detail = { run, spans: [{ id: 'span-obs', run_id: 'run-obs', parent_id: null, usage: null, metadata: { full_snapshot_captured: true }, context_snapshot: contextSnapshot }] }
    const summary = { run_count: 1, success_rate: 100, total_tokens: 0, unknown_usage_count: 1, status_counts: { succeeded: 1 }, trend: [], slow_spans: [] }
    const errors = [{ id: 'error-obs', run_id: 'run-obs', span_id: 'span-obs', code: 'USAGE_UNAVAILABLE', count: 1 }]
    const groups = [{ ...errors[0], count: 3, affected_run_count: 2, first_occurred_at: '2026-10-30T12:00:00Z', last_occurred_at: '2026-10-31T12:00:00Z' }]
    fetchMock
      .mockResolvedValueOnce(jsonResponse([run]))
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse(summary))
      .mockResolvedValueOnce(jsonResponse(errors))
      .mockResolvedValueOnce(jsonResponse(groups))
    await expect(hubApi.listObservabilityRuns({ search: '报销', status: 'succeeded', kind: 'chat' })).resolves.toEqual([run])
    await expect(hubApi.getObservabilityRun('run-obs')).resolves.toEqual(detail)
    await expect(hubApi.getObservabilitySummary()).resolves.toEqual(summary)
    await expect(hubApi.listObservabilityErrors()).resolves.toEqual(errors)
    await expect(hubApi.listObservabilityErrorGroups()).resolves.toEqual(groups)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/observability/runs?search=%E6%8A%A5%E9%94%80&status=succeeded&kind=chat',
      '/api/v1/observability/runs/run-obs',
      '/api/v1/observability/summary',
      '/api/v1/observability/errors',
      '/api/v1/observability/errors/groups',
    ])
  })

  it('polls OCR from queued to ready and returns recognized text', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ocrResult('queued'), 202)).mockResolvedValueOnce(jsonResponse(ocrResult('ready')))
    const file = new File(['image'], '流程图.png', { type: 'image/png' })
    const result = await recognizeOcr(file, 'ocr-model', { pollIntervalMs: 0 })
    expect(result.text).toBe('真实 OCR 正文')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/ocr/recognize/async')
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/ocr/ocr-1')
  })

  it('surfaces OCR task failure without fabricating recognized content', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ocrResult('failed'), 202))
    const file = new File(['image'], '流程图.png', { type: 'image/png' })
    const promise = recognizeOcr(file, 'ocr-model', { pollIntervalMs: 0 })
    await expect(promise).rejects.toBeInstanceOf(HubApiError)
    await expect(promise).rejects.toMatchObject({ code: 'OCR_PROVIDER_FAILED' })
  })
})
