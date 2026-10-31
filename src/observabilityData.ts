export type ObservabilityRunKind = 'build' | 'chat'
export type ObservabilityStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'stopped' | 'timed_out'
export type ObservabilitySpanKind = 'stage' | 'model' | 'tool' | 'skill' | 'harness'

export interface TokenUsage {
  input: number | null
  output: number | null
  total: number | null
  source: 'provider' | 'unavailable'
}

export interface ObservabilitySpan {
  id: string
  runId: string
  parentId: string | null
  name: string
  kind: ObservabilitySpanKind
  status: ObservabilityStatus
  offsetMs: number
  durationMs: number
  provider?: string
  model?: string
  input: string
  output: string
  summary: string
  usage?: TokenUsage
  estimatedCost?: number | null
  attempt?: number
  errorCode?: string
  metadata: Record<string, unknown>
}

export interface ObservabilityRun {
  id: string
  traceId: string
  kind: ObservabilityRunKind
  name: string
  target: string
  secondaryTarget: string
  status: ObservabilityStatus
  startedAt: string
  durationMs: number
  progress: number
  provider: string
  model: string
  usage: TokenUsage
  estimatedCost: number | null
  costCoverage: number
  errorCode?: string
  query?: string
  answer?: string
}

export interface ObservabilityError {
  id: string
  runId: string
  spanId: string
  category: '模型调用' | '检索质量' | '工具／Skill' | '上下文' | 'Harness' | '可观测自身'
  severity: 'warning' | 'error' | 'critical'
  code: string
  message: string
  fingerprint: string
  count: number
  firstOccurredAt: string
  lastOccurredAt: string
  retryable: boolean
}

export interface PriceRule {
  id: string
  provider: string
  model: string
  capability: 'LLM' | 'Embedding' | 'Rerank' | 'OCR'
  currency: 'CNY' | 'USD'
  inputPrice: number
  outputPrice: number
  requestPrice: number
  effectiveFrom: string
  sourceNote: string
}

export const STATUS_LABELS: Record<ObservabilityStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  stopped: '已停止',
  timed_out: '已超时',
}

export const STATUS_COLORS: Record<ObservabilityStatus, string> = {
  queued: 'default',
  running: 'processing',
  succeeded: 'success',
  failed: 'error',
  stopped: 'warning',
  timed_out: 'error',
}

export const SPAN_KIND_LABELS: Record<ObservabilitySpanKind, string> = {
  stage: '阶段',
  model: '模型',
  tool: '工具',
  skill: 'Skill',
  harness: 'Harness',
}

export const observabilityRuns: ObservabilityRun[] = [
  {
    id: 'run-chat-031', traceId: '4f8a2c19d36e45f3a76b2819c0158e71', kind: 'chat', name: '员工报销政策咨询',
    target: '员工服务助手', secondaryTarget: '企业制度知识库', status: 'succeeded', startedAt: '2026-10-31 17:32:18',
    durationMs: 2840, progress: 100, provider: '通义百炼', model: 'qwen-plus',
    usage: { input: 1860, output: 386, total: 2246, source: 'provider' }, estimatedCost: 0.0286, costCoverage: 100,
    query: '差旅报销需要哪些材料？', answer: '差旅报销需要填写报销单，并附行程单、交通票据和住宿发票。[1] 单笔超过 5,000 元还需补充事前审批记录。[2]',
  },
  {
    id: 'run-build-017', traceId: 'b1f48cd27a384f48bca86db27f430a12', kind: 'build', name: '产品手册索引重建',
    target: '产品与技术文档', secondaryTarget: 'index-v12 · 智能客服手册.pdf', status: 'failed', startedAt: '2026-10-31 17:28:04',
    durationMs: 48210, progress: 64, provider: 'AIHubmix', model: 'text-embedding-3-large',
    usage: { input: 128400, output: null, total: 128400, source: 'provider' }, estimatedCost: null, costCoverage: 0,
    errorCode: 'UPSTREAM_RATE_LIMIT',
  },
  {
    id: 'run-chat-030', traceId: '73ad493f0d2749bf9f6c184fb11e2a90', kind: 'chat', name: '售后保修范围咨询',
    target: '客户支持助手', secondaryTarget: '售后服务知识库', status: 'failed', startedAt: '2026-10-31 17:21:43',
    durationMs: 6010, progress: 100, provider: 'OpenRouter', model: 'openai/gpt-4.1-mini',
    usage: { input: null, output: null, total: null, source: 'unavailable' }, estimatedCost: null, costCoverage: 0,
    errorCode: 'LLM_TIMEOUT', query: '设备进水是否在保修范围内？', answer: '',
  },
  {
    id: 'run-build-016', traceId: 'd4ce6dbb0f674fd599f73f426e31a820', kind: 'build', name: '采购制度增量索引',
    target: '采购与供应链', secondaryTarget: 'index-v8 · 采购管理办法.md', status: 'running', startedAt: '2026-10-31 17:35:11',
    durationMs: 32800, progress: 68, provider: '通义百炼', model: 'text-embedding-v4',
    usage: { input: 48200, output: null, total: 48200, source: 'provider' }, estimatedCost: 0.0096, costCoverage: 100,
  },
  {
    id: 'run-chat-029', traceId: 'c24b78fb6c254260b4f6f31d712af912', kind: 'chat', name: '入职材料咨询',
    target: '员工服务助手', secondaryTarget: '企业制度知识库', status: 'stopped', startedAt: '2026-10-31 17:16:27',
    durationMs: 1420, progress: 100, provider: '通义百炼', model: 'qwen-plus',
    usage: { input: 932, output: 114, total: 1046, source: 'provider' }, estimatedCost: 0.0121, costCoverage: 100,
    query: '新员工入职需要准备什么？', answer: '根据入职指引，需要先准备身份证明材料和',
  },
  {
    id: 'run-build-015', traceId: 'aa85db8e19c442b5b3f8ea1c3059f2d4', kind: 'build', name: '制度文件 OCR 与索引',
    target: '企业制度知识库', secondaryTarget: 'index-v21 · 费用管理制度扫描件.pdf', status: 'succeeded', startedAt: '2026-10-31 17:08:52',
    durationMs: 76430, progress: 100, provider: '通义百炼', model: 'qwen-vl-ocr + text-embedding-v4',
    usage: { input: 860, output: 172, total: 1032, source: 'provider' }, estimatedCost: 0.0842, costCoverage: 86,
  },
]

const usage = (input: number | null, output: number | null): TokenUsage => ({
  input,
  output,
  total: input === null && output === null ? null : (input || 0) + (output || 0),
  source: input === null && output === null ? 'unavailable' : 'provider',
})

export const observabilitySpans: ObservabilitySpan[] = [
  { id: 'sp-031-root', runId: 'run-chat-031', parentId: null, name: 'Chat Run', kind: 'stage', status: 'succeeded', offsetMs: 0, durationMs: 2840, input: '差旅报销需要哪些材料？', output: '回答成功，生成 2 条引用。', summary: '端到端检索增强问答', usage: usage(1860, 386), estimatedCost: 0.0286, metadata: { assistant: '员工服务助手', knowledge_bases: 1, history_messages: 4 } },
  { id: 'sp-031-config', runId: 'run-chat-031', parentId: 'sp-031-root', name: 'LoadConfig', kind: 'stage', status: 'succeeded', offsetMs: 0, durationMs: 42, input: 'assistant_id=assistant-hr', output: 'Top K=5 · candidate K=20 · threshold=0.35', summary: '加载已发布应用与活动索引配置', metadata: { index_version: 'index-v21', rerank: true } },
  { id: 'sp-031-retrieval', runId: 'run-chat-031', parentId: 'sp-031-root', name: 'Retrieval · 企业制度知识库', kind: 'stage', status: 'succeeded', offsetMs: 42, durationMs: 786, input: '差旅报销需要哪些材料？', output: '召回 20 个候选，重排后保留 5 个。', summary: '向量召回与 Rerank', metadata: { candidates: 20, top_k: 5, threshold: 0.35 } },
  { id: 'sp-031-embed', runId: 'run-chat-031', parentId: 'sp-031-retrieval', name: 'QueryEmbedding', kind: 'model', status: 'succeeded', offsetMs: 42, durationMs: 214, provider: '通义百炼', model: 'text-embedding-v4', input: '差旅报销需要哪些材料？', output: 'vector[1024] · 内容已省略', summary: '查询向量生成', usage: usage(18, null), estimatedCost: 0.0001, metadata: { dimensions: 1024, request_id: 'req_embed_7f21' } },
  { id: 'sp-031-vector', runId: 'run-chat-031', parentId: 'sp-031-retrieval', name: 'VectorSearch', kind: 'stage', status: 'succeeded', offsetMs: 256, durationMs: 96, input: 'cosine_distance · candidate_k=20', output: '20 个候选 · 最高向量评分 0.8912', summary: 'pgvector 活动版本召回', metadata: { index_version: 'index-v21', scanned_snapshots: 18432 } },
  { id: 'sp-031-rerank', runId: 'run-chat-031', parentId: 'sp-031-retrieval', name: 'Rerank', kind: 'model', status: 'succeeded', offsetMs: 352, durationMs: 476, provider: '通义百炼', model: 'gte-rerank-v2', input: 'query + 20 个候选分块', output: 'Top 5 · 最高重排评分 0.9438', summary: '候选池内独立重排', usage: usage(null, null), estimatedCost: null, metadata: { candidates: 20, top_n: 5, usage_note: '服务商未返回 Token' } },
  { id: 'sp-031-context', runId: 'run-chat-031', parentId: 'sp-031-root', name: 'BuildContext', kind: 'stage', status: 'succeeded', offsetMs: 828, durationMs: 35, input: '5 个重排分块 + 4 条历史消息', output: '7 条模型消息 · 引用编号 [1]–[5]', summary: '构造最终模型上下文', metadata: { context_hash: 'sha256:98f2…a71c', truncated: true, excluded_messages: 2 } },
  { id: 'sp-031-llm', runId: 'run-chat-031', parentId: 'sp-031-root', name: 'LLM · stream_chat', kind: 'model', status: 'succeeded', offsetMs: 863, durationMs: 1921, provider: '通义百炼', model: 'qwen-plus', input: 'System + 4 条历史 + 5 个知识片段 + 当前问题', output: '差旅报销需要填写报销单，并附行程单、交通票据和住宿发票。[1]…', summary: 'LangChain ChatOpenAI 流式生成', usage: usage(1842, 386), estimatedCost: 0.0285, metadata: { first_token_ms: 612, stream_chunks: 38, finish_reason: 'stop', request_id: 'req_chat_c913' } },
  { id: 'sp-031-persist', runId: 'run-chat-031', parentId: 'sp-031-root', name: 'PersistResult', kind: 'stage', status: 'succeeded', offsetMs: 2784, durationMs: 56, input: '回答、2 条引用、服务商 usage', output: 'QueryRun 与消息已提交', summary: '持久化问答结果与不可变引用', metadata: { citations: 2, usage_source: 'provider' } },

  { id: 'sp-017-root', runId: 'run-build-017', parentId: null, name: 'KnowledgeBuild Run', kind: 'stage', status: 'failed', offsetMs: 0, durationMs: 48210, input: 'index-v12 · 1,284 个分块', output: '批次 26 失败，旧活动版本保持不变。', summary: '产品手册索引重建', usage: usage(128400, null), estimatedCost: null, errorCode: 'UPSTREAM_RATE_LIMIT', metadata: { knowledge_base: '产品与技术文档', total_chunks: 1284, embedded_chunks: 800 } },
  { id: 'sp-017-validate', runId: 'run-build-017', parentId: 'sp-017-root', name: 'ValidateSource', kind: 'stage', status: 'succeeded', offsetMs: 0, durationMs: 183, input: 'source_hash=sha256:42c9…e18a', output: '1,284 个分块哈希一致', summary: '源分块与参数校验', metadata: { dimensions: 3072, batch_size: 32 } },
  { id: 'sp-017-embedding', runId: 'run-build-017', parentId: 'sp-017-root', name: 'Embedding Stage', kind: 'stage', status: 'failed', offsetMs: 183, durationMs: 47760, input: '41 个 Embedding 批次', output: '25 批成功，批次 26 重试耗尽', summary: '分批生成向量快照', usage: usage(128400, null), estimatedCost: null, errorCode: 'UPSTREAM_RATE_LIMIT', metadata: { completed_batches: 25, total_batches: 41 } },
  { id: 'sp-017-batch', runId: 'run-build-017', parentId: 'sp-017-embedding', name: 'Embedding · batch 26', kind: 'model', status: 'failed', offsetMs: 44120, durationMs: 3823, provider: 'AIHubmix', model: 'text-embedding-3-large', input: '32 个分块 · 18,942 字符 · 内容已脱敏', output: 'HTTP 429 · 请求已脱敏', summary: '第 3 次尝试触发服务商限流', usage: usage(null, null), estimatedCost: null, attempt: 3, errorCode: 'UPSTREAM_RATE_LIMIT', metadata: { retry_after_ms: 2000, chunk_range: '801–832', provider_request_id: null } },
  { id: 'sp-017-preserve', runId: 'run-build-017', parentId: 'sp-017-root', name: 'PreserveActiveIndex', kind: 'harness', status: 'succeeded', offsetMs: 47943, durationMs: 267, input: 'index-v12 failed', output: '继续服务 index-v11', summary: '失败版本未替换旧活动索引', metadata: { active_index: 'index-v11', failed_index: 'index-v12' } },

  { id: 'sp-030-root', runId: 'run-chat-030', parentId: null, name: 'Chat Run', kind: 'stage', status: 'failed', offsetMs: 0, durationMs: 6010, input: '设备进水是否在保修范围内？', output: '模型请求超时，未生成回答。', summary: '售后问答失败', usage: usage(null, null), estimatedCost: null, errorCode: 'LLM_TIMEOUT', metadata: { assistant: '客户支持助手' } },
  { id: 'sp-030-retrieval', runId: 'run-chat-030', parentId: 'sp-030-root', name: 'Retrieval + BuildContext', kind: 'stage', status: 'succeeded', offsetMs: 0, durationMs: 902, input: '保修范围问题', output: '3 条引用 · 7 条模型消息', summary: '检索和上下文已完成', metadata: { candidates: 20, citations: 3, context_hash: 'sha256:714a…cb20' } },
  { id: 'sp-030-llm', runId: 'run-chat-030', parentId: 'sp-030-root', name: 'LLM · stream_chat', kind: 'model', status: 'timed_out', offsetMs: 902, durationMs: 5000, provider: 'OpenRouter', model: 'openai/gpt-4.1-mini', input: 'System + 历史 + 3 个知识片段', output: '连接读取超时 · 无可用增量', summary: '模型网关达到读取超时', usage: usage(null, null), estimatedCost: null, errorCode: 'LLM_TIMEOUT', metadata: { timeout_ms: 5000, retry: 0 } },
  { id: 'sp-030-sse', runId: 'run-chat-030', parentId: 'sp-030-root', name: 'SSE ErrorEvent', kind: 'harness', status: 'failed', offsetMs: 5902, durationMs: 108, input: 'LLM_TIMEOUT', output: '向客户端发送脱敏 error 事件', summary: '错误事件发送并闭合 Trace', errorCode: 'LLM_TIMEOUT', metadata: { public_message: '模型响应超时，请稍后重试' } },

  { id: 'sp-016-root', runId: 'run-build-016', parentId: null, name: 'KnowledgeBuild Run', kind: 'stage', status: 'running', offsetMs: 0, durationMs: 32800, input: 'index-v8 · 640 个分块', output: '已完成 14／20 个批次', summary: '增量索引正在构建', usage: usage(48200, null), estimatedCost: 0.0096, metadata: { progress: 68, heartbeat_age_ms: 820 } },
  { id: 'sp-016-embedding', runId: 'run-build-016', parentId: 'sp-016-root', name: 'Embedding Stage', kind: 'stage', status: 'running', offsetMs: 160, durationMs: 31800, input: '20 个 Embedding 批次', output: '14 批成功 · 当前批次 15', summary: '分批生成向量', usage: usage(48200, null), estimatedCost: 0.0096, metadata: { completed_batches: 14, total_batches: 20 } },
  { id: 'sp-016-batch', runId: 'run-build-016', parentId: 'sp-016-embedding', name: 'Embedding · batch 15', kind: 'model', status: 'running', offsetMs: 31000, durationMs: 1800, provider: '通义百炼', model: 'text-embedding-v4', input: '32 个分块 · 内容已脱敏', output: '等待服务商响应', summary: '当前模型请求', metadata: { attempt: 1, chunk_range: '449–480' } },

  { id: 'sp-029-root', runId: 'run-chat-029', parentId: null, name: 'Chat Run', kind: 'stage', status: 'stopped', offsetMs: 0, durationMs: 1420, input: '新员工入职需要准备什么？', output: '用户主动停止，保留已生成增量。', summary: '问答被用户停止', usage: usage(932, 114), estimatedCost: 0.0121, metadata: { stop_reason: 'client_abort' } },
  { id: 'sp-029-retrieval', runId: 'run-chat-029', parentId: 'sp-029-root', name: 'Retrieval + BuildContext', kind: 'stage', status: 'succeeded', offsetMs: 0, durationMs: 602, input: '入职材料问题', output: '2 个知识片段', summary: '检索与上下文完成', metadata: { citations: 2 } },
  { id: 'sp-029-llm', runId: 'run-chat-029', parentId: 'sp-029-root', name: 'LLM · stream_chat', kind: 'model', status: 'stopped', offsetMs: 602, durationMs: 818, provider: '通义百炼', model: 'qwen-plus', input: 'System + 历史 + 2 个知识片段', output: '根据入职指引，需要先准备身份证明材料和', summary: '客户端 AbortController 取消流式请求', usage: usage(932, 114), estimatedCost: 0.0121, errorCode: 'CHAT_STOPPED', metadata: { first_token_ms: 488, stream_chunks: 12 } },

  { id: 'sp-015-root', runId: 'run-build-015', parentId: null, name: 'KnowledgeBuild Run', kind: 'stage', status: 'succeeded', offsetMs: 0, durationMs: 76430, input: '费用管理制度扫描件.pdf · 48 页', output: 'index-v21 已激活 · 386 个分块', summary: 'OCR、分块和索引全部完成', usage: usage(860, 172), estimatedCost: 0.0842, metadata: { pages: 48, chunks: 386, index_version: 'index-v21' } },
  { id: 'sp-015-parse', runId: 'run-build-015', parentId: 'sp-015-root', name: 'ParseDocument', kind: 'skill', status: 'succeeded', offsetMs: 0, durationMs: 42600, input: 'document_id=doc-expense-scan · parser=v3', output: '48 页 · 212 个内容块', summary: '文档解析 Skill · 原型夹具', metadata: { skill_version: 'document-parse/v3', exit_reason: 'completed' } },
  { id: 'sp-015-layout', runId: 'run-build-015', parentId: 'sp-015-parse', name: 'document-layout', kind: 'tool', status: 'succeeded', offsetMs: 120, durationMs: 8400, input: '{ "pages": 48, "detect_tables": true }', output: '{ "text_blocks": 164, "table_blocks": 18, "image_pages": 30 }', summary: '版式检测工具 · 原型夹具', metadata: { tool_version: '2.4.1', attempt: 1 } },
  { id: 'sp-015-ocr', runId: 'run-build-015', parentId: 'sp-015-parse', name: 'CloudOCR · 30 pages', kind: 'model', status: 'succeeded', offsetMs: 8520, durationMs: 34080, provider: '通义百炼', model: 'qwen-vl-ocr', input: '30 张页面资产 · Base64 未采集', output: '识别文本与区域坐标 · 内容已脱敏', summary: '云端 OCR 模型调用', usage: usage(860, 172), estimatedCost: 0.0732, metadata: { pages: 30, image_assets: 30, request_count: 30 } },
  { id: 'sp-015-chunk', runId: 'run-build-015', parentId: 'sp-015-root', name: 'MarkdownHeaderTextSplitter', kind: 'skill', status: 'succeeded', offsetMs: 42600, durationMs: 940, input: '212 个内容块 · chunk_size=800 · overlap=120', output: '386 个持久化分块', summary: 'LangChain 结构化分块 Skill · 原型夹具', metadata: { skill_version: 'langchain-splitter/v1', content_hash: 'sha256:8e30…cc19' } },
  { id: 'sp-015-embedding', runId: 'run-build-015', parentId: 'sp-015-root', name: 'Embedding · 13 batches', kind: 'model', status: 'succeeded', offsetMs: 43540, durationMs: 31800, provider: '通义百炼', model: 'text-embedding-v4', input: '386 个分块 · 13 个批次', output: '386 个 1024 维向量', summary: 'Embedding 批次汇总', usage: usage(null, null), estimatedCost: null, metadata: { batches: 13, dimensions: 1024, usage_note: '批次用量未完整返回' } },
  { id: 'sp-015-activate', runId: 'run-build-015', parentId: 'sp-015-root', name: 'ActivateIndex', kind: 'stage', status: 'succeeded', offsetMs: 75340, durationMs: 1090, input: 'index-v21 · 386 向量校验通过', output: 'active_index_version=index-v21', summary: '事务内切换活动索引', metadata: { previous_index: 'index-v20', active_index: 'index-v21' } },
]

export const observabilityErrors: ObservabilityError[] = [
  { id: 'err-001', runId: 'run-build-017', spanId: 'sp-017-batch', category: '模型调用', severity: 'error', code: 'UPSTREAM_RATE_LIMIT', message: 'Embedding 服务商返回限流，第 3 次尝试后停止。', fingerprint: 'embedding/aihubmix/429', count: 14, firstOccurredAt: '2026-10-31 15:02:11', lastOccurredAt: '2026-10-31 17:28:48', retryable: true },
  { id: 'err-002', runId: 'run-chat-030', spanId: 'sp-030-llm', category: '模型调用', severity: 'error', code: 'LLM_TIMEOUT', message: 'LLM 读取超过 5 秒，未收到可用增量。', fingerprint: 'chat/openrouter/read-timeout', count: 6, firstOccurredAt: '2026-10-31 16:40:08', lastOccurredAt: '2026-10-31 17:21:49', retryable: true },
  { id: 'err-003', runId: 'run-chat-030', spanId: 'sp-030-sse', category: 'Harness', severity: 'warning', code: 'SSE_CLIENT_DISCONNECTED', message: '服务端发送错误事件前检测到客户端连接关闭。', fingerprint: 'sse/client-disconnected', count: 3, firstOccurredAt: '2026-10-31 16:58:21', lastOccurredAt: '2026-10-31 17:21:50', retryable: false },
  { id: 'err-004', runId: 'run-build-016', spanId: 'sp-016-root', category: 'Harness', severity: 'critical', code: 'WORKER_HEARTBEAT_DELAYED', message: 'Worker 心跳曾延迟 12 秒，当前已恢复；样例用于展示系统事件。', fingerprint: 'worker/heartbeat-delayed', count: 1, firstOccurredAt: '2026-10-31 17:34:58', lastOccurredAt: '2026-10-31 17:34:58', retryable: true },
  { id: 'err-005', runId: 'run-build-015', spanId: 'sp-015-embedding', category: '可观测自身', severity: 'warning', code: 'USAGE_UNAVAILABLE', message: '部分 Embedding 批次未返回 Token，对应成本标记为未知。', fingerprint: 'usage/embedding/unavailable', count: 9, firstOccurredAt: '2026-10-31 17:09:44', lastOccurredAt: '2026-10-31 17:09:58', retryable: false },
  { id: 'err-006', runId: 'run-chat-031', spanId: 'sp-031-context', category: '上下文', severity: 'warning', code: 'CONTEXT_HISTORY_TRUNCATED', message: '按上下文预算排除 2 条最早历史消息，保留完整当前问题。', fingerprint: 'context/history-truncated', count: 4, firstOccurredAt: '2026-10-31 16:22:14', lastOccurredAt: '2026-10-31 17:32:19', retryable: false },
]

export const initialPriceRules: PriceRule[] = [
  { id: 'price-001', provider: '通义百炼', model: 'qwen-plus', capability: 'LLM', currency: 'CNY', inputPrice: 0.8, outputPrice: 2, requestPrice: 0, effectiveFrom: '2026-10-01', sourceNote: '原型价格，仅演示成本计算' },
  { id: 'price-002', provider: '通义百炼', model: 'text-embedding-v4', capability: 'Embedding', currency: 'CNY', inputPrice: 0.2, outputPrice: 0, requestPrice: 0, effectiveFrom: '2026-10-01', sourceNote: '原型价格，仅演示成本计算' },
  { id: 'price-003', provider: '通义百炼', model: 'qwen-vl-ocr', capability: 'OCR', currency: 'CNY', inputPrice: 3, outputPrice: 9, requestPrice: 0, effectiveFrom: '2026-10-01', sourceNote: '原型价格，仅演示成本计算' },
  { id: 'price-004', provider: 'OpenRouter', model: 'openai/gpt-4.1-mini', capability: 'LLM', currency: 'USD', inputPrice: 0.4, outputPrice: 1.6, requestPrice: 0, effectiveFrom: '2026-10-15', sourceNote: '原型价格，不代表服务商账单' },
]

export const trendData = [
  { day: '10/25', runs: 86, failed: 5, tokens: 248 },
  { day: '10/26', runs: 112, failed: 8, tokens: 326 },
  { day: '10/27', runs: 104, failed: 4, tokens: 301 },
  { day: '10/28', runs: 138, failed: 12, tokens: 410 },
  { day: '10/29', runs: 126, failed: 7, tokens: 386 },
  { day: '10/30', runs: 152, failed: 9, tokens: 452 },
  { day: '10/31', runs: 164, failed: 11, tokens: 498 },
]

export function formatTokens(value: number | null): string {
  return value === null ? '未提供' : value.toLocaleString('zh-CN')
}

export function formatDuration(milliseconds: number): string {
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(2)} 秒` : `${milliseconds} ms`
}

export function sumKnownTokens(runs: ObservabilityRun[]): number {
  return runs.reduce((sum, run) => sum + (run.usage.total || 0), 0)
}

export function successRate(runs: ObservabilityRun[]): number {
  const finished = runs.filter((run) => !['queued', 'running'].includes(run.status))
  return finished.length ? Math.round((finished.filter((run) => run.status === 'succeeded').length / finished.length) * 1000) / 10 : 0
}

export function filterRuns(
  runs: ObservabilityRun[],
  filters: { search?: string; kind?: string; status?: string; provider?: string },
): ObservabilityRun[] {
  const keyword = (filters.search || '').trim().toLowerCase()
  return runs.filter((run) =>
    (!keyword || [run.id, run.name, run.target, run.secondaryTarget, run.query || ''].some((value) => value.toLowerCase().includes(keyword))) &&
    (!filters.kind || filters.kind === 'all' || run.kind === filters.kind) &&
    (!filters.status || filters.status === 'all' || run.status === filters.status) &&
    (!filters.provider || filters.provider === 'all' || run.provider === filters.provider),
  )
}
