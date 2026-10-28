export type FileKind = 'PDF' | 'Word' | 'Markdown' | '图片' | '表格'
export type BuildState = 'ready' | 'processing' | 'failed'
export interface HubKnowledge {
  id: string; name: string; description: string; department: string; color: string;
  published: boolean; managed: boolean; embedding: string; rerank: string; updated: string;
  chunkSize?: number; overlap?: number; strategy?: string
}
export interface HubDocument {
  id: string; kbId: string; name: string; kind: FileKind; size: string;
  state: BuildState; chunks: number; progress: number; parser: string; updated: string
}
export interface HubTask { id: string; kbId: string; fileIds: string[]; state: BuildState; progress: number; created: string; error?: string }
export interface HubModel { id: string; name: string; provider: string; type: 'LLM' | 'Embedding' | 'Rerank'; enabled: boolean; dimension?: number; providerId?: string }
export interface HubProvider { id: string; name: string; url: string; configured: boolean; latency: number; kind?: 'tongyi' | 'openrouter' | 'aihubmix'; enabled?: boolean }
export interface HubLog { id: string; kbId: string; kbIds?: string[]; query: string; answer: string; model: string; input: number; output: number; duration: number; time: string; citations: number; role: string }
export interface HubChunk { id: string; documentId: string; kbId: string; title: string; text: string; page: number; indexed: boolean }
export interface HubAssistant { id: string; name: string; description: string; kbIds: string[]; model: string; prompt: string; topK: number; threshold: number; rerank: boolean; published: boolean; managed: boolean }
export interface HubChatMessage { id: string; role: 'user' | 'assistant'; text: string; citationIds: string[]; tokens?: number; duration?: number }
export interface HubSession { id: string; assistantId: string; title: string; messages: HubChatMessage[] }
export interface HubState { version: 3; knowledge: HubKnowledge[]; documents: HubDocument[]; tasks: HubTask[]; models: HubModel[]; providers: HubProvider[]; logs: HubLog[]; edits: Record<string, string>; chunks: HubChunk[]; assistants: HubAssistant[]; sessions: HubSession[] }
export const STORE_KEY = 'knowledge-hub-workspace-v3'
export const timestamp = () => new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
export const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
export const seed: HubState = {
  version: 3,
  knowledge: [
    { id: 'cuisine', name: '特色菜知识库', description: '云南传统名菜、福建饮食文化与地方菜品资料，演示 PDF、Word 解析和分块管理。', department: '示例资料', color: 'blue', published: true, managed: true, embedding: 'text-embedding-v4', rerank: 'qwen3-rerank', updated: '今天 11:20', chunkSize: 800, overlap: 120, strategy: 'structure' },
    { id: 'company-policy', name: '企业制度与员工服务', description: '统一管理人事、行政、财务制度，让每一位员工都能快速找到准确答案。', department: '人力行政', color: 'blue', published: true, managed: true, embedding: 'text-embedding-v4', rerank: 'qwen3-rerank', updated: '今天 10:42' },
    { id: 'product-manual', name: '产品与技术文档', description: '产品使用手册、API 文档、技术方案与交付标准，沉淀团队的专业知识。', department: '产品研发', color: 'purple', published: true, managed: true, embedding: 'text-embedding-v4', rerank: 'qwen3-rerank', updated: '今天 09:30' },
    { id: 'customer-service', name: '客户服务与支持', description: '汇集售前常见问题、售后处理流程和故障排查经验。', department: '客户服务', color: 'orange', published: true, managed: false, embedding: 'qwen3-embedding', rerank: 'qwen3-rerank', updated: '昨天 17:26' },
    { id: 'legal-contract', name: '合同与合规资料', description: '标准合同模板、合规审查指引及法务规范，为业务决策提供依据。', department: '法务合规', color: 'cyan', published: false, managed: false, embedding: 'text-embedding-v4', rerank: 'qwen3-rerank', updated: '昨天 15:18' },
    { id: 'project-delivery', name: '项目交付经验库', description: '项目复盘、实施案例与交付方法，将个人经验转化为组织能力。', department: '项目交付', color: 'green', published: false, managed: true, embedding: 'text-embedding-v4', rerank: 'qwen3-rerank', updated: '10 月 24 日' },
  ],
  documents: [
    { id: 'food-pdf', kbId: 'cuisine', name: '云南传统名菜百科.pdf', kind: 'PDF', size: '2.4 MB', state: 'ready', chunks: 5, progress: 100, parser: '智能解析 · 云端 OCR', updated: '今天 11:20' },
    { id: 'food-word', kbId: 'cuisine', name: '福建饮食文化志.docx', kind: 'Word', size: '860 KB', state: 'ready', chunks: 2, progress: 100, parser: '文档结构解析', updated: '今天 11:18' },
    { id: 'd1', kbId: 'company-policy', name: '员工手册（2026 年修订版）.pdf', kind: 'PDF', size: '4.8 MB', state: 'ready', chunks: 186, progress: 100, parser: '智能解析 · 云端 OCR', updated: '今天 10:42' },
    { id: 'd2', kbId: 'company-policy', name: '差旅与费用报销管理办法.docx', kind: 'Word', size: '1.2 MB', state: 'ready', chunks: 64, progress: 100, parser: '文档结构解析', updated: '今天 10:24' },
    { id: 'd3', kbId: 'company-policy', name: '各城市差旅费用标准.xlsx', kind: '表格', size: '268 KB', state: 'ready', chunks: 32, progress: 100, parser: '表格结构解析', updated: '昨天 17:02' },
    { id: 'd4', kbId: 'company-policy', name: '新员工入职指引.md', kind: 'Markdown', size: '42 KB', state: 'ready', chunks: 18, progress: 100, parser: 'Markdown 解析', updated: '昨天 15:38' },
    { id: 'd5', kbId: 'company-policy', name: '采购审批流程图.png', kind: '图片', size: '1.6 MB', state: 'failed', chunks: 0, progress: 22, parser: '云端 OCR', updated: '昨天 14:26' },
    { id: 'p1', kbId: 'product-manual', name: '产品使用与接口手册.pdf', kind: 'PDF', size: '8.2 MB', state: 'ready', chunks: 326, progress: 100, parser: '智能解析', updated: '今天 09:30' },
    { id: 'c1', kbId: 'customer-service', name: '客户服务常见问题.md', kind: 'Markdown', size: '86 KB', state: 'ready', chunks: 92, progress: 100, parser: 'Markdown 解析', updated: '昨天 17:26' },
    { id: 'l1', kbId: 'legal-contract', name: '采购合同审查指引.docx', kind: 'Word', size: '2.1 MB', state: 'ready', chunks: 76, progress: 100, parser: '文档结构解析', updated: '昨天 15:18' },
  ],
  tasks: [{ id: 'TASK-1026-003', kbId: 'company-policy', fileIds: ['d5'], state: 'failed', progress: 22, created: '2026/10/26 10:20:06', error: '云端 OCR 请求超时，可重试此文件。' }],
  models: [
    { id: 'llm1', name: 'qwen-plus', provider: '通义百炼', type: 'LLM', enabled: true },
    { id: 'llm2', name: 'deepseek/deepseek-chat', provider: 'OpenRouter', type: 'LLM', enabled: true },
    { id: 'llm3', name: 'gemini-flash', provider: 'AIHubmix', type: 'LLM', enabled: false },
    { id: 'embed1', name: 'text-embedding-v4', provider: '通义百炼', type: 'Embedding', enabled: true, dimension: 1024 },
    { id: 'embed2', name: 'qwen3-embedding', provider: 'OpenRouter', type: 'Embedding', enabled: true, dimension: 1024 },
    { id: 'rank1', name: 'qwen3-rerank', provider: '通义百炼', type: 'Rerank', enabled: true },
  ],
  providers: [
    { id: 'tongyi', name: '通义百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', configured: true, latency: 218 },
    { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', configured: true, latency: 642 },
    { id: 'aihubmix', name: 'AIHubmix', url: 'https://aihubmix.com/v1', configured: false, latency: 0 },
  ],
  logs: [
    { id: 'req_8F2JQ7', kbId: 'company-policy', query: '出差到上海，住宿报销标准是多少？', answer: '根据差旅费用标准，一线城市住宿报销上限为 600 元/晚。', model: 'qwen-plus', input: 1508, output: 338, duration: 2.84, time: '2026/10/26 10:42:18', citations: 2, role: '使用者' },
    { id: 'req_5AW1D9', kbId: 'product-manual', query: 'API 限流后如何重试？', answer: '请采用指数退避方式重试，并检查渠道速率配额。', model: 'qwen-plus', input: 1896, output: 318, duration: 3.46, time: '2026/10/26 10:35:04', citations: 1, role: '使用者' },
  ],
  edits: {},
  chunks: [],
  assistants: [
    { id: 'food-assistant', name: '地方饮食知识助手', description: '查询地方名菜、食材与饮食文化，回答附原文依据。', kbIds: ['cuisine'], model: 'qwen-plus', prompt: '你是地方饮食知识助手。请仅依据提供的资料回答，资料不足时明确说明，并标注来源。', topK: 5, threshold: 0.35, rerank: true, published: true, managed: true },
    { id: 'employee-assistant', name: '员工服务助手', description: '解答差旅报销、休假制度与日常行政问题。', kbIds: ['company-policy'], model: 'qwen-plus', prompt: '你是企业员工服务助手。仅根据企业制度回答，清楚说明申请流程，并提供引用。', topK: 5, threshold: 0.35, rerank: true, published: true, managed: true },
    { id: 'product-assistant', name: '产品支持助手', description: '面向交付人员，检索产品说明和接口使用规范。', kbIds: ['product-manual'], model: 'qwen-plus', prompt: '你是产品支持助手，请依据产品文档回答。', topK: 5, threshold: 0.35, rerank: true, published: false, managed: true },
  ],
  sessions: [],
}

const foodTexts = [
  ['云南传统名菜百科 · 滇菜卷', '云南传统名菜百科（节选 · 滇菜卷）\n内部资料，仅供参考。\n本资料收录云南地方代表性名菜，按照菜品概述、食材与做法、历史渊源三个层次编排。'],
  ['过桥米线', '过桥米线是云南具有代表性的传统名食，以滚烫鸡汤、生鲜配料与米线分装上桌。食客将肉片、蔬菜等配料依次放入热汤中烫熟，再加入米线食用。主要食材包括鸡汤、猪里脊、鸡肉片、豆腐皮、韭菜和米线。相传其名称与蒙自南湖书生读书、妻子送餐的故事有关。'],
  ['汽锅鸡', '汽锅鸡是云南传统名菜，使用建水紫陶汽锅烹制。将鸡块、姜片等放入汽锅，依靠中心汽嘴进入的蒸汽冷凝成汤，保持鸡肉鲜味。常见配料包括三七、天麻或虫草，具体做法随地区而异。'],
  ['宜良烤鸭', '宜良烤鸭是云南宜良地区的传统菜品，以皮酥、肉嫩著称。制作时使用香料腌制鸭身，晾干表皮后入炉烤制，通常配葱段、酱料食用。'],
  ['大理砂锅鱼', '大理砂锅鱼是白族地方风味菜，以洱海鲜鱼为主要原料，配豆腐、火腿、菌菇和蔬菜，用砂锅炖煮，重在汤鲜味浓。'],
  ['福建饮食文化 · 概述', '福建饮食文化以闽菜为代表，注重鲜味、汤品及食材本味。福州、闽南和闽西等地区各有风格，海产、山珍和红糟常用于地方菜肴。'],
  ['佛跳墙', '佛跳墙是福州传统名菜，常见食材包括海参、鲍鱼、干贝、花菇与禽肉。多种食材分别处理后放入坛中，以高汤和绍兴酒慢煨，形成醇厚汤味。'],
]
seed.chunks = [
  ...foodTexts.map(([title, text], index) => ({ id: `food-chunk-${index + 1}`, documentId: index < 5 ? 'food-pdf' : 'food-word', kbId: 'cuisine', title, text, page: index < 5 ? index + 1 : index - 4, indexed: true })),
  ...['d1', 'd2', 'd3', 'd4', 'p1', 'c1', 'l1'].flatMap((documentId) => {
    const doc = seed.documents.find((item) => item.id === documentId)!
    const texts = documentId === 'p1' ? ['API 请求超过频率限制时返回 429。建议使用指数退避方式重试，并检查模型渠道速率配额。', '接口调用应携带有效访问令牌。请求失败后可通过请求 ID 在日志中排查。'] : documentId === 'c1' ? ['客户报修后应先记录故障现象、产品版本与联系方式，并在服务系统创建工单。'] : documentId === 'l1' ? ['采购合同应使用现行模板，涉及责任限制、数据处理与知识产权条款时需法务审核。'] : makeChunkTexts()
    return texts.map((text, i) => ({ id: `${documentId}-chunk-${i}`, documentId, kbId: doc.kbId, title: doc.name.replace(/\.[^.]+$/, '') + ` · 第 ${i + 1} 节`, text, page: i + 1, indexed: true }))
  }),
]
seed.documents = seed.documents.map((doc) => ({ ...doc, chunks: seed.chunks.filter((c) => c.documentId === doc.id).length }))

export function readWorkspace(): HubState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
    if (parsed?.version === 3 && ['knowledge', 'documents', 'tasks', 'models', 'providers', 'logs', 'chunks', 'assistants', 'sessions'].every((key) => Array.isArray(parsed[key]))) return parsed
  } catch { /* A fresh workspace remains usable if browser storage is blocked. */ }
  return structuredClone(seed)
}

export function detectKind(name: string): FileKind | null {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return 'PDF'
  if (extension === 'docx' || extension === 'doc') return 'Word'
  if (extension === 'md') return 'Markdown'
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension || '')) return '图片'
  if (['xls', 'xlsx', 'csv'].includes(extension || '')) return '表格'
  return null
}

export function validateFiles(files: { name: string; size: number }[], currentNames: string[] = []) {
  const names = new Set(currentNames)
  return files.map((file, index) => {
    let error = ''
    if (!detectKind(file.name)) error = '不支持此文件格式'
    else if (file.size <= 0) error = '文件内容为空'
    else if (file.size > 50 * 1024 * 1024) error = '单文件不能超过 50 MB'
    else if (currentNames.length + index >= 20) error = '每批最多导入 20 个文件'
    else if (names.has(file.name)) error = '本批次已选择同名文件'
    if (!error) names.add(file.name)
    return { ...file, error }
  })
}

export function shouldReadFileContent(file: { name: string; size: number }, currentNames: string[] = []) {
  return /\.(md|csv)$/i.test(file.name) && !validateFiles([file], currentNames)[0].error
}

export function getModelDependents(state: HubState, model: HubModel): string[] {
  return [
    ...state.knowledge.flatMap((kb) => [
      ...(kb.embedding === model.name ? [`知识库「${kb.name}」的 Embedding`] : []),
      ...(kb.rerank === model.name ? [`知识库「${kb.name}」的 Rerank`] : []),
    ]),
    ...state.assistants.filter((assistant) => assistant.model === model.name).map((assistant) => `问答应用「${assistant.name}」的 LLM`),
  ]
}

export function advanceTasks(state: HubState): HubState {
  if (!state.tasks.some((task) => task.state === 'processing')) return state
  const tasks = state.tasks.map((task) => task.state !== 'processing' ? task : { ...task, progress: Math.min(100, task.progress + 8), state: (task.progress + 8 >= 100 ? 'ready' : 'processing') as BuildState })
  const documents = state.documents.map((doc) => {
    const task = [...tasks].reverse().find((item) => item.fileIds.includes(doc.id) && item.state !== 'failed')
    return doc.state === 'processing' && task ? { ...doc, progress: task.progress, state: task.state, chunks: state.chunks.filter((c) => c.documentId === doc.id).length } : doc
  })
  const completed = tasks.filter((task, index) => task.state === 'ready' && state.tasks[index].state === 'processing').flatMap((task) => task.fileIds)
  const chunks = state.chunks.map((chunk) => completed.includes(chunk.documentId) ? { ...chunk, indexed: true } : chunk)
  return { ...state, tasks, documents, chunks }
}

function makeChunkTexts() { return [
  '员工出差应提前在 OA 系统提交出差申请。差旅费用按城市类别及职级标准实报实销，一线城市普通员工住宿标准上限为 600 元/晚，其他城市为 400 元/晚。超出标准的部分需事先经部门负责人批准。',
  '报销申请需在出差结束后 15 个工作日内提交。应提供合规发票、出差审批单和行程证明，财务审核通过后进入付款流程。',
  '员工婚假应至少提前 3 个工作日申请，上传结婚证扫描件，经直属主管审批后由人力资源部备案。假期须在公司规定的有效期内一次性休完。',
] }
export const chunkTexts = makeChunkTexts()

export function splitContent(text: string, target: number, overlap: number): string[] {
  if (target < 1 || overlap < 0 || overlap >= target) throw new Error('分块参数无效')
  const normalized = text.trim()
  if (!normalized) return []
  const chunks: string[] = []
  for (let start = 0; start < normalized.length;) {
    const end = Math.min(normalized.length, start + target)
    chunks.push(normalized.slice(start, end))
    if (end === normalized.length) break
    start = end - overlap
  }
  return chunks
}

export function restoreChunkSource(chunks: Pick<HubChunk, 'text'>[]): string {
  return chunks.reduce((source, chunk) => {
    if (!source) return chunk.text
    const maxOverlap = Math.min(source.length, chunk.text.length)
    let shared = 0
    for (let size = maxOverlap; size > 0; size -= 1) {
      if (source.endsWith(chunk.text.slice(0, size))) { shared = size; break }
    }
    return `${source}${shared ? '' : '\n\n'}${chunk.text.slice(shared)}`
  }, '')
}

export function logKnowledgeIds(log: Pick<HubLog, 'kbId' | 'kbIds'>): string[] {
  return log.kbIds?.length ? log.kbIds : [log.kbId]
}

export function rechunkKnowledge(state: HubState, kbId: string, target: number, overlap: number): HubState {
  const docs = state.documents.filter((doc) => doc.kbId === kbId)
  const replacements = docs.flatMap((doc) => {
    const text = restoreChunkSource(state.chunks.filter((chunk) => chunk.documentId === doc.id))
    return splitContent(text, target, overlap).map((text, index) => ({ id: uid('chunk'), kbId, documentId: doc.id, title: doc.name.replace(/\.[^.]+$/, '') + ` · 分块 ${index + 1}`, text, page: index + 1, indexed: false }))
  })
  return { ...state, chunks: [...state.chunks.filter((chunk) => chunk.kbId !== kbId), ...replacements] }
}

export function retrieveChunks(state: HubState, kbIds: string[], query: string, topK = 5, threshold = 0.35, rerank = true) {
  const text = query.toLowerCase().replace(/[\s，。？！、,.?!]/g, '')
  if (!text) return []
  const terms = [...new Set(Array.from({ length: Math.max(1, text.length - 1) }, (_, i) => text.slice(i, i + 2)))]
  return state.chunks.filter((chunk) => chunk.indexed && kbIds.includes(chunk.kbId) && state.documents.some((doc) => doc.id === chunk.documentId && doc.state === 'ready')).map((chunk) => {
    const content = `${chunk.title}${chunk.text}`.toLowerCase()
    const matches = terms.filter((term) => content.includes(term)).length
    const score = matches ? Math.min(0.98, 0.35 + matches / terms.length * 0.6) : 0
    return { ...chunk, score, vectorScore: Math.max(0, score - (rerank ? 0.08 : 0)), rerankScore: rerank ? score : null }
  }).filter((chunk) => chunk.score >= threshold && chunk.score > 0).sort((a, b) => b.score - a.score).slice(0, topK)
}
