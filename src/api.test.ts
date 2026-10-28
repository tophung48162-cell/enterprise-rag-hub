import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hubApi, HubApiError, recognizeOcr } from './api'
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
