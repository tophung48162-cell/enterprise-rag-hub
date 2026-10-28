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
  startOcr: (file: File, modelConfigId: string) => {
    const body = new FormData()
    body.append('model_config_id', modelConfigId)
    body.append('file', file, file.name)
    return request<OcrResultDto>('/ocr/recognize/async', { method: 'POST', body })
  },
  getOcr: (id: string) => request<OcrResultDto>(`/ocr/${id}`),
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
