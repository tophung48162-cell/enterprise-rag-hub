import { useEffect, useRef, useState } from 'react'
import { Alert, App as AntApp, Avatar, Badge, Button, Card, Descriptions, Divider, Drawer, Empty, Form, Input, InputNumber, Popconfirm, Select, Space, Spin, Statistic, Switch, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import { ApiOutlined, ArrowRightOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, HistoryOutlined, InfoCircleOutlined, LinkOutlined, MessageOutlined, NodeIndexOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, SendOutlined, SettingOutlined, StopOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiErrorMessage, hubApi, streamChat } from './api'
import type { AssistantDto, AssistantInput, ChatDoneDto, CitationDto, ConversationDetailDto, ConversationDto, MessageDto, ModelDto, QueryRunDto } from './api'
import { ROLE_LABELS } from './permissions'
import type { Role } from './types'
import type { HubKnowledge } from './workspace'

const remoteTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
const tokenText = (value: number | null) => value === null ? '未提供' : value.toLocaleString('zh-CN')
const durationText = (value: number | null) => value === null ? '—' : `${(value / 1000).toFixed(2)} 秒`

function RemoteHeading({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>
}

interface AssistantFormValues {
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

export function RemoteApplications({ role, knowledge, models }: { role: Role; knowledge: HubKnowledge[]; models: ModelDto[] }) {
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const [assistants, setAssistants] = useState<AssistantDto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AssistantDto | 'new' | null>(null)
  const [form] = Form.useForm<AssistantFormValues>()
  const refresh = async () => {
    setLoading(true)
    try { setAssistants(await hubApi.listAssistants()) }
    catch (error) { message.error(apiErrorMessage(error)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const apps = assistants.filter((assistant) =>
    (role === 'admin' || (role === 'manager' ? assistant.managed : assistant.published)) && assistant.name.includes(search),
  )
  const llmOptions = models.filter((model) => model.enabled && model.capability === 'LLM').map((model) => ({ value: model.id, label: model.remote_model_id }))
  const kbOptions = knowledge.filter((kb) => role === 'admin' || role === 'user' || kb.managed).map((kb) => ({ value: kb.id, label: `${kb.name}${kb.activeIndexVersionId ? '' : '（无活动索引）'}` }))
  const edit = (assistant: AssistantDto | 'new') => {
    setEditing(assistant)
    form.resetFields()
    form.setFieldsValue(assistant === 'new' ? {
      name: '', description: '', llm_model_id: llmOptions[0]?.value, kb_ids: [],
      system_prompt: '请仅依据提供的知识内容回答，缺乏依据时明确说明，并标注引用来源。',
      top_k: 5, candidate_k: 20, similarity_threshold: 0.35, rerank_enabled: true, published: false,
    } : assistant)
  }
  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing === 'new') await hubApi.createAssistant(values)
      else if (editing) await hubApi.patchAssistant(editing.id, values)
      await refresh()
      setEditing(null)
      message.success('问答应用已保存到服务端')
    } catch (error) { message.error(apiErrorMessage(error)) }
    finally { setSaving(false) }
  }
  return <div className="page"><RemoteHeading title="问答应用" description="为不同业务场景配置专属助手，连接知识、模型和回答策略。" actions={role !== 'user' && <Button type="primary" icon={<PlusOutlined />} onClick={() => edit('new')}>创建问答应用</Button>} />
    <Alert className="space-bottom" type="success" showIcon title="已连接 FastAPI · 应用、会话与回答均使用服务端数据" description="发布应用前，全部关联知识库必须允许问答且具有活动索引；启用重排时还需配置 Rerank 模型。" />
    <div className="knowledge-toolbar"><Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索问答应用" allowClear /><span>{role === 'user' ? '可使用的应用' : '全部应用'} <b>{apps.length}</b></span></div>
    <Spin spinning={loading}><div className="application-grid">{apps.map((assistant) => <article className="assistant-card" key={assistant.id}><div className="assistant-card-top"><span className="app-avatar large"><RobotOutlined /></span><Tag color={assistant.published ? 'success' : 'default'}>{assistant.published ? '已发布' : '草稿'}</Tag></div><h3>{assistant.name}</h3><p>{assistant.description}</p><div className="assistant-kbs">{assistant.kb_ids.map((id) => <Tag key={id} icon={<DatabaseOutlined />}>{knowledge.find((kb) => kb.id === id)?.name || '知识库不可用'}</Tag>)}</div><div className="assistant-model"><ApiOutlined /> {models.find((model) => model.id === assistant.llm_model_id)?.remote_model_id || assistant.llm_model_id}<span>{assistant.rerank_enabled ? 'Rerank 已启用' : '未启用重排'}</span></div><div className="assistant-actions">{role !== 'user' && <Button icon={<SettingOutlined />} onClick={() => edit(assistant)}>配置应用</Button>}<Button type={assistant.published ? 'primary' : 'default'} disabled={!assistant.published} icon={<MessageOutlined />} onClick={() => navigate(`/chat?assistant=${assistant.id}`)}>{assistant.published ? '开始对话' : '发布后可使用'}</Button></div></article>)}</div></Spin>
    {!loading && !apps.length && <Empty description="暂无可使用的问答应用" />}
    <Drawer title={editing === 'new' ? '创建问答应用' : '配置问答应用'} open={Boolean(editing)} onClose={() => setEditing(null)} size={580} extra={<Button type="primary" loading={saving} onClick={() => { void save() }}>保存应用</Button>} destroyOnHidden>
      <Form form={form} layout="vertical"><Form.Item name="name" label="应用名称" rules={[{ required: true, whitespace: true, message: '请输入应用名称' }, { max: 100 }]}><Input placeholder="例如：员工服务助手" /></Form.Item><Form.Item name="description" label="应用介绍" rules={[{ max: 500 }]}><Input.TextArea rows={2} /></Form.Item><Divider titlePlacement="start">知识与模型</Divider><Form.Item name="kb_ids" label="关联知识库" rules={[{ required: true, message: '请至少选择一个知识库' }]}><Select mode="multiple" maxCount={20} options={kbOptions} placeholder="选择知识库" /></Form.Item><Form.Item name="llm_model_id" label="LLM 模型" rules={[{ required: true, message: '请选择 LLM 模型' }]}><Select options={llmOptions} /></Form.Item><Form.Item name="system_prompt" label="系统提示词" rules={[{ required: true, whitespace: true }, { max: 10000 }]}><Input.TextArea rows={5} /></Form.Item><Divider titlePlacement="start">检索与生成</Divider><Space size={16} wrap><Form.Item name="top_k" label="最终引用 Top K" rules={[{ required: true }]}><InputNumber min={1} max={20} /></Form.Item><Form.Item name="candidate_k" label="单库候选数量" rules={[{ required: true }]}><InputNumber min={1} max={100} /></Form.Item><Form.Item name="similarity_threshold" label="最低相似度" rules={[{ required: true }]}><InputNumber min={0} max={1} step={0.05} /></Form.Item></Space><Form.Item name="rerank_enabled" valuePropName="checked" label="启用 Rerank"><Switch /></Form.Item><Form.Item name="published" valuePropName="checked" label="发布到在线对话"><Switch /></Form.Item><Alert type="info" showIcon title="保存发布配置时，后端会再次检查知识库和模型状态。" /></Form>
    </Drawer>
  </div>
}

type LiveMessage = MessageDto & { usage?: ChatDoneDto }

export function RemoteOnlineChat({ role, knowledge, models }: { role: Role; knowledge: HubKnowledge[]; models: ModelDto[] }) {
  const { message } = AntApp.useApp()
  const [params] = useSearchParams()
  const [apps, setApps] = useState<AssistantDto[]>([])
  const [appId, setAppId] = useState(params.get('assistant') || '')
  const [sessions, setSessions] = useState<ConversationDto[]>([])
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const [input, setInput] = useState('')
  const [stage, setStage] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [source, setSource] = useState<CitationDto | null>(null)
  const controller = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const app = apps.find((item) => item.id === appId)
  const refreshSessions = async (assistantId: string) => {
    try { setSessions(await hubApi.listConversations(assistantId)) }
    catch (requestError) { message.error(apiErrorMessage(requestError)) }
  }
  useEffect(() => {
    void hubApi.listAssistants().then((items) => {
      const published = items.filter((item) => item.published)
      setApps(published)
      setAppId((current) => published.some((item) => item.id === current) ? current : published[0]?.id || '')
    }).catch((requestError) => message.error(apiErrorMessage(requestError))).finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    setSessionId(''); setMessages([]); setSessions([]); setError('')
    if (appId) void refreshSessions(appId)
  }, [appId])
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [messages.length, stage])
  const stop = () => {
    controller.current?.abort()
    controller.current = null
    setStage('')
    setMessages((items) => items.map((item) => item.status === 'running' ? { ...item, status: 'stopped' } : item))
    message.info('已停止生成，已保留本轮内容')
  }
  const chooseApp = () => { if (stage) stop() }
  const openConversation = async (conversation: ConversationDto) => {
    if (stage) stop()
    setSessionId(conversation.id); setError(''); setStage('正在读取会话…')
    try {
      const detail = await hubApi.getConversation(conversation.id)
      setMessages(detail.messages)
    } catch (requestError) { message.error(apiErrorMessage(requestError)) }
    finally { setStage('') }
  }
  const send = async (preset?: string) => {
    const query = (preset ?? input).trim()
    if (!query || !app || stage) return
    setError('')
    let conversationId = sessionId
    setStage('正在准备会话…')
    try {
      if (!conversationId) {
        const created = await hubApi.createConversation(app.id)
        conversationId = created.id
        setSessionId(created.id)
      }
      const now = new Date().toISOString()
      const tempAnswerId = `streaming-${Date.now()}`
      const userMessage: LiveMessage = { id: `user-${Date.now()}`, role: 'user', content: query, status: 'ready', citations: [], created_at: now }
      const answerMessage: LiveMessage = { id: tempAnswerId, role: 'assistant', content: '', status: 'running', citations: [], created_at: now }
      setMessages((items) => [...items, userMessage, answerMessage])
      setInput(''); setStage('正在检索知识库…')
      const abort = new AbortController()
      controller.current = abort
      await streamChat(conversationId, { query, role_context: role }, {
        onMeta: () => undefined,
        onCitations: (citations) => {
          setStage('正在生成回答…')
          setMessages((items) => items.map((item) => item.id === tempAnswerId ? { ...item, citations } : item))
        },
        onToken: (text) => setMessages((items) => items.map((item) => item.id === tempAnswerId ? { ...item, content: item.content + text } : item)),
        onDone: (usage) => setMessages((items) => items.map((item) => item.id === tempAnswerId ? { ...item, status: 'ready', usage } : item)),
      }, abort.signal)
      await refreshSessions(app.id)
    } catch (requestError) {
      if (!abortSignalAborted(requestError, controller.current?.signal)) {
        const text = apiErrorMessage(requestError)
        setError(text)
        setMessages((items) => items.map((item) => item.status === 'running' ? { ...item, status: 'failed' } : item))
        message.error(text)
      }
    } finally {
      controller.current = null
      setStage('')
    }
  }
  const removeConversation = async (conversation: ConversationDto) => {
    try {
      await hubApi.deleteConversation(conversation.id)
      if (sessionId === conversation.id) { setSessionId(''); setMessages([]) }
      await refreshSessions(conversation.assistant_id)
      message.success('会话及其运行记录已删除')
    } catch (requestError) { message.error(apiErrorMessage(requestError)) }
  }
  return <div className="chat-page"><aside className="session-sidebar"><Button type="primary" icon={<PlusOutlined />} block disabled={!app} onClick={() => { if (stage) stop(); setSessionId(''); setMessages([]); setError('') }}>新建对话</Button><span className="session-label">历史会话</span>{sessions.map((conversation) => <div className={`session-item ${sessionId === conversation.id ? 'selected' : ''}`} key={conversation.id}><button onClick={() => { void openConversation(conversation) }}><MessageOutlined /><span>{conversation.title}</span></button><Popconfirm title="删除此会话及运行记录？" onConfirm={() => { void removeConversation(conversation) }}><Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`删除会话${conversation.title}`} /></Popconfirm></div>)}{!sessions.length && <p className="muted session-tip">开始提问后，会话会持久化保存在这里。</p>}<div className="session-bottom"><InfoCircleOutlined /> 引用保存活动索引原文快照</div></aside>
    <section className="chat-main"><div className="chat-toolbar"><div><b>{app?.name || '在线对话'}</b><small><Badge status={app ? 'success' : 'default'} /> {models.find((model) => model.id === app?.llm_model_id)?.remote_model_id || '选择问答应用'} · 真实知识问答</small></div><Select value={appId || undefined} loading={loading} onChange={(id) => { chooseApp(); setAppId(id) }} placeholder="选择问答应用" aria-label="选择问答应用" options={apps.map((item) => ({ value: item.id, label: item.name }))} /></div><div className="chat-scroll">{!messages.length ? <div className="chat-empty"><span className="chat-empty-icon"><RobotOutlined /></span><span className="eyebrow">GROUNDED IN YOUR KNOWLEDGE</span><h1>{app ? `你好，我是${app.name}` : '选择一个已发布的问答应用'}</h1><p>{app?.description || '请先在问答应用模块完成配置并发布。'}</p><div className="chat-kbs">{app?.kb_ids.map((id) => <Tag icon={<DatabaseOutlined />} key={id}>{knowledge.find((kb) => kb.id === id)?.name || '知识库不可用'}</Tag>)}</div>{app && <div className="suggestion-grid">{['请总结这个知识库能提供哪些帮助？', '报销需要准备哪些材料？', '请根据资料说明申请流程。'].map((question) => <button key={question} onClick={() => { void send(question) }}><MessageOutlined /><span>{question}</span><ArrowRightOutlined /></button>)}</div>}</div> : <div className="messages">{messages.map((item) => <div className={`message ${item.role}`} key={item.id}><Avatar icon={item.role === 'user' ? <UserOutlined /> : <RobotOutlined />} /><div className="message-content"><span className="message-author">{item.role === 'user' ? '你' : app?.name}</span><div className="message-text">{item.content || (item.status === 'running' ? stage : item.status === 'stopped' ? '回答已停止。' : '回答未完成，请重试。')}</div>{item.role === 'assistant' && <><div className="citation-buttons">{item.citations.map((citation) => <Button key={citation.id} size="small" icon={<LinkOutlined />} onClick={() => setSource(citation)}>[{citation.ordinal}] {citation.document_name}</Button>)}</div><div className="message-usage"><Button type="text" size="small" icon={<CopyOutlined />} aria-label="复制回答" onClick={async () => { try { await navigator.clipboard.writeText(item.content); message.success('已复制') } catch { message.info('请选中文字复制') } }} />{item.usage ? <span>{tokenText(item.usage.total_tokens)} Tokens · {durationText(item.usage.total_ms)} · {item.usage.usage_source === 'provider' ? '服务商用量' : '用量未提供'}</span> : <span>{item.status === 'ready' ? '历史消息 · 用量见运行日志' : item.status === 'failed' ? '调用失败' : item.status === 'stopped' ? '已停止' : stage}</span>}</div></>}</div></div>)}<div ref={bottom} /></div>}{error && <Alert className="space-top" type="error" showIcon title={error} />}</div><div className="composer"><Input.TextArea aria-label="输入问题" value={input} onChange={(event) => setInput(event.target.value)} autoSize={{ minRows: 1, maxRows: 5 }} placeholder={app ? '基于已关联知识库提问，Enter 发送' : '请先选择已发布的问答应用'} disabled={!app} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} />{stage ? <Button danger icon={<StopOutlined />} onClick={stop}>停止生成</Button> : <Button type="primary" icon={<SendOutlined />} disabled={!app || !input.trim()} onClick={() => { void send() }}>发送</Button>}<small>回答由 LLM 实时生成；请以引用原文为准。</small></div></section>
    <Drawer title="引用来源" open={Boolean(source)} size={520} onClose={() => setSource(null)}>{source && <><div className="source-heading"><span className="file-icon kind-text"><DatabaseOutlined /></span><div><h3>{source.document_name}</h3><p>分块序号 {source.page_number} · {source.chunk_id}</p></div></div><Tag color="blue">活动索引原文快照</Tag><article className="source-block"><h3>{source.title}</h3><p>{source.snapshot_text}</p></article><Descriptions column={2} size="small" items={[{ key: 'vector', label: '向量分数', children: source.vector_score.toFixed(3) }, { key: 'rerank', label: '重排分数', children: source.rerank_score === null ? '未启用' : source.rerank_score.toFixed(3) }]} /><Alert className="space-top" type="info" showIcon title="不可变来源" description="此快照随回答持久化，不受后续分块编辑或新索引版本影响。" /></>}</Drawer>
  </div>
}

function abortSignalAborted(error: unknown, signal?: AbortSignal) {
  return Boolean(signal?.aborted) || (error instanceof DOMException && error.name === 'AbortError')
}

export function RemoteRunLogs({ role, knowledge }: { role: Role; knowledge: HubKnowledge[] }) {
  const { message } = AntApp.useApp()
  const [runs, setRuns] = useState<QueryRunDto[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [kbId, setKbId] = useState('all')
  const [selected, setSelected] = useState<QueryRunDto | null>(null)
  const refresh = async () => {
    setLoading(true)
    try { setRuns(await hubApi.listQueryRuns()) }
    catch (error) { message.error(apiErrorMessage(error)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const scoped = runs.filter((run) => role !== 'manager' || run.kb_ids.every((id) => knowledge.find((kb) => kb.id === id)?.managed))
  const filtered = scoped.filter((run) => run.query.includes(query) && (kbId === 'all' || run.kb_ids.includes(kbId)))
  const knownTokens = scoped.reduce((sum, run) => sum + (run.total_tokens ?? 0), 0)
  const missingUsage = scoped.filter((run) => run.total_tokens === null).length
  const durations = scoped.flatMap((run) => run.total_ms === null ? [] : [run.total_ms])
  const average = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null
  const statusLabel: Record<QueryRunDto['status'], string> = { running: '运行中', succeeded: '成功', failed: '失败', stopped: '已停止' }
  const columns: TableColumnsType<QueryRunDto> = [
    { title: '时间', dataIndex: 'created_at', width: 165, render: remoteTime },
    { title: '查询内容', dataIndex: 'query', ellipsis: true, width: 270 },
    { title: '应用 / 知识库', width: 220, render: (_, run) => <div><b>{run.assistant_name}</b><small className="table-subline">{run.kb_ids.map((id) => knowledge.find((kb) => kb.id === id)?.name || '知识库不可用').join('、')}</small></div> },
    { title: '模型', dataIndex: 'llm_model', width: 140, render: (value) => <Tag>{value}</Tag> },
    { title: '输入 / 输出 Tokens', width: 170, render: (_, run) => run.usage_source === 'unavailable' ? '未提供' : `${tokenText(run.input_tokens)} / ${tokenText(run.output_tokens)}` },
    { title: '首字 / 总耗时', width: 155, render: (_, run) => `${durationText(run.first_token_ms)} / ${durationText(run.total_ms)}` },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: QueryRunDto['status']) => <Tag color={value === 'succeeded' ? 'success' : value === 'failed' ? 'error' : value === 'running' ? 'processing' : 'default'}>{statusLabel[value]}</Tag> },
    { title: '详情', width: 75, fixed: 'right', render: (_, run) => <Button type="link" onClick={() => setSelected(run)}>查看</Button> },
  ]
  return <div className="page"><RemoteHeading title="运行日志" description="追踪每次问答的查询内容、知识来源、Token 消耗与响应耗时。" actions={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => { void refresh() }}>刷新数据</Button>} />
    <Alert className="space-bottom" type="info" showIcon title="Token 仅采用服务商实际返回值" description={missingUsage ? `当前有 ${missingUsage} 次调用未提供用量，不参与 Token 汇总，也不会按字符估算。` : '当前记录均已返回 Token 用量。'} />
    <div className="metrics"><div className="metric"><span className="metric-icon"><MessageOutlined /></span><div><small>问答请求</small><strong>{scoped.length}</strong><span>最近 200 条服务端记录</span></div></div><div className="metric"><span className="metric-icon"><NodeIndexOutlined /></span><div><small>已上报 Tokens</small><strong>{knownTokens.toLocaleString('zh-CN')}</strong><span>{missingUsage ? `${missingUsage} 次未提供` : '服务商实际用量'}</span></div></div><div className="metric"><span className="metric-icon"><HistoryOutlined /></span><div><small>平均响应</small><strong>{average === null ? '—' : `${(average / 1000).toFixed(2)} 秒`}</strong><span>仅统计已结束调用</span></div></div><div className="metric"><span className="metric-icon"><LinkOutlined /></span><div><small>来源引用</small><strong>{scoped.reduce((sum, run) => sum + run.citation_count, 0)}</strong><span>不可变原文快照</span></div></div></div>
    <Card className="table-card" styles={{ body: { padding: 0 } }}><div className="table-toolbar"><Space wrap><Input prefix={<SearchOutlined />} placeholder="搜索查询内容" value={query} onChange={(event) => setQuery(event.target.value)} allowClear /><Select value={kbId} onChange={setKbId} options={[{ value: 'all', label: '全部知识库' }, ...knowledge.map((kb) => ({ value: kb.id, label: kb.name }))]} /></Space><Button onClick={() => { setQuery(''); setKbId('all') }}>重置筛选</Button></div><Table rowKey="id" columns={columns} dataSource={filtered} loading={loading} scroll={{ x: 1320 }} pagination={{ pageSize: 8 }} /></Card>
    <Drawer title="请求链路详情" size={560} open={Boolean(selected)} onClose={() => setSelected(null)}>{selected && <><Descriptions column={1} size="small" items={[{ key: 'id', label: '请求 ID', children: selected.id }, { key: 'time', label: '请求时间', children: remoteTime(selected.created_at) }, { key: 'role', label: '体验角色', children: ROLE_LABELS[selected.role_context] }, { key: 'assistant', label: '问答应用', children: selected.assistant_name }, { key: 'model', label: 'LLM 模型', children: selected.llm_model }, { key: 'status', label: '运行状态', children: statusLabel[selected.status] }, { key: 'usage', label: '用量来源', children: selected.usage_source === 'provider' ? '服务商实际返回' : '服务商未提供' }]} />{selected.error_code && <Alert className="space-top" type="error" showIcon title={`错误码：${selected.error_code}`} />}<Divider titlePlacement="start">问题与回答</Divider><h4>{selected.query}</h4><p className="log-answer">{selected.answer || '未生成回答'}</p><Divider titlePlacement="start">消耗与耗时</Divider><div className="log-stats"><Statistic title="输入 Tokens" value={tokenText(selected.input_tokens)} /><Statistic title="输出 Tokens" value={tokenText(selected.output_tokens)} /><Statistic title="总 Tokens" value={tokenText(selected.total_tokens)} /><Statistic title="首 Token" value={durationText(selected.first_token_ms)} /><Statistic title="总耗时" value={durationText(selected.total_ms)} /><Statistic title="来源引用" value={selected.citation_count} suffix="条" /></div></>}</Drawer>
  </div>
}
