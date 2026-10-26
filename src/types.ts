export type Role = 'admin' | 'manager' | 'user'

export type KnowledgeStatus = 'ready' | 'indexing' | 'failed'

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  status: KnowledgeStatus
  documents: number
  chunks: number
  updatedAt: string
  embeddingModel: string
  accent: string
}

export interface DocumentRecord {
  id: string
  name: string
  type: 'pdf' | 'docx' | 'xlsx' | 'md' | 'image'
  status: KnowledgeStatus
  chunks: number
  size: string
  updatedAt: string
  parser: string
}

export interface ProviderRecord {
  id: string
  name: string
  protocol: string
  endpoint: string
  keyMask: string
  status: 'connected' | 'warning' | 'disabled'
  models: number
  latency: number | null
}

export interface ModelRecord {
  id: string
  name: string
  provider: string
  type: 'LLM' | 'Embedding' | 'Rerank'
  dimension?: number
  enabled: boolean
  isDefault?: boolean
}

export interface RunLog {
  id: string
  query: string
  answer: string
  knowledgeBase: string
  model: string
  role: string
  tokens: number
  promptTokens: number
  completionTokens: number
  duration: number
  firstToken: number
  status: 'success' | 'failed'
  createdAt: string
  citations: number
}
