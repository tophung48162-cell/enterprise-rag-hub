const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export type ProviderKind = 'tongyi' | 'openrouter' | 'aihubmix'
export type ModelCapability = 'LLM' | 'Embedding' | 'Rerank'

export interface ProviderDto {
  id: string
  kind: ProviderKind
  name: string
  base_url: string
  configured: boolean
  enabled: boolean
}

export interface ModelDto {
  id: string
  provider_id: string
  remote_model_id: string
  capability: ModelCapability
  dimensions: number | null
  enabled: boolean
}

export interface TestResultDto {
  success: boolean
  duration_ms: number
  input_tokens: number | null
  output_tokens: number | null
  usage_source: string
}

export interface OcrResultDto {
  id: string
  retry_of_id: string | null
  file_name: string
  sha256: string
  status: 'queued' | 'processing' | 'ready' | 'failed'
  text: string
  input_tokens: number | null
  output_tokens: number | null
  usage_source: string
  duration_ms: number | null
  error_code: string | null
  created_at: string
  completed_at: string | null
}

export interface KnowledgeBaseDto {
  id: string
  name: string
  description: string
  department: string
  published: boolean
  managed: boolean
  embedding_model_id: string
  rerank_model_id: string | null
  chunk_size: number
  chunk_overlap: number
  chunk_strategy: 'structure' | 'recursive'
  active_index_version_id: string | null
  document_count: number
  chunk_count: number
  created_at: string
  updated_at: string
}

export interface IndexVersionDto {
  id: string
  kb_id: string
  embedding_model_id: string
  dimensions: number
  chunk_size: number
  chunk_overlap: number
  chunk_strategy: 'structure' | 'recursive'
  status: 'queued' | 'building' | 'active' | 'ready' | 'failed'
  progress: number
  total_chunks: number
  embedded_chunks: number
  input_tokens: number | null
  usage_source: string
  duration_ms: number | null
  error_code: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  activated_at: string | null
}

export interface RetrievalResultDto {
  chunk_id: string
  document_id: string
  document_name: string
  sequence: number
  title: string
  text: string
  page_number: number
  vector_score: number
  rerank_score: number | null
}

export interface RetrievalResponseDto {
  index_version_id: string
  results: RetrievalResultDto[]
  candidate_count: number
  duration_ms: number
  embedding_duration_ms: number
  rerank_duration_ms: number | null
}

export interface RetrievalInput {
  query: string
  top_k: number
  candidate_k: number
  similarity_threshold: number
  rerank: boolean
}

export interface KnowledgeBaseInput {
  name: string
  description: string
  department: string
  embedding_model_id: string
  rerank_model_id?: string | null
  published?: boolean
  chunk_size?: number
  chunk_overlap?: number
  chunk_strategy?: 'structure' | 'recursive'
}

export interface DocumentDto {
  id: string
  kb_id: string
  original_name: string
  mime: string
  extension: string
  size_bytes: number
  sha256: string
  status: 'uploaded' | 'pending_index' | 'processing' | 'ready' | 'failed'
  parser_version: string
  error_code: string | null
  chunk_count: number
  created_at: string
  updated_at: string
}

export interface ChunkDto {
  id: string
  kb_id: string
  document_id: string
  sequence: number
  title: string
  text: string
  page_number: number
  status: 'pending_index' | 'indexing' | 'ready' | 'failed'
  created_at: string
  updated_at: string
}

export interface DocumentPreviewDto {
  document: DocumentDto
  chunks: ChunkDto[]
}

export interface AssistantDto {
  id: string
  name: string
  description: string
  llm_model_id: string
  kb_ids: string[]
  system_prompt: string
  top_k: number
  candidate_k: number
  similarity_threshold: number
  rerank_enabled: boolean
  published: boolean
  managed: boolean
  created_at: string
  updated_at: string
}

export interface AssistantInput {
  name: string
  description: string
  llm_model_id: string
  kb_ids: string[]
  system_prompt: string
  top_k: number
  candidate_k: number
  similarity_threshold: number
  rerank_enabled: boolean
  published: boolean
}

export interface ConversationDto {
  id: string
  assistant_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface CitationDto {
  id: string
  chunk_id: string
  ordinal: number
  document_name: string
  title: string
  snapshot_text: string
  page_number: number
  vector_score: number
  rerank_score: number | null
}

export interface MessageDto {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'ready' | 'running' | 'failed' | 'stopped'
  citations: CitationDto[]
  created_at: string
}

export interface ConversationDetailDto extends ConversationDto {
  messages: MessageDto[]
}

export interface QueryRunDto {
  id: string
  conversation_id: string
  assistant_id: string
  assistant_name: string
  kb_ids: string[]
  query: string
  answer: string
  role_context: 'admin' | 'manager' | 'user'
  status: 'running' | 'succeeded' | 'failed' | 'stopped'
  llm_model: string
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  usage_source: 'provider' | 'unavailable'
  first_token_ms: number | null
  total_ms: number | null
  citation_count: number
  error_code: string | null
  created_at: string
}

export interface ObservabilityUsageDto {
  input: number | null
  output: number | null
  total: number | null
  source: 'provider' | 'unavailable'
}

export interface ObservabilityRunDto {
  id: string
  trace_id: string
  kind: 'chat' | 'build'
  name: string
  target: string
  secondary_target: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'stopped' | 'timed_out'
  started_at: string
  duration_ms: number
  progress: number
  provider: string
  model: string
  usage: ObservabilityUsageDto
  estimated_cost: number | null
  cost_coverage: number
  error_code: string | null
  query: string
  answer: string
}

export interface ObservabilityContextSnapshotDto {
  id: string
  messages: Array<{ role: string; content: string }>
  metadata: Record<string, unknown>
  created_at: string
}

export interface ObservabilitySpanDto {
  id: string
  run_id: string
  parent_id: string | null
  kind: 'stage' | 'model' | 'tool' | 'skill' | 'harness'
  name: string
  status: ObservabilityRunDto['status']
  offset_ms: number
  duration_ms: number
  summary: string
  input: string
  output: string
  provider: string | null
  model: string | null
  usage: ObservabilityUsageDto | null
  estimated_cost: number | null
  attempt: number
  error_code: string | null
  metadata: Record<string, unknown>
  context_snapshot?: ObservabilityContextSnapshotDto | null
}

export interface ObservabilityRunDetailDto {
  run: ObservabilityRunDto
  spans: ObservabilitySpanDto[]
}

export interface ObservabilityErrorDto {
  id: string
  run_id: string
  span_id: string | null
  category: '模型调用' | '检索质量' | '工具／Skill' | '上下文' | 'Harness' | '可观测自身'
  severity: 'warning' | 'error' | 'critical'
  code: string
  message: string
  fingerprint: string
  count: number
  first_occurred_at: string
  last_occurred_at: string
  retryable: boolean
}

export interface ObservabilitySummaryDto {
  run_count: number
  success_rate: number
  total_tokens: number
  unknown_usage_count: number
  estimated_cost: number | null
  cost_coverage: number
  status_counts: Record<string, number>
  trend: Array<{ day: string; runs: number; failed: number; tokens: number }>
  slow_spans: ObservabilitySpanDto[]
}

export interface ChatDoneDto {
  run_id: string
  message_id: string
  status: 'succeeded'
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  usage_source: 'provider' | 'unavailable'
  first_token_ms: number | null
  total_ms: number
  citation_count: number
}

export interface ChatStreamHandlers {
  onMeta: (data: { conversation_id: string; user_message_id: string; answer_message_id: string; run_id: string; trace_id: string }) => void
  onCitations: (items: CitationDto[]) => void
  onToken: (text: string) => void
  onDone: (data: ChatDoneDto) => void
}

export class HubApiError extends Error {
  constructor(
    message: string,
    readonly code = 'API_UNAVAILABLE',
    readonly status = 0,
    readonly retryable = true,
  ) {
    super(message)
    this.name = 'HubApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new HubApiError('无法连接后端，请确认 FastAPI 已启动')
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = payload?.error
    throw new HubApiError(
      error?.message || `后端请求失败（HTTP ${response.status}）`,
      error?.code || 'API_REQUEST_FAILED',
      response.status,
      Boolean(error?.retryable),
    )
  }
  return payload as T
}

async function requestList<T>(path: string): Promise<T[]> {
  const payload = await request<unknown>(path)
  if (!Array.isArray(payload)) {
    throw new HubApiError('后端返回格式不正确', 'API_INVALID_RESPONSE', 500, false)
  }
  return payload as T[]
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const hubApi = {
  listProviders: () => requestList<ProviderDto>('/providers'),
  createProvider: (body: { kind: ProviderKind; name: string; base_url: string; api_key: string }) =>
    request<ProviderDto>('/providers', json('POST', body)),
  patchProvider: (id: string, body: { base_url?: string; api_key?: string; enabled?: boolean }) =>
    request<ProviderDto>(`/providers/${id}`, json('PATCH', body)),
  testProvider: (id: string) => request<TestResultDto>(`/providers/${id}/test`, json('POST', {})),
  listModels: () => requestList<ModelDto>('/models'),
  createModel: (body: {
    provider_id: string
    remote_model_id: string
    capability: ModelCapability
    dimensions?: number
    enabled: boolean
  }) => request<ModelDto>('/models', json('POST', body)),
  patchModel: (id: string, enabled: boolean) => request<ModelDto>(`/models/${id}`, json('PATCH', { enabled })),
  deleteModel: (id: string) => request<void>(`/models/${id}`, { method: 'DELETE' }),
  testModel: (id: string) => request<TestResultDto>(`/models/${id}/test`, json('POST', {})),
  listKnowledgeBases: () => requestList<KnowledgeBaseDto>('/knowledge-bases'),
  createKnowledgeBase: (body: KnowledgeBaseInput) => request<KnowledgeBaseDto>('/knowledge-bases', json('POST', body)),
  patchKnowledgeBase: (id: string, body: Partial<KnowledgeBaseInput>) =>
    request<KnowledgeBaseDto>(`/knowledge-bases/${id}`, json('PATCH', body)),
  deleteKnowledgeBase: (id: string) => request<void>(`/knowledge-bases/${id}`, { method: 'DELETE' }),
  listIndexVersions: (knowledgeBaseId: string) =>
    requestList<IndexVersionDto>(`/knowledge-bases/${knowledgeBaseId}/index-versions`),
  createIndexVersion: (knowledgeBaseId: string) =>
    request<IndexVersionDto>(`/knowledge-bases/${knowledgeBaseId}/index-versions`, { method: 'POST' }),
  getIndexVersion: (id: string) => request<IndexVersionDto>(`/index-versions/${id}`),
  retrieveKnowledge: (knowledgeBaseId: string, body: RetrievalInput) =>
    request<RetrievalResponseDto>(`/knowledge-bases/${knowledgeBaseId}/retrieval`, json('POST', body)),
  listDocuments: (knowledgeBaseId: string) => requestList<DocumentDto>(`/knowledge-bases/${knowledgeBaseId}/documents`),
  uploadDocument: (knowledgeBaseId: string, file: File) => {
    const body = new FormData()
    body.append('file', file, file.name)
    return request<DocumentDto>(`/knowledge-bases/${knowledgeBaseId}/documents`, { method: 'POST', body })
  },
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  previewDocument: (id: string, body: { chunk_size: number; chunk_overlap: number; chunk_strategy: 'structure' | 'recursive' }) =>
    request<DocumentPreviewDto>(`/documents/${id}/preview`, json('POST', body)),
  listChunks: (documentId: string) => requestList<ChunkDto>(`/documents/${documentId}/chunks`),
  patchChunk: (id: string, text: string) => request<ChunkDto>(`/chunks/${id}`, json('PATCH', { text })),
  listAssistants: () => requestList<AssistantDto>('/assistants'),
  createAssistant: (body: AssistantInput) => request<AssistantDto>('/assistants', json('POST', body)),
  patchAssistant: (id: string, body: Partial<AssistantInput>) =>
    request<AssistantDto>(`/assistants/${id}`, json('PATCH', body)),
  listConversations: (assistantId: string) =>
    requestList<ConversationDto>(`/assistants/${assistantId}/conversations`),
  createConversation: (assistantId: string) =>
    request<ConversationDto>(`/assistants/${assistantId}/conversations`, json('POST', {})),
  getConversation: (id: string) => request<ConversationDetailDto>(`/conversations/${id}`),
  deleteConversation: (id: string) => request<void>(`/conversations/${id}`, { method: 'DELETE' }),
  listQueryRuns: (knowledgeBaseId?: string) =>
    requestList<QueryRunDto>(`/query-runs${knowledgeBaseId ? `?kb_id=${encodeURIComponent(knowledgeBaseId)}` : ''}`),
  listObservabilityRuns: (filters: { search?: string; status?: string; provider?: string; kind?: 'all' | 'chat' | 'build' } = {}) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value) })
    const query = params.toString()
    return requestList<ObservabilityRunDto>(`/observability/runs${query ? `?${query}` : ''}`)
  },
  getObservabilitySummary: () => request<ObservabilitySummaryDto>('/observability/summary'),
  getObservabilityRun: (id: string) => request<ObservabilityRunDetailDto>(`/observability/runs/${id}`),
  listObservabilityErrors: () => requestList<ObservabilityErrorDto>('/observability/errors'),
  startOcr: (file: File, modelConfigId: string) => {
    const body = new FormData()
    body.append('model_config_id', modelConfigId)
    body.append('file', file, file.name)
    return request<OcrResultDto>('/ocr/recognize/async', { method: 'POST', body })
  },
  getOcr: (id: string) => request<OcrResultDto>(`/ocr/${id}`),
}

export async function streamChat(
  conversationId: string,
  body: { query: string; role_context: 'admin' | 'manager' | 'user' },
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/conversations/${conversationId}/messages/stream`, {
      ...json('POST', body),
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new HubApiError('无法连接后端，请确认 FastAPI 已启动')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const error = payload?.error
    throw new HubApiError(
      error?.message || `问答请求失败（HTTP ${response.status}）`,
      error?.code || 'CHAT_REQUEST_FAILED',
      response.status,
      Boolean(error?.retryable),
    )
  }
  if (!response.body) throw new HubApiError('浏览器无法读取流式回答', 'SSE_STREAM_UNAVAILABLE', 500, false)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const dispatch = (block: string) => {
    const lines = block.split('\n')
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7)
    const raw = lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
    if (!event || !raw) return
    const data = JSON.parse(raw)
    if (event === 'meta') handlers.onMeta(data)
    else if (event === 'citations') handlers.onCitations(data.items)
    else if (event === 'token') handlers.onToken(data.text)
    else if (event === 'done') handlers.onDone(data)
    else if (event === 'error') throw new HubApiError(data.message, data.code, 502, true)
  }
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      dispatch(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (buffer.trim()) dispatch(buffer.trim())
}

export async function recognizeOcr(
  file: File,
  modelConfigId: string,
  options: { pollIntervalMs?: number; maxAttempts?: number } = {},
): Promise<OcrResultDto> {
  const { pollIntervalMs = 1000, maxAttempts = 90 } = options
  let result = await hubApi.startOcr(file, modelConfigId)
  for (let attempt = 0; result.status !== 'ready' && attempt < maxAttempts; attempt += 1) {
    if (result.status === 'failed') {
      throw new HubApiError('云端 OCR 识别失败，请在后端检查记录后重试', result.error_code || 'OCR_FAILED', 502, true)
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    result = await hubApi.getOcr(result.id)
  }
  if (result.status !== 'ready') {
    throw new HubApiError('云端 OCR 等待超时，可稍后重新生成预览', 'OCR_POLL_TIMEOUT', 504, true)
  }
  return result
}

export function apiErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '后端请求失败，请稍后重试'
}
