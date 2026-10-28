import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Alert, App as AntApp, Avatar, Badge, Breadcrumb, Button, Card, Checkbox, Descriptions, Divider, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Radio, Result, Select, Space, Spin, Statistic, Steps, Switch, Table, Tabs, Tag, Tooltip, Upload } from 'antd'
import type { TableColumnsType } from 'antd'
import { ApiOutlined, AppstoreOutlined, ArrowLeftOutlined, ArrowRightOutlined, AuditOutlined, BookOutlined, CheckCircleOutlined, CloudUploadOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, EditOutlined, FileExcelOutlined, FileImageOutlined, FilePdfOutlined, FileTextOutlined, FolderOpenOutlined, HistoryOutlined, InboxOutlined, InfoCircleOutlined, LinkOutlined, MessageOutlined, NodeIndexOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SaveOutlined, ScissorOutlined, SearchOutlined, SendOutlined, SettingOutlined, StopOutlined, ThunderboltOutlined, UserOutlined } from '@ant-design/icons'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Role } from './types'
import { canAccessPath, getAccessibleMenuItems, getDefaultRoute, normalizeRole, ROLE_LABELS, ROLE_OPTIONS } from './permissions'
import { advanceTasks, detectKind, getModelDependents, logKnowledgeIds, readWorkspace, rechunkKnowledge, retrieveChunks, shouldReadFileContent, splitContent, STORE_KEY, timestamp, uid, validateFiles } from './workspace'
import type { BuildState, HubAssistant, HubChunk, HubDocument, HubKnowledge, HubLog, HubModel, HubProvider, HubSession, HubState } from './workspace'
import { apiErrorMessage, hubApi, recognizeOcr } from './api'
import type { ChunkDto, DocumentDto, ModelDto, ProviderDto } from './api'

type ContextValue = {
  state: HubState
  setState: Dispatch<SetStateAction<HubState>>
  role: Role
  knowledgeConnected: boolean
  knowledgeLoading: boolean
  remoteModels: ModelDto[]
  refreshKnowledge: () => Promise<void>
}
const HubContext = createContext<ContextValue>(null!)
const useHub = () => useContext(HubContext)
const navIcons: Record<string, ReactNode> = { workbench: <AppstoreOutlined />, models: <ApiOutlined />, knowledge: <DatabaseOutlined />, applications: <RobotOutlined />, chat: <MessageOutlined />, logs: <AuditOutlined /> }
const number = (value: number) => value.toLocaleString('zh-CN')
const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`
const roleKey = 'knowledge-hub-role-v3'
const accessibleKbs = (state: HubState, role: Role) => state.knowledge.filter((kb) => role === 'admin' || (role === 'manager' && kb.managed) || (role === 'user' && kb.published))
const availableModels = (state: HubState, type: HubModel['type']) => state.models.filter((m) => m.type === type && m.enabled && state.providers.some((p) => p.name === m.provider && p.configured)).map((m) => ({ value: m.name, label: `${m.name} · ${m.provider}` }))
const remoteTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
const mapRemoteDocument = (document: DocumentDto): HubDocument => ({
  id: document.id,
  kbId: document.kb_id,
  name: document.original_name,
  kind: detectKind(document.original_name) || 'Markdown',
  size: formatBytes(document.size_bytes),
  state: ({ ready: 'ready', processing: 'processing', failed: 'failed', uploaded: 'uploaded', pending_index: 'pending' } as Record<DocumentDto['status'], BuildState>)[document.status],
  chunks: document.chunk_count,
  progress: document.status === 'ready' ? 100 : 0,
  parser: 'LangChain Markdown · 服务端持久化',
  updated: remoteTime(document.updated_at),
})
const mapRemoteChunk = (chunk: ChunkDto): HubChunk => ({
  id: chunk.id,
  documentId: chunk.document_id,
  kbId: chunk.kb_id,
  title: chunk.title,
  text: chunk.text,
  page: chunk.page_number,
  indexed: chunk.status === 'ready',
})

function StateTag({ value }: { value: BuildState }) {
  const labels: Record<BuildState, string> = { ready: '已索引', processing: '构建中', failed: '处理失败', uploaded: '待分块', pending: '待索引' }
  const color = value === 'ready' ? 'success' : value === 'processing' ? 'processing' : value === 'failed' ? 'error' : value === 'pending' ? 'warning' : 'default'
  return <Tag color={color}>{labels[value]}</Tag>
}
function FileIcon({ kind }: { kind: HubDocument['kind'] }) {
  return <span className={`file-icon kind-${kind === 'PDF' ? 'pdf' : kind === '表格' ? 'sheet' : kind === '图片' ? 'image' : 'text'}`}>{kind === 'PDF' ? <FilePdfOutlined /> : kind === '表格' ? <FileExcelOutlined /> : kind === '图片' ? <FileImageOutlined /> : <FileTextOutlined />}</span>
}
function Heading({ title, description, actions, kicker }: { title: string; description: string; actions?: ReactNode; kicker?: string }) {
  return <div className="page-heading"><div>{kicker && <div className="eyebrow">{kicker}</div>}<h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>
}
function Metrics({ items }: { items: { label: string; value: string | number; icon: ReactNode; note?: string }[] }) {
  return <div className="metrics">{items.map((item) => <div className="metric" key={item.label}><span className="metric-icon">{item.icon}</span><div><small>{item.label}</small><strong>{item.value}</strong>{item.note && <span>{item.note}</span>}</div></div>)}</div>
}
function startBuild(state: HubState, kbId: string, ids: string[]): HubState {
  return { ...state, documents: state.documents.map((doc) => ids.includes(doc.id) ? { ...doc, state: 'processing', progress: 0 } : doc), chunks: state.chunks.map((chunk) => ids.includes(chunk.documentId) ? { ...chunk, indexed: false } : chunk), tasks: [...state.tasks, { id: uid('TASK'), kbId, fileIds: ids, state: 'processing', progress: 0, created: timestamp() }] }
}

export default function HubApp() {
  const [state, setState] = useState(readWorkspace)
  const [role, setRole] = useState<Role>(() => { try { const stored = localStorage.getItem(roleKey); return stored ? normalizeRole(stored) : 'admin' } catch { return 'admin' } })
  const navigate = useNavigate()
  const location = useLocation()
  const { message } = AntApp.useApp()
  const [navOpen, setNavOpen] = useState(false)
  const [knowledgeConnected, setKnowledgeConnected] = useState(false)
  const [knowledgeLoading, setKnowledgeLoading] = useState(true)
  const [remoteModels, setRemoteModels] = useState<ModelDto[]>([])
  const refreshKnowledge = async () => {
    setKnowledgeLoading(true)
    try {
      const [knowledgeItems, modelItems] = await Promise.all([hubApi.listKnowledgeBases(), hubApi.listModels()])
      const documentGroups = await Promise.all(knowledgeItems.map((item) => hubApi.listDocuments(item.id)))
      const documentItems = documentGroups.flat()
      const chunkGroups = await Promise.all(documentItems.map((item) => hubApi.listChunks(item.id)))
      setRemoteModels(modelItems)
      setState((current) => ({
        ...current,
        knowledge: knowledgeItems.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          department: item.department,
          color: 'blue',
          published: item.published,
          managed: item.managed,
          embedding: modelItems.find((model) => model.id === item.embedding_model_id)?.remote_model_id || item.embedding_model_id,
          rerank: modelItems.find((model) => model.id === item.rerank_model_id)?.remote_model_id || '',
          embeddingId: item.embedding_model_id,
          rerankId: item.rerank_model_id || undefined,
          updated: remoteTime(item.updated_at),
          chunkSize: item.chunk_size,
          overlap: item.chunk_overlap,
          strategy: item.chunk_strategy,
        })),
        documents: documentItems.map(mapRemoteDocument),
        chunks: chunkGroups.flat().map(mapRemoteChunk),
        tasks: [],
      }))
      setKnowledgeConnected(true)
    } catch {
      setKnowledgeConnected(false)
    } finally {
      setKnowledgeLoading(false)
    }
  }
  useEffect(() => { void refreshKnowledge() }, [])
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)) } catch { message.warning('浏览器存储不可用，本次修改将在关闭页面后丢失。') } }, [state, message])
  useEffect(() => { const timer = window.setInterval(() => setState(advanceTasks), 800); return () => window.clearInterval(timer) }, [])
  const changeRole = (value: Role) => {
    setRole(value)
    try { localStorage.setItem(roleKey, value) } catch { /* Role switching remains usable. */ }
    navigate(getDefaultRoute(value)); setNavOpen(false)
    message.success(`已切换为${ROLE_LABELS[value]}`)
  }
  const routeRoot = '/' + location.pathname.split('/')[1]
  const activeMenu = getAccessibleMenuItems(role).find((item) => item.path === routeRoot)
  return <HubContext.Provider value={{ state, setState, role, knowledgeConnected, knowledgeLoading, remoteModels, refreshKnowledge }}><div className={`hub ${navOpen ? 'nav-open' : ''}`}>
    <aside className="global-sidebar">
      <button className="brand" onClick={() => navigate('/workbench')}><span className="brand-symbol">知</span><span><b>知枢</b><small>企业知识中台</small></span></button>
      <span className="nav-section">工作空间</span>
      <nav aria-label="主导航">{getAccessibleMenuItems(role).map((item) => <button key={item.key} className={routeRoot === item.path ? 'selected' : ''} onClick={() => { navigate(item.path); setNavOpen(false) }}>{navIcons[item.key]}<span>{item.label}</span>{item.key === 'knowledge' && <small>{accessibleKbs(state, role).length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="edition"><span className="edition-symbol"><NodeIndexOutlined /></span><div><b>企业内部版</b><small>知识沉淀 · 可信问答</small></div><Tag>1.0</Tag></div><span className="side-caption"><CheckCircleOutlined /> 原型体验 · 数据保存在本机</span></div>
    </aside>
    <div className="hub-frame">
      <header className="global-header"><div className="header-left"><Button className="mobile-nav" type="text" icon={<AppstoreOutlined />} aria-label="展开模块导航" onClick={() => setNavOpen(!navOpen)} /><Breadcrumb items={[{ title: '企业知识中台' }, { title: activeMenu?.label || '工作台' }]} /></div><Space size={16}><span className="role-note">体验视角 · 非鉴权</span><Select value={role} options={ROLE_OPTIONS} onChange={changeRole} aria-label="切换体验角色" className="role-select" prefix={<UserOutlined />} /></Space></header>
      <div className="prototype-ribbon"><InfoCircleOutlined /><span>1.0 联调版：模型配置、图片 OCR、知识库与 Markdown 分块支持真实接口；向量索引、检索问答及其他文档解析仍为演示。</span><Tag variant="filled">V2</Tag></div>
      <main className="hub-main"><Routes>
        <Route path="/" element={<Navigate to="/workbench" replace />} />
        <Route path="/workbench" element={<Workbench />} />
        <Route path="/models" element={<Guard><ModelServices /></Guard>} />
        <Route path="/knowledge" element={<Guard><KnowledgeList /></Guard>} />
        <Route path="/knowledge/:id" element={<Guard><KnowledgeWorkspace /></Guard>} />
        <Route path="/knowledge/:id/import" element={<Guard><KnowledgeWorkspace initialImport /></Guard>} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/chat" element={<OnlineChat />} />
        <Route path="/logs" element={<Guard><RunLogs /></Guard>} />
        <Route path="*" element={<Result status="404" title="页面不存在" extra={<Button onClick={() => navigate('/workbench')}>返回工作台</Button>} />} />
      </Routes></main>
    </div>
  </div></HubContext.Provider>
}

function Guard({ children }: { children: ReactNode }) {
  const { role } = useHub(); const { pathname } = useLocation()
  return canAccessPath(role, pathname) ? children : <Result status="403" title="当前角色无权访问此模块" subTitle="可在右上角切换体验角色。" />
}

function Workbench() {
  const { state, role } = useHub(); const navigate = useNavigate()
  const kbs = accessibleKbs(state, role)
  const docs = state.documents.filter((doc) => kbs.some((kb) => kb.id === doc.kbId))
  const assistants = state.assistants.filter((a) => role === 'admin' || (role === 'manager' ? a.managed : a.published))
  const kbIds = kbs.map((kb) => kb.id)
  const tasks = state.tasks.filter((t) => kbIds.includes(t.kbId))
  return <div className="page workbench-page">
    <Heading title="工作台" description="从知识接入到可信问答，让企业经验持续产生价值。" actions={<Tag color="blue">{ROLE_LABELS[role]}视角</Tag>} />
    <div className="welcome-panel"><div><span className="eyebrow">YOUR KNOWLEDGE, CONNECTED</span><h2>把分散的资料，变成随时可用的知识。</h2><p>导入企业文档，构建知识库，再为团队配置专属的问答助手。</p><Space><Button type="primary" icon={role === 'user' ? <MessageOutlined /> : <PlusOutlined />} onClick={() => navigate(role === 'user' ? '/chat' : '/knowledge')}>{role === 'user' ? '开始在线对话' : '管理知识库'}</Button><Button onClick={() => navigate('/applications')}>查看问答应用 <ArrowRightOutlined /></Button></Space></div><div className="knowledge-art" aria-hidden="true"><span className="art-node art-document"><FileTextOutlined /></span><span className="art-line" /><span className="art-node art-core"><DatabaseOutlined /></span><span className="art-line" /><span className="art-node art-chat"><MessageOutlined /></span></div></div>
    <Metrics items={[{ label: '知识库', value: kbs.length, icon: <DatabaseOutlined />, note: '统一管理知识资产' }, { label: '知识文档', value: docs.length, icon: <FileTextOutlined />, note: `${docs.filter((d) => d.state === 'ready').length} 份已建立索引` }, { label: '问答应用', value: assistants.length, icon: <RobotOutlined />, note: `${assistants.filter((a) => a.published).length} 个已发布` }, { label: '问答调用', value: state.logs.filter((l) => kbIds.includes(l.kbId)).length, icon: <MessageOutlined />, note: '查询和消耗可追溯' }]} />
    <div className="section-title"><h3>知识到答案，四步完成</h3><span>一条完整的知识服务链路</span></div>
    <div className="flow-grid">{[{ title: '接入知识', text: '上传 Word、PDF、图片与表格', icon: <CloudUploadOutlined />, path: '/knowledge' }, { title: '加工与构建', text: '检查分块、修订内容并建立索引', icon: <ScissorOutlined />, path: '/knowledge/cuisine?tab=chunks' }, { title: '配置问答应用', text: '关联知识库、模型和回答策略', icon: <RobotOutlined />, path: '/applications' }, { title: '对话与追踪', text: '基于知识回答，查看原文依据', icon: <MessageOutlined />, path: '/chat' }].map((item, i) => <button key={item.title} className="flow-step" onClick={() => navigate(role === 'user' && i < 2 ? '/applications' : item.path)}><span className="flow-number">0{i + 1}</span><span className="flow-icon">{item.icon}</span><h4>{item.title}</h4><p>{item.text}</p><ArrowRightOutlined /></button>)}</div>
    <div className="workbench-columns"><Card title="常用问答应用" extra={<Button type="link" onClick={() => navigate('/applications')}>全部应用 <ArrowRightOutlined /></Button>}><div className="compact-apps">{assistants.map((a) => <button key={a.id} onClick={() => navigate(a.published ? `/chat?assistant=${a.id}` : '/applications')}><span className="app-avatar"><RobotOutlined /></span><span><b>{a.name}</b><small>{a.description}</small></span><Tag color={a.published ? 'success' : 'default'}>{a.published ? '已发布' : '草稿'}</Tag><ArrowRightOutlined /></button>)}</div></Card><Card title="知识处理动态" extra={<Space size={8}><Tag color="gold">演示数据</Tag><Tag>{tasks.length} 项</Tag></Space>}>{tasks.length ? tasks.slice(-3).reverse().map((task) => <div className="activity" key={task.id}><span className={`activity-dot ${task.state}`} /><div><b>{state.knowledge.find((k) => k.id === task.kbId)?.name}</b><p>{task.fileIds.length} 个文件 · {task.created}</p>{task.error && task.state === 'failed' && <small>{task.error}</small>}</div><StateTag value={task.state} /></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无处理任务" />}</Card></div>
  </div>
}

function KnowledgeList() {
  const { state, role, setState, knowledgeConnected, knowledgeLoading, remoteModels, refreshKnowledge } = useHub(); const navigate = useNavigate(); const { message } = AntApp.useApp()
  const [search, setSearch] = useState(''); const [department, setDepartment] = useState('all'); const [open, setOpen] = useState(false); const [creating, setCreating] = useState(false); const [form] = Form.useForm()
  const kbs = accessibleKbs(state, role).filter((kb) => kb.name.includes(search) && (department === 'all' || kb.department === department))
  const modelOptions = (type: ModelDto['capability']) => knowledgeConnected
    ? remoteModels.filter((model) => model.enabled && model.capability === type).map((model) => ({ value: model.id, label: model.remote_model_id }))
    : availableModels(state, type)
  const openCreate = () => setOpen(true)
  useEffect(() => {
    if (open) form.setFieldsValue({ department: '企业通用', embedding: modelOptions('Embedding')[0]?.value, rerank: modelOptions('Rerank')[0]?.value })
  }, [open, form, knowledgeConnected, remoteModels])
  const create = async () => {
    const values = await form.validateFields()
    setCreating(true)
    try {
      let id = ''
      if (knowledgeConnected) {
        const created = await hubApi.createKnowledgeBase({
          name: values.name,
          description: values.description || '',
          department: values.department,
          embedding_model_id: values.embedding,
          rerank_model_id: values.rerank || null,
          published: false,
          chunk_size: 800,
          chunk_overlap: 120,
          chunk_strategy: 'structure',
        })
        id = created.id
        await refreshKnowledge()
      } else {
        id = uid('kb')
        setState((s) => ({ ...s, knowledge: [...s.knowledge, { ...values, id, color: 'blue', managed: true, published: false, updated: timestamp(), chunkSize: 800, overlap: 120, strategy: 'structure' }] }))
      }
      form.resetFields(); setOpen(false); navigate(`/knowledge/${id}`); message.success(knowledgeConnected ? '知识库已持久化，可以开始导入 Markdown 资料' : '知识库已创建，可以开始导入资料')
    } catch (error) { message.error(apiErrorMessage(error)) }
    finally { setCreating(false) }
  }
  return <div className="page"><Heading title="知识库" description="集中管理企业知识，完成文件接入、解析分块与索引构建。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建知识库</Button>} />
    <Alert className="space-bottom" showIcon type={knowledgeConnected ? 'success' : knowledgeLoading ? 'info' : 'warning'} title={knowledgeConnected ? '已连接 FastAPI · 知识库、Markdown 与分块使用服务端持久化数据' : knowledgeLoading ? '正在读取知识库数据…' : '后端未连接 · 当前为本机知识库演示'} description={knowledgeConnected ? '真实分块保存后处于待索引状态；向量索引、检索和问答尚未接入。' : '连接后端并配置 Embedding 模型后，可创建真实知识库。'} />
    <div className="knowledge-toolbar"><Space wrap><Input prefix={<SearchOutlined />} placeholder="搜索知识库名称" value={search} onChange={(e) => setSearch(e.target.value)} allowClear /><Select aria-label="按部门筛选" value={department} onChange={setDepartment} options={[{ value: 'all', label: '全部部门' }, ...[...new Set(accessibleKbs(state, role).map((kb) => kb.department))].map((value) => ({ value, label: value }))]} /></Space><span>{role === 'manager' ? '我管理的知识库' : '全部知识库'} <b>{kbs.length}</b></span></div>
    <div className="knowledge-grid">{kbs.map((kb) => { const docs = state.documents.filter((d) => d.kbId === kb.id); const chunks = state.chunks.filter((c) => c.kbId === kb.id); return <article key={kb.id} className="knowledge-card"><div className="knowledge-card-head"><span className={`kb-avatar color-${kb.color}`}><DatabaseOutlined /></span><Tag color={docs.some((d) => d.state === 'processing') ? 'processing' : docs.some((d) => d.state === 'ready') ? 'success' : docs.length ? 'warning' : 'default'}>{docs.some((d) => d.state === 'processing') ? '构建中' : docs.some((d) => d.state === 'ready') ? '可检索' : docs.length ? '待索引' : '待导入'}</Tag></div><h3><button onClick={() => navigate(`/knowledge/${kb.id}`)}>{kb.name}</button></h3><p>{kb.description}</p><div className="kb-labels"><Tag variant="filled">{kb.department}</Tag><span>{kb.published ? '已开放问答' : '未发布'}</span></div><div className="kb-counts"><span><FileTextOutlined /> <b>{docs.length}</b> 份文档</span><span><ScissorOutlined /> <b>{chunks.length}</b> 个分块</span></div><div className="kb-model"><NodeIndexOutlined /><span>{kb.embedding}</span><Tooltip title="知识库级索引模型"><InfoCircleOutlined /></Tooltip></div><div className="knowledge-card-footer"><span>{kb.updated}</span><Button type="link" onClick={() => navigate(`/knowledge/${kb.id}`)}>进入知识库 <ArrowRightOutlined /></Button></div></article> })}<button className="create-kb-card" onClick={openCreate}><span><PlusOutlined /></span><b>创建新的知识库</b><p>为一个业务领域建立知识空间</p></button></div>
    {!kbs.length && search && <Empty description="没有找到匹配的知识库" />}
    <Modal title="新建知识库" open={open} onCancel={() => setOpen(false)} onOk={create} okText="创建知识库" cancelText="取消" confirmLoading={creating} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="知识库名称" rules={[{ required: true, whitespace: true, message: '请输入知识库名称' }, { max: 30 }]}><Input placeholder="例如：产品与技术文档" /></Form.Item>
        <Form.Item name="description" label="描述" rules={[{ max: 200 }]}><Input.TextArea rows={3} placeholder="说明资料范围和使用场景" /></Form.Item>
        <Form.Item name="department" label="所属部门" rules={[{ required: true }]}><Select options={['企业通用', '人力行政', '产品研发', '客户服务', '项目交付'].map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="embedding" label="Embedding 模型" rules={[{ required: true, message: '请选择已配置的向量模型' }]}><Select options={modelOptions('Embedding')} /></Form.Item>
        <Form.Item name="rerank" label="Rerank 模型"><Select allowClear options={modelOptions('Rerank')} /></Form.Item>
        <Alert type="info" showIcon title="向量模型确定后，变更模型需要重建索引。" />
      </Form>
    </Modal>
  </div>
}

function KnowledgeWorkspace({ initialImport = false }: { initialImport?: boolean }) {
  const { state, setState, role, knowledgeConnected, knowledgeLoading } = useHub(); const { id } = useParams(); const navigate = useNavigate(); const [params, setParams] = useSearchParams(); const { message } = AntApp.useApp()
  const kb = accessibleKbs(state, role).find((k) => k.id === id)
  const [importOpen, setImportOpen] = useState(initialImport); const [settingsOpen, setSettingsOpen] = useState(false)
  const tab = params.get('tab') || 'files'
  if (knowledgeLoading && !kb) return <div className="loading-state"><Spin /><p>正在读取知识库…</p></div>
  if (!kb) return <Result status="403" title="知识库不存在或不在当前角色管理范围内" extra={<Button onClick={() => navigate('/knowledge')}>返回知识库</Button>} />
  const docs = state.documents.filter((d) => d.kbId === id); const chunks = state.chunks.filter((c) => c.kbId === id); const tasks = state.tasks.filter((t) => t.kbId === id)
  const rebuilding = docs.some((d) => d.state === 'processing')
  const rebuild = () => {
    if (!docs.length) { message.info('请先导入文件'); return }
    if (knowledgeConnected) { message.info('真实分块已保存；向量索引服务尚未接入，本次未创建模拟任务'); return }
    setState((s) => startBuild(s, kb.id, docs.map((d) => d.id))); message.success('重建任务已创建，可在文件与任务中查看进度')
  }
  return <div className="knowledge-workspace"><aside className="knowledge-subnav"><button className="back-link" onClick={() => navigate('/knowledge')}><ArrowLeftOutlined /> 全部知识库</button><div className="subnav-identity"><span className={`kb-avatar small color-${kb.color}`}><DatabaseOutlined /></span><div><b>{kb.name}</b><small>知识库工作区</small></div></div><div className="subnav-divider" />{[{ key: 'files', icon: <FileTextOutlined />, text: '文件与任务', count: docs.length }, { key: 'chunks', icon: <ScissorOutlined />, text: '分块预览', count: chunks.length }, { key: 'search', icon: <SearchOutlined />, text: '检索测试' }].map((item) => <button key={item.key} className={`subnav-item ${tab === item.key ? 'selected' : ''}`} onClick={() => setParams({ tab: item.key })}>{item.icon}<span>{item.text}</span>{item.count !== undefined && <small>{item.count}</small>}</button>)}<div className="subnav-foot"><div><span>索引模型</span><b>{kb.embedding}</b></div><Button type="text" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>知识库设置</Button></div></aside>
    <section className="knowledge-content"><Heading kicker={`知识库 / ${tab === 'chunks' ? '分块预览' : tab === 'search' ? '检索测试' : '文件与任务'}`} title={tab === 'chunks' ? '分块预览与编辑' : tab === 'search' ? '检索测试' : '文件与构建任务'} description={tab === 'chunks' ? '检查文档结构、上下文边界和索引状态；人工修改后需重新生成向量。' : tab === 'search' ? '用真实问题验证召回片段，检查重排效果和原文依据。' : '接入多种格式的企业资料，查看解析、分块和索引构建进度。'} actions={tab === 'files' ? <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setImportOpen(true)}>导入知识</Button> : tab === 'chunks' ? <Button type="primary" icon={<ReloadOutlined />} loading={rebuilding} disabled={!docs.length} onClick={rebuild}>重建索引</Button> : undefined} />
      {tab === 'files' ? <DocumentTasks kb={kb} documents={docs} tasks={tasks} onImport={() => setImportOpen(true)} onChunks={() => setParams({ tab: 'chunks' })} /> : tab === 'chunks' ? <ChunkWorkspace kb={kb} documents={docs} onRebuild={rebuild} /> : <RetrievalTest kb={kb} />}
    </section><ImportKnowledge kb={kb} open={importOpen} onClose={() => { setImportOpen(false); if (initialImport) navigate(`/knowledge/${kb.id}`) }} /><KnowledgeSettings kb={kb} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </div>
}

function DocumentTasks({ kb, documents, tasks, onImport, onChunks }: { kb: HubKnowledge; documents: HubDocument[]; tasks: HubState['tasks']; onImport: () => void; onChunks: () => void }) {
  const { state, setState, knowledgeConnected, refreshKnowledge } = useHub()
  const { message } = AntApp.useApp()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [preview, setPreview] = useState<HubDocument | null>(null)
  const [deleting, setDeleting] = useState('')
  const retry = (doc: HubDocument) => {
    if (knowledgeConnected) { message.info('服务端文档失败暂不支持重新解析，请删除后重新导入'); return }
    setState((s) => {
      const chunks = s.chunks.some((c) => c.documentId === doc.id) ? s.chunks : [...s.chunks, { id: uid('chunk'), documentId: doc.id, kbId: kb.id, title: doc.name, page: 1, indexed: false, text: '采购审批流程：员工提交申请 → 部门负责人审批 → 财务复核 → 采购执行。（演示 OCR 结果）' }]
      return startBuild({ ...s, chunks }, kb.id, [doc.id])
    })
    message.success('已提交重新处理任务')
  }
  const remove = async (doc: HubDocument) => {
    if (doc.state === 'processing') { message.warning('文件正在构建，请等待任务完成后再删除'); return }
    if (!knowledgeConnected) {
      setState((s) => ({ ...s, documents: s.documents.filter((x) => x.id !== doc.id), chunks: s.chunks.filter((c) => c.documentId !== doc.id), tasks: s.tasks.map((task) => ({ ...task, fileIds: task.fileIds.filter((id) => id !== doc.id) })).filter((task) => task.fileIds.length) }))
      return
    }
    setDeleting(doc.id)
    try { await hubApi.deleteDocument(doc.id); await refreshKnowledge(); message.success('文档、原件与分块已删除') }
    catch (error) { message.error(apiErrorMessage(error)) }
    finally { setDeleting('') }
  }
  const columns: TableColumnsType<HubDocument> = [
    { title: '文件名称', width: 300, render: (_, d) => <button className="file-cell" onClick={() => setPreview(d)}><FileIcon kind={d.kind} /><span><b>{d.name}</b><small>{d.kind} · {d.size}</small></span></button> },
    { title: '处理状态', width: 145, render: (_, d) => <div><StateTag value={d.state} />{d.state === 'processing' && <Progress percent={d.progress} size="small" showInfo={false} />}</div> },
    { title: '分块', dataIndex: 'chunks', width: 70 }, { title: '解析方式', dataIndex: 'parser', width: 180 }, { title: '更新时间', dataIndex: 'updated', width: 145 },
    { title: '操作', width: 154, fixed: 'right', render: (_, d) => <Space size={0}>{d.state === 'failed' ? <Button type="link" onClick={() => retry(d)}>重试</Button> : <Button type="link" onClick={onChunks}>分块</Button>}<Popconfirm title="确认删除该文档及其分块？" onConfirm={() => { void remove(d) }}><Button type="text" danger loading={deleting === d.id} icon={<DeleteOutlined />} aria-label={`删除${d.name}`} /></Popconfirm></Space> },
  ]
  const pending = documents.filter((d) => d.state === 'processing')
  return <><div className="workspace-summary"><span><FileTextOutlined /><b>{documents.length}</b> 份文档</span><span><ScissorOutlined /><b>{state.chunks.filter((c) => c.kbId === kb.id).length}</b> 个分块</span><span><CheckCircleOutlined /><b>{documents.filter((d) => d.state === 'ready').length}</b> 份已索引</span><span className="summary-right">Embedding：{kb.embedding}</span></div>
    {pending.length > 0 && <Alert className="space-bottom" type="info" showIcon title={`正在处理 ${pending.length} 份文档`} description={<Progress percent={Math.round(pending.reduce((sum, d) => sum + d.progress, 0) / pending.length)} size="small" />} />}
    <Card className="table-card" styles={{ body: { padding: 0 } }}><div className="table-toolbar"><Input prefix={<SearchOutlined />} placeholder="搜索文件名称" value={query} onChange={(e) => setQuery(e.target.value)} allowClear /><Select value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部状态' }, { value: 'ready', label: '已索引' }, { value: 'pending', label: '待索引' }, { value: 'uploaded', label: '待分块' }, { value: 'processing', label: '构建中' }, { value: 'failed', label: '处理失败' }]} /></div><Table rowKey="id" dataSource={documents.filter((d) => d.name.includes(query) && (filter === 'all' || d.state === filter))} columns={columns} pagination={false} scroll={{ x: 1020 }} locale={{ emptyText: <Empty description="还没有知识文件"><Button type="primary" onClick={onImport}>导入第一份资料</Button></Empty> }} /></Card>
    <div className="section-title"><h3>构建任务</h3><span>文件解析 → 分块 → 向量化 → 索引</span></div><div className="task-list">{tasks.length ? [...tasks].reverse().map((task) => <div key={task.id} className="task-row"><span className="task-symbol"><NodeIndexOutlined /></span><div><b>{task.fileIds.length} 份文件的索引构建</b><small>{task.id} · {task.created}</small>{task.state === 'failed' && <span className="error-text">{task.error}</span>}</div><Progress percent={task.progress} status={task.state === 'failed' ? 'exception' : undefined} size="small" /><StateTag value={task.state} /></div>) : <div className="muted-empty">{knowledgeConnected ? '真实向量索引任务尚未接入；当前仅保存 Markdown 原件与分块。' : '暂无构建任务，导入文件后将在此处追踪进度。'}</div>}</div>
    <Drawer title="文档内容与来源" open={Boolean(preview)} size={560} onClose={() => setPreview(null)}>{preview && <><div className="source-heading"><FileIcon kind={preview.kind} /><div><h3>{preview.name}</h3><p>{preview.parser} · {preview.size}</p></div></div><Alert type="info" showIcon title={knowledgeConnected ? '服务端持久化分块' : '原型文档预览'} description={knowledgeConnected ? '以下内容读取自 FastAPI；页码为 Markdown 分块序号，不代表原文件页码。' : '此处展示演示资料中的文本分块；正式版将展示原文件并定位页码。'} />{state.chunks.filter((c) => c.documentId === preview.id).map((c) => <article className="source-block" key={c.id}><Tag>分块序号 {c.page}</Tag><h4>{c.title}</h4><p>{c.text}</p></article>)}</>}</Drawer>
  </>
}

function ChunkWorkspace({ kb, documents, onRebuild }: { kb: HubKnowledge; documents: HubDocument[]; onRebuild: () => void }) {
  const { state, setState, knowledgeConnected, refreshKnowledge } = useHub()
  const { message } = AntApp.useApp()
  const [selected, setSelected] = useState(documents[0]?.id || '')
  const [editing, setEditing] = useState<HubChunk | null>(null)
  const [text, setText] = useState('')
  const [size, setSize] = useState(kb.chunkSize || 800)
  const [overlap, setOverlap] = useState(kb.overlap || 120)
  const [strategy, setStrategy] = useState(kb.strategy || 'structure')
  const [savingParameters, setSavingParameters] = useState(false)
  const [savingChunk, setSavingChunk] = useState(false)
  const doc = documents.find((d) => d.id === selected) || documents[0]
  const chunks = state.chunks.filter((c) => c.documentId === doc?.id)
  const pending = state.chunks.filter((c) => c.kbId === kb.id && !c.indexed).length
  const saveParameters = async () => {
    if (overlap >= size) { message.error('重叠长度必须小于目标长度'); return }
    if (knowledgeConnected && strategy === 'table') { message.warning('服务端当前支持结构优先或递归字符分块'); return }
    setSavingParameters(true)
    try {
      if (knowledgeConnected) {
        const chunkStrategy = strategy as 'structure' | 'recursive'
        await hubApi.patchKnowledgeBase(kb.id, { chunk_size: size, chunk_overlap: overlap, chunk_strategy: chunkStrategy })
        for (const document of documents) await hubApi.previewDocument(document.id, { chunk_size: size, chunk_overlap: overlap, chunk_strategy: chunkStrategy })
        await refreshKnowledge()
        message.success('参数与持久化分块已保存，文档仍处于待索引状态')
      } else {
        setState((s) => {
          const updated = rechunkKnowledge({ ...s, knowledge: s.knowledge.map((k) => k.id === kb.id ? { ...k, chunkSize: size, overlap, strategy } : k) }, kb.id, size, overlap)
          return startBuild(updated, kb.id, documents.map((d) => d.id))
        })
        message.success('参数已保存，正在模拟重新构建索引')
      }
    } catch (error) {
      message.error(apiErrorMessage(error))
      if (knowledgeConnected) await refreshKnowledge().catch(() => undefined)
    } finally { setSavingParameters(false) }
  }
  const saveChunk = async () => {
    if (!text.trim()) { message.warning('分块内容不能为空'); return }
    if (!editing) return
    setSavingChunk(true)
    try {
      if (knowledgeConnected) {
        await hubApi.patchChunk(editing.id, text)
        await refreshKnowledge()
      } else setState((s) => ({ ...s, chunks: s.chunks.map((c) => c.id === editing.id ? { ...c, text, indexed: false } : c) }))
      setEditing(null)
      message.success('内容已保存；真实向量索引尚未接入')
    } catch (error) { message.error(apiErrorMessage(error)) }
    finally { setSavingChunk(false) }
  }
  const strategyOptions = [{ value: 'structure', label: 'LangChain 结构优先' }, { value: 'recursive', label: '递归字符分块' }, ...(!knowledgeConnected ? [{ value: 'table', label: '按表格区域分块' }] : [])]
  return <><Alert type={pending ? 'warning' : 'info'} showIcon className="space-bottom" title={pending ? `${pending} 个分块等待重新索引` : knowledgeConnected ? '当前没有待索引分块' : '所有分块均已索引'} description={knowledgeConnected ? '分块与人工修订真实保存到服务端；向量索引尚未接入，不会自动生成模拟任务。' : '点击任意分块的编辑按钮进行人工修订，保存后需重建索引才能用于检索。'} />{!documents.length ? <Empty description="请先导入资料后查看分块" /> : <div className="chunk-workbench"><aside className="document-picker"><div className="panel-title">文档 <span>{documents.length}</span></div>{documents.map((item) => <button key={item.id} className={doc?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item.id)}><FileIcon kind={item.kind} /><span><b>{item.name}</b><small>{state.chunks.filter((c) => c.documentId === item.id).length} 个分块</small></span></button>)}</aside>
      <div className="chunk-list"><div className="panel-title"><b>{doc?.name}</b><span>{chunks.length} 个分块</span></div><div className="chunk-scroll">{chunks.length ? chunks.map((chunk, index) => <article className="chunk-item" key={chunk.id}><div className="chunk-item-top"><Space size={8}><Tag color={chunk.indexed ? 'cyan' : 'warning'}>{chunk.indexed ? <CheckCircleOutlined /> : <HistoryOutlined />} 分块 {index + 1}</Tag><code>{chunk.id.slice(-8)}</code></Space><Button type="text" size="small" icon={<EditOutlined />} onClick={() => { setEditing(chunk); setText(chunk.text) }}>编辑</Button></div><h4>{chunk.title}</h4><p>{chunk.text}</p><div className="chunk-meta">分块序号 {chunk.page} · {chunk.text.length} 字符 · {doc?.kind}<span>{chunk.indexed ? '已索引' : '待索引'}</span></div></article>) : <Empty description="文件尚未生成分块，请保存分块参数或重新导入" />}</div></div>
      <aside className="chunk-parameters"><h3><SettingOutlined /> 分块参数</h3><label>策略<Select value={strategy} onChange={setStrategy} options={strategyOptions} /></label><label>目标长度<InputNumber value={size} onChange={(v) => setSize(v || 800)} min={100} max={4000} /><small>允许 100–4,000 字符</small></label><label>重叠长度<InputNumber value={overlap} onChange={(v) => setOverlap(v || 0)} min={0} max={Math.max(0, size - 1)} /></label><Divider /><div className="parameter-note"><ScissorOutlined /><span><b>{state.chunks.filter((c) => c.kbId === kb.id).length} 个分块</b><small>{knowledgeConnected ? '保存后由 LangChain 重切全部文档' : '修改参数后重建全部文件'}</small></span></div><Button block loading={savingParameters} onClick={() => { void saveParameters() }} disabled={!documents.length || documents.some((d) => d.state === 'processing')}>{knowledgeConnected ? '保存参数并重切分块' : '保存参数并重建'}</Button>{pending > 0 && <Button type="primary" block onClick={onRebuild}>重建待处理索引</Button>}</aside>
    </div>}<Modal title="编辑分块" open={Boolean(editing)} onCancel={() => setEditing(null)} okText="保存修改" cancelText="取消" confirmLoading={savingChunk} onOk={() => { void saveChunk() }}><Alert className="space-bottom" type="warning" showIcon title="修改后，该分块会标记为待索引。" /><Input.TextArea aria-label="分块正文" rows={9} value={text} onChange={(e) => setText(e.target.value)} showCount /></Modal></>
}

function RetrievalTest({ kb }: { kb: HubKnowledge }) {
  const { state, knowledgeConnected } = useHub(); const [query, setQuery] = useState(''); const [topK, setTopK] = useState(5); const [threshold, setThreshold] = useState(0.35); const [rerank, setRerank] = useState(true); const [loading, setLoading] = useState(false); const [results, setResults] = useState<ReturnType<typeof retrieveChunks> | null>(null); const [source, setSource] = useState<HubChunk | null>(null); const timer = useRef<number>(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const run = (value = query) => { if (!value.trim() || loading) return; setQuery(value); setLoading(true); timer.current = window.setTimeout(() => { setResults(retrieveChunks(state, [kb.id], value, topK, threshold, rerank)); setLoading(false) }, 650) }
  if (knowledgeConnected) return <Alert type="info" showIcon title="真实向量检索尚未接入" description="当前知识库使用服务端持久化数据。为避免把本地文本匹配误当成真实召回，联机模式下暂不运行演示检索；待版本化向量索引完成后再开放。" />
  return <div className="retrieval-layout"><Card title={<><SearchOutlined /> 检索参数</>}><label className="field-label">测试问题</label><Input.TextArea value={query} onChange={(e) => setQuery(e.target.value)} rows={4} placeholder="输入一个真实业务问题" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() } }} /><Button className="space-top" block type="primary" icon={<SearchOutlined />} loading={loading} disabled={!query.trim()} onClick={() => run()}>测试检索</Button><Divider /><label className="setting-row">召回数量 Top K<InputNumber min={1} max={20} value={topK} onChange={(v) => setTopK(v || 5)} /></label><label className="setting-row">最低相似度<InputNumber min={0} max={1} step={0.05} value={threshold} onChange={(v) => setThreshold(v || 0)} /></label><label className="setting-row">启用 Rerank<Switch checked={rerank} onChange={setRerank} /></label><div className="model-footnote"><NodeIndexOutlined /> {kb.embedding}<br /><NodeIndexOutlined /> {kb.rerank || '未设置重排模型'}</div><small className="muted">原型使用文本匹配模拟召回，评分仅供交互验收。</small></Card><div><div className="section-title no-top"><h3>检索结果</h3><span>{results ? `${results.length} 个命中 · ${rerank ? '已重排' : '未重排'} · 0.65 秒` : '等待测试'}</span></div>{loading ? <div className="loading-state"><Spin /><p>正在召回并整理相关片段…</p></div> : results === null ? <div className="retrieval-empty"><span><SearchOutlined /></span><h3>验证知识是否能被准确找到</h3><p>输入问题，检查命中文本、原文位置和检索评分。</p><Button onClick={() => run(kb.id === 'cuisine' ? '过桥米线有哪些主要食材？' : '差旅报销需要哪些材料？')}>试一试：{kb.id === 'cuisine' ? '过桥米线有哪些主要食材？' : '差旅报销需要哪些材料？'}</Button></div> : results.length ? results.map((chunk, i) => <Card className="retrieval-result" key={chunk.id}><div className="retrieval-result-top"><span className="rank">{i + 1}</span><div><b>{state.documents.find((d) => d.id === chunk.documentId)?.name}</b><small>第 {chunk.page} 页 · {chunk.id}</small></div><Tag color="blue">{chunk.score.toFixed(2)}</Tag></div><h4>{chunk.title}</h4><p>{chunk.text}</p><div className="result-footer"><Space size={6}><Tag>向量 {chunk.vectorScore.toFixed(2)}</Tag>{chunk.rerankScore !== null && <Tag color="cyan">重排 {chunk.rerankScore.toFixed(2)}</Tag>}</Space><Button type="link" icon={<FileTextOutlined />} onClick={() => setSource(chunk)}>查看来源</Button></div></Card>) : <Empty description="没有找到足够依据，请调整问题或降低相似度阈值" />}</div><CitationDrawer chunk={source} onClose={() => setSource(null)} /></div>
}

function KnowledgeSettings({ kb, open, onClose }: { kb: HubKnowledge; open: boolean; onClose: () => void }) {
  const { state, setState, knowledgeConnected, remoteModels, refreshKnowledge } = useHub()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const modelOptions = (capability: ModelDto['capability']) => knowledgeConnected
    ? remoteModels.filter((model) => model.enabled && model.capability === capability).map((model) => ({ value: model.id, label: model.remote_model_id }))
    : availableModels(state, capability)
  useEffect(() => {
    if (open) form.setFieldsValue(knowledgeConnected ? { ...kb, embedding: kb.embeddingId, rerank: kb.rerankId } : kb)
  }, [open, kb, form, knowledgeConnected])
  const save = async () => {
    const values = await form.validateFields()
    const publishedApps = state.assistants.filter((app) => app.published && app.kbIds.includes(kb.id))
    if (kb.published && !values.published && publishedApps.length) { message.warning(`该知识库正被已发布应用「${publishedApps.map((app) => app.name).join('、')}」使用，请先取消发布相关应用`); return }
    setSaving(true)
    try {
      if (knowledgeConnected) {
        await hubApi.patchKnowledgeBase(kb.id, { name: values.name, description: values.description || '', embedding_model_id: values.embedding, rerank_model_id: values.rerank || null, published: values.published })
        await refreshKnowledge()
      } else {
        setState((s) => {
          const updated = { ...s, knowledge: s.knowledge.map((k) => k.id === kb.id ? { ...k, ...values, updated: timestamp() } : k) }
          const documentIds = s.documents.filter((d) => d.kbId === kb.id).map((d) => d.id)
          return values.embedding !== kb.embedding && documentIds.length ? startBuild(updated, kb.id, documentIds) : updated
        })
      }
      onClose()
      message.success(knowledgeConnected ? '知识库设置已保存到服务端；模型变更不会伪造索引任务' : '知识库设置已保存')
    } catch (error) { message.error(apiErrorMessage(error)) }
    finally { setSaving(false) }
  }
  return <Drawer title="知识库设置" open={open} onClose={onClose} size={480} extra={<Button type="primary" loading={saving} onClick={() => { void save() }}>保存</Button>}><Form form={form} layout="vertical"><Form.Item name="name" label="知识库名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item><Form.Item name="description" label="描述"><Input.TextArea rows={3} /></Form.Item><Form.Item name="embedding" label="Embedding 模型" rules={[{ required: true }]}><Select options={modelOptions('Embedding')} /></Form.Item><Alert className="space-bottom" type="warning" showIcon title={knowledgeConnected ? '向量模型变更已支持保存；版本化索引与自动重建将在后续接入。' : '变更向量模型将触发全部文件重建索引。'} /><Form.Item name="rerank" label="Rerank 模型"><Select allowClear options={modelOptions('Rerank')} /></Form.Item><Form.Item name="published" valuePropName="checked" label="允许问答应用使用"><Switch /></Form.Item></Form></Drawer>
}

type PendingFile = { id: string; name: string; size: number; error: string; text?: string; raw?: File; ocrReady?: boolean; remoteDocumentId?: string; remoteChunks?: HubChunk[]; remoteReady?: boolean }
function ImportKnowledge({ kb, open, onClose }: { kb: HubKnowledge; open: boolean; onClose: () => void }) {
  const { state, setState, knowledgeConnected, refreshKnowledge } = useHub(); const { message, modal } = AntApp.useApp(); const [step, setStep] = useState(0); const [files, setFiles] = useState<PendingFile[]>([]); const filesRef = useRef<PendingFile[]>([]); const [parser, setParser] = useState('smart'); const [size, setSize] = useState(800); const [overlap, setOverlap] = useState(120); const [ocr, setOcr] = useState(true); const [submitted, setSubmitted] = useState(false)
  const [ocrModels, setOcrModels] = useState<{ value: string; label: string }[]>([]); const [ocrModelId, setOcrModelId] = useState(''); const [ocrLoading, setOcrLoading] = useState(false); const [ocrProcessing, setOcrProcessing] = useState(false); const [ocrStatus, setOcrStatus] = useState('')
  const [remoteProcessing, setRemoteProcessing] = useState(false); const [remoteStatus, setRemoteStatus] = useState('')
  const updateFiles = (next: PendingFile[]) => { filesRef.current = next; setFiles(next) }
  const valid = files.filter((f) => !f.error)
  const remoteBatch = knowledgeConnected && valid.length > 0 && valid.every((file) => file.raw && detectKind(file.name) === 'Markdown')
  const imageKey = valid.filter((file) => detectKind(file.name) === '图片').map((file) => file.id).join(',')
  useEffect(() => {
    if (!open || step !== 1 || !ocr || !imageKey) { setOcrStatus(''); return }
    let cancelled = false; setOcrLoading(true); setOcrStatus('')
    void Promise.all([hubApi.listProviders(), hubApi.listModels()]).then(([providerItems, modelItems]) => {
      if (cancelled) return
      const options = modelItems.filter((model) => model.enabled && model.capability === 'LLM' && model.remote_model_id.toLowerCase().includes('ocr') && providerItems.some((item) => item.id === model.provider_id && item.kind === 'tongyi' && item.enabled && item.configured)).map((model) => ({ value: model.id, label: model.remote_model_id }))
      setOcrModels(options); setOcrModelId((current) => options.some((item) => item.value === current) ? current : options[0]?.value || '')
      if (!options.length) setOcrStatus('后端没有可用的通义 OCR 模型，请先在模型服务中配置。')
    }).catch((error: unknown) => { if (!cancelled) setOcrStatus(apiErrorMessage(error)) }).finally(() => { if (!cancelled) setOcrLoading(false) })
    return () => { cancelled = true }
  }, [open, step, ocr, imageKey])
  const demo = () => updateFiles([{ id: 'sample-md', name: '企业报销指南.md', size: 2180, error: '', text: '报销申请须在出差结束后 15 个工作日内提交，提供合规发票、出差审批单和行程证明。财务审核后进入付款流程。\n\n发票抬头应为公司完整名称。住宿费用按照出差城市标准执行；超标费用须获得事先审批。' }, { id: 'sample-sheet', name: '差旅费用标准.csv', size: 480, error: '', text: '城市类别,住宿上限,交通标准\n一线城市,600 元/晚,实报实销\n其他城市,400 元/晚,实报实销' }])
  const reset = () => { setStep(0); updateFiles([]); setSubmitted(false); setOcrStatus(''); setRemoteStatus('') }
  const finishClose = () => { const persisted = filesRef.current.some((file) => file.remoteDocumentId); reset(); onClose(); if (persisted) void refreshKnowledge() }
  const close = () => {
    if (ocrProcessing || remoteProcessing) { message.info('文件处理中，请等待当前操作完成'); return }
    if (valid.length && !submitted) modal.confirm({ title: '退出本次导入？', content: valid.some((file) => file.remoteDocumentId) ? '已上传的服务端原件与分块会保留；本次未完成的本地选择将清空。' : '已选择的文件和参数将被清空。', okText: '退出导入', cancelText: '继续编辑', onOk: finishClose })
    else finishClose()
  }
  const previewText = (file: PendingFile) => file.text || `【演示分块】${file.name} 的内容将由正式版解析服务提取。此处用于检查段落、页码、表格和图片 OCR 的交互流程。`
  const generatePreview = async () => {
    const currentValid = filesRef.current.filter((file) => !file.error)
    const useRemote = knowledgeConnected && currentValid.length > 0 && currentValid.every((file) => file.raw && detectKind(file.name) === 'Markdown')
    if (useRemote) {
      setRemoteProcessing(true); setRemoteStatus('')
      try {
        for (const selectedFile of currentValid) {
          const current = filesRef.current.find((item) => item.id === selectedFile.id)
          if (!current || current.remoteReady) continue
          if (!current.raw) throw new Error(`${current.name} 缺少原始文件，请重新选择`)
          setRemoteStatus(`正在上传并分块 ${current.name}…`)
          let documentId = current.remoteDocumentId
          if (!documentId) {
            const uploaded = await hubApi.uploadDocument(kb.id, current.raw)
            documentId = uploaded.id
            updateFiles(filesRef.current.map((item) => item.id === current.id ? { ...item, remoteDocumentId: documentId } : item))
          }
          const preview = await hubApi.previewDocument(documentId, { chunk_size: size, chunk_overlap: overlap, chunk_strategy: 'structure' })
          const remoteChunks = preview.chunks.map(mapRemoteChunk)
          updateFiles(filesRef.current.map((item) => item.id === current.id ? { ...item, remoteDocumentId: documentId, remoteChunks, remoteReady: true } : item))
        }
        setRemoteStatus(''); setStep(2); message.success('Markdown 原件与 LangChain 分块已保存到服务端')
      } catch (error) { const text = apiErrorMessage(error); setRemoteStatus(`${text}；已完成的文件无需重复上传，可直接重试。`); message.error(text) }
      finally { setRemoteProcessing(false) }
      return
    }
    const images = currentValid.filter((file) => detectKind(file.name) === '图片')
    if (!ocr || !images.length) { setStep(2); return }
    if (!ocrModelId) { message.warning('请先连接后端并选择可用的通义 OCR 模型'); return }
    setOcrProcessing(true); setOcrStatus('')
    try {
      for (const file of images) {
        if (!file.raw) throw new Error(`${file.name} 缺少原始文件，请重新选择`)
        setOcrStatus(`正在识别 ${file.name}…`)
        const result = await recognizeOcr(file.raw, ocrModelId)
        updateFiles(filesRef.current.map((item) => item.id === file.id ? { ...item, text: result.text, ocrReady: true } : item))
      }
      setOcrStatus(''); setStep(2); message.success(`${images.length} 张图片已完成真实云端 OCR`)
    } catch (error) { const text = apiErrorMessage(error); setOcrStatus(text); message.error(text) }
    finally { setOcrProcessing(false) }
  }
  const submit = async () => {
    if (submitted || remoteProcessing || !valid.length || overlap >= size) return
    if (remoteBatch) {
      setRemoteProcessing(true)
      try {
        await refreshKnowledge()
        setSubmitted(true); message.success('服务端分块已保存，文档处于待索引状态'); onClose(); reset()
      } catch (error) { message.error(apiErrorMessage(error)) }
      finally { setRemoteProcessing(false) }
      return
    }
    const documents: HubDocument[] = valid.map((file) => ({ id: uid('doc'), kbId: kb.id, name: file.name, kind: detectKind(file.name)!, size: formatBytes(file.size), state: 'processing', chunks: 0, progress: 0, parser: file.ocrReady ? '通义云端 OCR' : parser === 'cloud' ? '云端高精度 OCR（演示）' : '智能结构解析（演示）', updated: timestamp() }))
    const chunks: HubChunk[] = documents.flatMap((doc, index) => splitContent(previewText(valid[index]), size, overlap).map((text, i) => ({ id: uid('chunk'), documentId: doc.id, kbId: kb.id, title: doc.name.replace(/\.[^.]+$/, '') + ` · 第 ${i + 1} 段`, text, page: i + 1, indexed: false })))
    setState((s) => startBuild({ ...s, documents: [...s.documents, ...documents], chunks: [...s.chunks, ...chunks], knowledge: s.knowledge.map((k) => k.id === kb.id ? { ...k, updated: timestamp() } : k) }, kb.id, documents.map((d) => d.id)))
    setSubmitted(true); message.success('构建任务已创建'); onClose(); reset()
  }
  return <Drawer title={<span>导入知识 <small className="muted">/ {kb.name}</small></span>} open={open} onClose={close} size={920} destroyOnHidden footer={<div className="import-footer"><span>{valid.length} 个有效文件{remoteBatch ? ' · 服务端持久化' : ''}</span><Space><Button disabled={step === 0 || remoteProcessing} onClick={() => setStep(step - 1)}>上一步</Button><Button type="primary" loading={step === 1 && (ocrLoading || ocrProcessing)} disabled={valid.length === 0 || (step > 0 && overlap >= size) || (remoteProcessing && step !== 2)} onClick={() => { if (step === 3) void submit(); else if (step === 1) void generatePreview(); else setStep(step + 1) }}>{step === 3 ? remoteBatch ? '保存分块（待索引）' : '确认并构建索引' : step === 1 ? '生成分块预览' : '下一步'}</Button></Space></div>}><Steps current={step} items={['上传文件', '解析设置', '分块预览', remoteBatch ? '保存分块' : '开始构建'].map((title) => ({ title }))} />
    <div className="import-step">{step === 0 ? <><h2>选择要导入的企业资料</h2><p className="muted">支持 Word、PDF、Markdown、图片和表格，每批 20 份、单文件最大 50 MB。</p><Upload.Dragger accept=".doc,.docx,.pdf,.md,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.csv" multiple showUploadList={false} beforeUpload={async (file) => { const currentNames = filesRef.current.filter((f) => !f.error).map((f) => f.name); const checked = validateFiles([{ name: file.name, size: file.size }], currentNames)[0]; const id = uid('file'); updateFiles([...filesRef.current, { ...checked, id, raw: file }]); if (shouldReadFileContent(file, currentNames)) { try { const text = await file.text(); updateFiles(filesRef.current.map((item) => item.id === id ? { ...item, text } : item)) } catch { updateFiles(filesRef.current.map((item) => item.id === id ? { ...item, error: '文件读取失败，请重试' } : item)) } } return false }}><p className="upload-symbol"><InboxOutlined /></p><h3>拖拽文件到此处，或点击选择</h3><p>PDF · DOCX · MD · PNG/JPG · XLSX/CSV</p></Upload.Dragger><Button className="space-top" icon={<FileTextOutlined />} onClick={demo}>使用示例资料体验流程</Button><div className="import-file-list">{files.map((file) => <div key={file.id}><FileTextOutlined /><span><b>{file.name}</b><small className={file.error ? 'error-text' : 'muted'}>{file.error || `${(file.size / 1024).toFixed(1)} KB · 格式校验通过`}</small></span><Button type="text" icon={<DeleteOutlined />} aria-label={`移除${file.name}`} onClick={() => updateFiles(filesRef.current.filter((f) => f.id !== file.id))} /></div>)}</div><Alert type="info" showIcon title="按文件类型选择解析链路" description={knowledgeConnected ? '整批真实 Markdown 将上传 FastAPI，并由 LangChain 持久化分块；混合格式仍走原型流程，图片可使用真实 OCR。PDF、Word、Excel 尚未接入服务端解析。' : 'Markdown、CSV 在浏览器读取文本；图片选择真实 OCR 后会将内容发往通义服务商。PDF、Word、Excel 当前仍为演示解析，不会上传文件。'} /></> : step === 1 ? <><h2>解析与分块设置</h2><Form layout="vertical">{remoteStatus && <Alert className="space-bottom" type={remoteProcessing ? 'info' : 'warning'} showIcon title={remoteStatus} />}<Form.Item label="解析方式"><Radio.Group value={parser} onChange={(e) => setParser(e.target.value)} options={[{ value: 'smart', label: '智能结构解析（推荐）' }, { value: 'cloud', label: '云端高精度' }]} /></Form.Item><div className="toggle-setting"><span><b>图片与扫描件执行云端 OCR</b><small>保留文档内图片、表格和来源页码</small></span><Switch checked={ocr} disabled={ocrProcessing} onChange={setOcr} /></div>{ocr && imageKey && <><Form.Item label="通义 OCR 模型" extra="仅显示后端已启用且已完成密钥配置的 OCR 模型。"><Select aria-label="通义 OCR 模型" value={ocrModelId || undefined} onChange={setOcrModelId} options={ocrModels} loading={ocrLoading} disabled={ocrProcessing} placeholder="请选择已配置的通义 OCR 模型" notFoundContent={ocrLoading ? '正在读取模型配置' : '暂无可用 OCR 模型'} /></Form.Item>{ocrStatus && <Alert className="space-bottom" type={ocrProcessing ? 'info' : 'warning'} showIcon title={ocrStatus} />}</>}<Alert className="space-bottom" type="info" showIcon title="云端 OCR 会把图片内容发送至你配置的通义服务商；其余文档解析仍为演示。" /><div className="two-fields"><Form.Item label="目标分块长度（字符）"><InputNumber min={100} max={4000} value={size} onChange={(v) => setSize(v || 800)} /></Form.Item><Form.Item label="重叠长度（字符）" validateStatus={overlap >= size ? 'error' : ''} help={overlap >= size ? '重叠必须小于目标长度' : undefined}><InputNumber min={0} max={3999} value={overlap} onChange={(v) => setOverlap(v || 0)} /></Form.Item></div><Descriptions column={1} bordered size="small" items={[{ key: 'embedding', label: 'Embedding', children: kb.embedding }, { key: 'rerank', label: 'Rerank', children: kb.rerank || '未配置' }]} /></Form></> : step === 2 ? <><h2>检查分块和来源</h2><p className="muted">抽查正文、表格及来源定位；导入后可在分块工作区继续修订。</p>{valid.map((file, i) => file.remoteChunks?.length ? file.remoteChunks.map((chunk, j) => <article className="chunk-item" key={chunk.id}><div className="chunk-item-top"><Tag color="green">Markdown</Tag><span>持久化分块 {j + 1}</span></div><h4>{chunk.title}</h4><p>{chunk.text}</p><div className="chunk-meta">来源：{file.name} · FastAPI · LangChain 持久化分块 · 待索引</div></article>) : <article className="chunk-item" key={file.id}><div className="chunk-item-top"><Tag color="blue">{detectKind(file.name)}</Tag><span>预览分块 {i + 1}</span></div><h4>{file.name}</h4><p>{previewText(file)}</p><div className="chunk-meta">来源：{file.name} · {file.ocrReady ? '真实云端 OCR' : file.text ? '文件文本' : '演示解析内容'}</div></article>)}</> : <div className="build-confirm"><span className="confirm-check"><CheckCircleOutlined /></span><h2>{remoteBatch ? '保存服务端分块' : '准备构建知识库索引'}</h2><p>{remoteBatch ? '原件与分块已经持久化；保存后文档为待索引，不会创建模拟向量任务。' : '完成后，可在检索测试中验证，再关联到问答应用。'}</p><Descriptions bordered column={1} items={[{ key: 'kb', label: '目标知识库', children: kb.name }, { key: 'files', label: '文件数量', children: `${valid.length} 份` }, { key: 'size', label: '分块参数', children: `${size} 字符 / 重叠 ${overlap} 字符` }, { key: 'model', label: 'Embedding', children: kb.embedding }]} /><Alert className="space-top" type={remoteBatch ? 'info' : 'success'} showIcon title={remoteBatch ? '本步骤仅确认并刷新服务端数据；真实 Embedding 与向量索引尚未接入。' : '任务会在后台模拟处理，关闭面板后可继续查看进度。'} /></div>}</div>
  </Drawer>
}

function CitationDrawer({ chunk, onClose }: { chunk: HubChunk | null; onClose: () => void }) {
  const { state } = useHub(); const doc = state.documents.find((d) => d.id === chunk?.documentId)
  return <Drawer title="引用来源" open={Boolean(chunk)} size={520} onClose={onClose}>{chunk && <><div className="source-heading"><FileIcon kind={doc?.kind || 'PDF'} /><div><h3>{doc?.name || '文档已删除'}</h3><p>第 {chunk.page} 页 · {chunk.id}</p></div></div><Tag color="blue">{state.knowledge.find((kb) => kb.id === chunk.kbId)?.name}</Tag><article className="source-block"><h3>{chunk.title}</h3><p>{chunk.text}</p></article><Alert type="info" showIcon title="来源定位" description={`本段来自文档第 ${chunk.page} 页；正式版将在原文件中高亮对应位置。`} /></>}</Drawer>
}

function Applications() {
  const { state, role, setState } = useHub(); const navigate = useNavigate(); const { message } = AntApp.useApp(); const [search, setSearch] = useState(''); const [editing, setEditing] = useState<HubAssistant | 'new' | null>(null); const [form] = Form.useForm()
  const apps = state.assistants.filter((a) => (role === 'admin' || (role === 'manager' ? a.managed : a.published)) && a.name.includes(search))
  const edit = (app: HubAssistant | 'new') => { setEditing(app); form.resetFields(); form.setFieldsValue(app === 'new' ? { name: '', description: '', kbIds: [], model: availableModels(state, 'LLM')[0]?.value, prompt: '请仅依据提供的知识内容回答，缺乏依据时明确说明，并标注引用来源。', topK: 5, threshold: 0.35, rerank: true, published: false } : app) }
  const save = async () => { const values = await form.validateFields(); const app = { ...values, id: editing === 'new' ? uid('assistant') : (editing as HubAssistant).id, managed: true }; if (app.published && app.kbIds.some((id: string) => !state.knowledge.find((kb) => kb.id === id)?.published)) { message.error('发布前请先将所有关联知识库设置为允许问答应用使用'); return } if (app.published && !app.kbIds.some((id: string) => state.chunks.some((c) => c.kbId === id && c.indexed))) { message.error('发布前至少需要一个包含已索引分块的知识库'); return } setState((s) => ({ ...s, assistants: editing === 'new' ? [...s.assistants, app] : s.assistants.map((a) => a.id === app.id ? app : a) })); setEditing(null); message.success('问答应用已保存') }
  return <div className="page"><Heading title="问答应用" description="为不同业务场景配置专属助手，连接知识、模型和回答策略。" actions={role !== 'user' && <Button type="primary" icon={<PlusOutlined />} onClick={() => edit('new')}>创建问答应用</Button>} /><div className="knowledge-toolbar"><Input prefix={<SearchOutlined />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索问答应用" allowClear /><span>{role === 'user' ? '可使用的应用' : '全部应用'} <b>{apps.length}</b></span></div><div className="application-grid">{apps.map((app) => <article className="assistant-card" key={app.id}><div className="assistant-card-top"><span className="app-avatar large"><RobotOutlined /></span><Tag color={app.published ? 'success' : 'default'}>{app.published ? '已发布' : '草稿'}</Tag></div><h3>{app.name}</h3><p>{app.description}</p><div className="assistant-kbs">{app.kbIds.map((id) => <Tag key={id} icon={<DatabaseOutlined />}>{state.knowledge.find((kb) => kb.id === id)?.name || '知识库已删除'}</Tag>)}</div><div className="assistant-model"><ApiOutlined /> {app.model}<span>{app.rerank ? 'Rerank 已启用' : '未启用重排'}</span></div><div className="assistant-actions">{role !== 'user' && <Button icon={<SettingOutlined />} onClick={() => edit(app)}>配置应用</Button>}<Button type={app.published ? 'primary' : 'default'} disabled={!app.published} icon={<MessageOutlined />} onClick={() => navigate(`/chat?assistant=${app.id}`)}>{app.published ? '开始对话' : '发布后可使用'}</Button></div></article>)}</div>{!apps.length && <Empty description="暂无可使用的问答应用" />}<Drawer title={editing === 'new' ? '创建问答应用' : '配置问答应用'} open={Boolean(editing)} onClose={() => setEditing(null)} size={580} extra={<Button type="primary" onClick={save}>保存应用</Button>}><Form form={form} layout="vertical"><Form.Item name="name" label="应用名称" rules={[{ required: true, whitespace: true, message: '请输入应用名称' }, { max: 30 }]}><Input placeholder="例如：员工服务助手" /></Form.Item><Form.Item name="description" label="应用介绍"><Input.TextArea rows={2} /></Form.Item><Divider titlePlacement="start">知识与模型</Divider><Form.Item name="kbIds" label="关联知识库" rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个知识库' }]}><Select mode="multiple" options={accessibleKbs(state, role).map((kb) => ({ value: kb.id, label: kb.name }))} /></Form.Item><Form.Item name="model" label="LLM 模型" rules={[{ required: true }]}><Select options={availableModels(state, 'LLM')} /></Form.Item><Form.Item name="prompt" label="系统提示词" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item><Divider titlePlacement="start">检索与发布</Divider><div className="two-fields"><Form.Item name="topK" label="召回数量 Top K"><InputNumber min={1} max={20} /></Form.Item><Form.Item name="threshold" label="最低相似度"><InputNumber min={0} max={1} step={0.05} /></Form.Item></div><Form.Item name="rerank" valuePropName="checked" label="启用 Rerank"><Switch /></Form.Item><Form.Item name="published" valuePropName="checked" label="发布到在线对话"><Switch /></Form.Item><Alert type="info" showIcon title="发布后，使用者可在在线对话中选择此助手。" /></Form></Drawer></div>
}

function OnlineChat() {
  const { state, setState, role } = useHub(); const [params] = useSearchParams(); const { message } = AntApp.useApp(); const apps = state.assistants.filter((a) => a.published)
  const [appId, setAppId] = useState(params.get('assistant') || apps[0]?.id || ''); const [sessionId, setSessionId] = useState(''); const [input, setInput] = useState(''); const [stage, setStage] = useState(''); const [source, setSource] = useState<HubChunk | null>(null); const timers = useRef<number[]>([]); const bottom = useRef<HTMLDivElement>(null)
  const app = apps.find((a) => a.id === appId); const session = state.sessions.find((s) => s.id === sessionId)
  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [session?.messages.length, stage])
  const stop = () => { timers.current.forEach(window.clearTimeout); timers.current = []; setStage(''); message.info('已停止生成，可以重新提问') }
  const chooseApp = (id: string) => { stopTimers(); setAppId(id); setSessionId('') }
  const stopTimers = () => { timers.current.forEach(window.clearTimeout); timers.current = []; setStage('') }
  const send = (question = input) => {
    if (!question.trim() || !app || stage) return
    const results = retrieveChunks(state, app.kbIds, question, app.topK, app.threshold, app.rerank); const sid = sessionId || uid('session'); const userMessage = { id: uid('msg'), role: 'user' as const, text: question.trim(), citationIds: [] }
    setState((s) => ({ ...s, sessions: sessionId ? s.sessions.map((item) => item.id === sid ? { ...item, messages: [...item.messages, userMessage] } : item) : [...s.sessions, { id: sid, assistantId: app.id, title: question.trim().slice(0, 22), messages: [userMessage] }] })); setSessionId(sid); setInput(''); setStage('正在检索知识库…')
    timers.current.push(window.setTimeout(() => setStage(app.rerank ? '正在重排相关片段…' : '正在组织回答…'), 350))
    timers.current.push(window.setTimeout(() => setStage('正在组织回答…'), 750))
    timers.current.push(window.setTimeout(() => {
      const text = results.length ? `根据「${results[0].title}」中的资料：\n\n${results[0].text}${results[1] ? `\n\n补充依据：${results[1].text}` : ''}` : '当前应用关联的知识库中没有找到足够依据。建议补充相关资料，或换一种问法后再试。'
      const output = Math.ceil(text.length * 1.5); const inputTokens = question.length + results.reduce((n, c) => n + c.text.length, 0)
      setState((s) => ({ ...s, sessions: s.sessions.map((item) => item.id === sid ? { ...item, messages: [...item.messages, { id: uid('msg'), role: 'assistant', text, citationIds: results.slice(0, 2).map((r) => r.id), tokens: inputTokens + output, duration: 1.4 }] } : item), logs: [{ id: uid('req'), kbId: results[0]?.kbId || app.kbIds[0], kbIds: app.kbIds, query: question.trim(), answer: text, model: app.model, input: inputTokens, output, duration: 1.4, time: timestamp(), citations: Math.min(2, results.length), role: ROLE_LABELS[role] }, ...s.logs] })); setStage(''); timers.current = []
    }, 1400))
  }
  return <div className="chat-page"><aside className="session-sidebar"><Button type="primary" icon={<PlusOutlined />} block onClick={() => { stopTimers(); setSessionId('') }}>新建对话</Button><span className="session-label">历史会话</span>{state.sessions.length ? [...state.sessions].reverse().map((item) => <div className={`session-item ${sessionId === item.id ? 'selected' : ''}`} key={item.id}><button onClick={() => { stopTimers(); setSessionId(item.id); setAppId(item.assistantId) }}><MessageOutlined /><span>{item.title}</span></button><Popconfirm title="删除此会话？" onConfirm={() => { if (sessionId === item.id) { stopTimers(); setSessionId('') } setState((s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== item.id) })) }}><Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`删除会话${item.title}`} /></Popconfirm></div>) : <p className="muted session-tip">开始提问后，会话会保存在这里。</p>}<div className="session-bottom"><InfoCircleOutlined /> 回答可回溯至知识原文</div></aside>
    <section className="chat-main"><div className="chat-toolbar"><div><b>{app?.name || '在线对话'}</b><small><Badge status="success" /> {app?.model || '选择问答应用'} · 知识问答</small></div><Select value={appId || undefined} onChange={chooseApp} placeholder="选择问答应用" aria-label="选择问答应用" options={apps.map((a) => ({ value: a.id, label: a.name }))} /></div><div className="chat-scroll">{!session?.messages.length ? <div className="chat-empty"><span className="chat-empty-icon"><RobotOutlined /></span><span className="eyebrow">GROUNDED IN YOUR KNOWLEDGE</span><h1>{app ? `你好，我是${app.name}` : '选择一个已发布的问答应用'}</h1><p>{app?.description || '请先在问答应用模块完成配置并发布。'}</p><div className="chat-kbs">{app?.kbIds.map((id) => <Tag icon={<DatabaseOutlined />} key={id}>{state.knowledge.find((k) => k.id === id)?.name}</Tag>)}</div>{app && <div className="suggestion-grid">{(app.kbIds.includes('cuisine') ? ['过桥米线有哪些主要食材？', '汽锅鸡使用什么器皿烹制？', '福建饮食文化有什么特点？'] : ['差旅住宿的费用标准是什么？', '报销需要准备哪些材料？', '婚假需要提前多久申请？']).map((q) => <button key={q} onClick={() => send(q)}><MessageOutlined /><span>{q}</span><ArrowRightOutlined /></button>)}</div>}</div> : <div className="messages">{session.messages.map((item) => <div className={`message ${item.role}`} key={item.id}><Avatar icon={item.role === 'user' ? <UserOutlined /> : <RobotOutlined />} /><div className="message-content"><span className="message-author">{item.role === 'user' ? '你' : app?.name}</span><div className="message-text">{item.text}</div>{item.role === 'assistant' && <><div className="citation-buttons">{item.citationIds.map((id, i) => { const chunk = state.chunks.find((c) => c.id === id); return <Button key={id} size="small" icon={<LinkOutlined />} onClick={() => chunk ? setSource(chunk) : message.info('该来源已被移除')}>[{i + 1}] {state.documents.find((d) => d.id === chunk?.documentId)?.name || '来源已删除'}</Button> })}</div><div className="message-usage"><CopyButton text={item.text} /><span>{item.tokens} Tokens · {item.duration} 秒 · 演示回答</span></div></>}</div></div>)}{stage && <div className="chat-stage" role="status"><Spin size="small" /><span>{stage}</span></div>}<div ref={bottom} /></div>}</div><div className="composer-area"><div className="composer"><Input.TextArea aria-label="输入问题" value={input} onChange={(e) => setInput(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={app ? '输入问题，Enter 发送，Shift + Enter 换行' : '请先选择已发布的问答应用'} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} /><div className="composer-bottom"><span><DatabaseOutlined /> {app?.kbIds.length || 0} 个知识库已关联</span>{stage ? <Button icon={<StopOutlined />} onClick={stop}>停止生成</Button> : <Button type="primary" icon={<SendOutlined />} disabled={!input.trim() || !app} onClick={() => send()}>发送</Button>}</div></div><p>当前为原型演示回答 · 正式版接入 LangChain 与你配置的 LLM · 请核对来源依据</p></div></section><CitationDrawer chunk={source} onClose={() => setSource(null)} /></div>
}

function CopyButton({ text }: { text: string }) {
  const { message } = AntApp.useApp()
  return <Button type="text" size="small" icon={<CopyOutlined />} aria-label="复制回答" onClick={async () => { try { await navigator.clipboard.writeText(text); message.success('已复制') } catch { message.info('浏览器不支持自动复制，请选中文字复制') } }} />
}

function ModelServices() {
  const { state, setState } = useHub(); const { message } = AntApp.useApp(); const [type, setType] = useState('all'); const [provider, setProvider] = useState<HubProvider | null>(null); const [editingModel, setEditingModel] = useState<HubModel | 'new' | null>(null); const [testing, setTesting] = useState<string | null>(null); const [form] = Form.useForm(); const [providerForm] = Form.useForm()
  const [remoteProviders, setRemoteProviders] = useState<ProviderDto[]>([]); const [remoteModels, setRemoteModels] = useState<ModelDto[]>([]); const [connected, setConnected] = useState(false); const [loading, setLoading] = useState(true); const [connectionError, setConnectionError] = useState('')
  const refresh = async () => {
    setLoading(true)
    try {
      const [nextProviders, nextModels] = await Promise.all([hubApi.listProviders(), hubApi.listModels()])
      setRemoteProviders(nextProviders); setRemoteModels(nextModels); setConnected(true); setConnectionError('')
    } catch (error) { setConnected(false); setConnectionError(apiErrorMessage(error)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const providers: HubProvider[] = connected ? state.providers.flatMap((template): HubProvider[] => {
    const matches = remoteProviders.filter((item) => item.kind === template.id)
    if (!matches.length) return [{ ...template, id: `new-${template.id}`, kind: template.id as NonNullable<HubProvider['kind']>, configured: false }]
    return matches.map((item) => ({ id: item.id, kind: item.kind, name: item.name, url: item.base_url, configured: item.configured, enabled: item.enabled, latency: 0 }))
  }) : state.providers
  const models: HubModel[] = connected ? remoteModels.map((item) => ({ id: item.id, providerId: item.provider_id, name: item.remote_model_id, provider: remoteProviders.find((p) => p.id === item.provider_id)?.name || '未知服务商', type: item.capability, dimension: item.dimensions || undefined, enabled: item.enabled })) : state.models
  const test = async (record: HubProvider | HubModel) => {
    setTesting(record.id)
    try {
      if (connected) {
        if (record.id.startsWith('new-')) { message.warning('请先保存服务商配置'); return }
        const result = 'configured' in record ? await hubApi.testProvider(record.id) : await hubApi.testModel(record.id)
        message.success(`真实连接测试通过 · ${result.duration_ms} ms`)
      } else {
        const p = 'configured' in record ? record : providers.find((item) => item.name === record.provider)
        if (!p?.configured) message.warning('请先完成服务商配置')
        else message.warning('后端未连接，本次未发起模型测试')
      }
    } catch (error) { message.error(apiErrorMessage(error)) }
    finally { setTesting(null) }
  }
  const openProvider = (record: HubProvider) => { setProvider(record); providerForm.resetFields(); providerForm.setFieldsValue({ name: record.name, url: record.url }) }
  const openModel = (model: HubModel | 'new') => { setEditingModel(model); form.resetFields(); form.setFieldsValue(model === 'new' ? { type: 'LLM', provider: providers.find((p) => p.configured && !p.id.startsWith('new-'))?.name, enabled: true, dimension: 1024 } : model) }
  const saveProvider = async () => {
    const values = await providerForm.validateFields()
    try {
      if (connected && provider) {
        if (provider.id.startsWith('new-')) await hubApi.createProvider({ kind: provider.kind!, name: values.name, base_url: values.url, api_key: values.key })
        else await hubApi.patchProvider(provider.id, { base_url: values.url, ...(values.key ? { api_key: values.key } : {}) })
        await refresh(); message.success('服务商配置已保存，密钥由后端加密保管')
      } else {
        setState((s) => ({ ...s, providers: s.providers.map((p) => p.id === provider?.id ? { ...p, url: values.url, configured: p.configured || Boolean(values.key), latency: 300 } : p) }))
        message.success('已保存到本机演示，未发起云端请求')
      }
      providerForm.resetFields(); setProvider(null)
    } catch (error) { message.error(apiErrorMessage(error)) }
  }
  const saveModel = async () => {
    const values = await form.validateFields(); values.name = values.name.trim(); const currentId = editingModel === 'new' ? '' : (editingModel as HubModel).id
    if (models.some((model) => model.id !== currentId && model.name === values.name)) { message.warning('模型名称已存在，请勿重复配置'); return }
    const dependents = editingModel !== 'new' && editingModel ? getModelDependents(state, editingModel) : []
    if (editingModel !== 'new' && editingModel && dependents.length && (values.name !== editingModel.name || values.type !== editingModel.type || values.dimension !== editingModel.dimension || !values.enabled)) { message.warning(`模型正被${dependents.join('、')}使用，不能更改名称、类型、向量维度或停用；请先切换相关配置`); return }
    try {
      if (connected) {
        if (editingModel === 'new') {
          const selectedProvider = providers.find((p) => p.name === values.provider && !p.id.startsWith('new-'))
          if (!selectedProvider) { message.warning('请先保存服务商配置'); return }
          await hubApi.createModel({ provider_id: selectedProvider.id, remote_model_id: values.name, capability: values.type, ...(values.type === 'Embedding' ? { dimensions: values.dimension } : {}), enabled: values.enabled })
        } else await hubApi.patchModel(currentId, values.enabled)
        await refresh(); message.success('模型配置已保存到后端')
      } else {
        const model = { ...values, id: currentId || uid('model') }
        setState((s) => ({ ...s, models: editingModel === 'new' ? [...s.models, model] : s.models.map((m) => m.id === model.id ? model : m) }))
        message.success('模型已保存到本机演示')
      }
      setEditingModel(null)
    } catch (error) { message.error(apiErrorMessage(error)) }
  }
  const toggleModel = async (model: HubModel, enabled: boolean) => {
    const dependents = !enabled ? getModelDependents(state, model) : []
    if (dependents.length) { message.warning(`模型正被${dependents.join('、')}使用，请先切换相关配置`); return }
    try {
      if (connected) { await hubApi.patchModel(model.id, enabled); await refresh() }
      else setState((s) => ({ ...s, models: s.models.map((m) => m.id === model.id ? { ...m, enabled } : m) }))
    } catch (error) { message.error(apiErrorMessage(error)) }
  }
  const deleteModel = async (model: HubModel) => {
    const dependents = getModelDependents(state, model)
    if (dependents.length) { message.warning(`模型正被${dependents.join('、')}使用，暂不能删除`); return }
    try {
      if (connected) { await hubApi.deleteModel(model.id); await refresh(); message.success('模型配置已删除') }
      else setState((s) => ({ ...s, models: s.models.filter((m) => m.id !== model.id) }))
    } catch (error) { message.error(apiErrorMessage(error)) }
  }
  const modelColumns: TableColumnsType<HubModel> = [{ title: '模型名称 / ID', dataIndex: 'name', render: (name: string) => <b>{name}</b>, width: 250 }, { title: '类型', dataIndex: 'type', width: 130, render: (value) => <Tag color={value === 'LLM' ? 'blue' : value === 'Embedding' ? 'cyan' : 'purple'}>{value}</Tag> }, { title: '服务商', dataIndex: 'provider', width: 150 }, { title: '规格', width: 140, render: (_, model) => model.type === 'Embedding' ? `${model.dimension} 维` : model.type === 'LLM' ? '文本生成' : '相关性重排' }, { title: '启用', width: 85, render: (_, model) => <Switch size="small" checked={model.enabled} onChange={(enabled) => { void toggleModel(model, enabled) }} /> }, { title: '操作', width: 190, render: (_, model) => <Space size={0}><Button type="link" loading={testing === model.id} onClick={() => { void test(model) }}>测试</Button><Button type="link" onClick={() => openModel(model)}>编辑</Button><Popconfirm title="确认移除此模型？" onConfirm={() => { void deleteModel(model) }}><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除模型${model.name}`} /></Popconfirm></Space> }]
  return <div className="page"><Heading title="模型服务" description="统一管理模型服务商，按能力配置 LLM、Embedding 与 Rerank。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => openModel('new')}>添加模型</Button>} /><Alert className="space-bottom" showIcon type={connected ? 'success' : loading ? 'info' : 'warning'} title={connected ? '已连接 FastAPI，配置与测试均调用真实后端' : loading ? '正在连接后端…' : '后端未连接，当前为本机演示模式'} description={connected ? 'API Key 仅提交并加密保存在服务端；连接测试会产生少量真实模型调用。' : connectionError || '正在读取服务商与模型配置。'} action={<Button size="small" loading={loading} onClick={() => { void refresh() }}>重新连接</Button>} /><div className="provider-grid">{providers.map((p, i) => <Card key={p.id}><div className="provider-card-title"><span className={`provider-avatar provider-${i}`}>{p.kind === 'openrouter' || (!p.kind && i === 1) ? 'OR' : p.kind === 'aihubmix' || (!p.kind && i === 2) ? 'AI' : '通'}</span><div><h3>{p.name}</h3><Badge status={p.configured ? 'success' : 'default'} text={p.configured ? `已配置 · ${connected ? '后端' : '本机演示'}` : '待配置'} /></div><Button type="text" icon={<SettingOutlined />} aria-label={`配置${p.name}`} onClick={() => openProvider(p)} /></div><p className="provider-url">{p.url}</p><div className="provider-card-footer"><span>{models.filter((m) => m.provider === p.name).length} 个模型</span><Button size="small" loading={testing === p.id} icon={<ThunderboltOutlined />} onClick={() => { void test(p) }}>测试连接</Button></div></Card>)}</div><Card className="table-card" title="模型配置" extra={<Select value={type} onChange={setType} options={['all', 'LLM', 'Embedding', 'Rerank'].map((value) => ({ value, label: value === 'all' ? '全部模型类型' : value }))} />}><Table rowKey="id" dataSource={models.filter((m) => type === 'all' || m.type === type)} columns={modelColumns} pagination={false} loading={loading} scroll={{ x: 950 }} /></Card><Drawer title={`配置 ${provider?.name || '服务商'}`} open={Boolean(provider)} onClose={() => setProvider(null)} size={480} extra={<Button type="primary" onClick={() => { void saveProvider() }}>保存配置</Button>}><Form form={providerForm} layout="vertical"><Form.Item name="name" label="服务商"><Input disabled /></Form.Item><Form.Item name="url" label="Base URL" rules={[{ required: true }, { type: 'url', message: '请输入有效的服务地址' }]}><Input /></Form.Item><Form.Item name="key" label="API Key" rules={[{ required: !provider?.configured, message: '请输入 API Key' }]}><Input.Password placeholder={provider?.configured ? '•••••••• 已配置，留空保留' : connected ? '输入真实 API Key' : '输入演示密钥'} autoComplete="new-password" /></Form.Item><Alert type="info" showIcon title={connected ? '服务端密钥保管' : '本机配置演示'} description={connected ? '密钥仅通过 HTTPS 同源 API 提交给 FastAPI，并使用部署主密钥加密保存；不会写入浏览器存储。' : '后端未连接，密钥输入仅用于演示校验，不会保存或发起请求。'} /></Form></Drawer><Drawer title={editingModel === 'new' ? '添加模型' : '编辑模型'} open={Boolean(editingModel)} onClose={() => setEditingModel(null)} size={480} extra={<Button type="primary" onClick={() => { void saveModel() }}>保存模型</Button>}><Form form={form} layout="vertical"><Form.Item name="name" label="模型名称 / API 模型 ID" rules={[{ required: true, whitespace: true }]}><Input placeholder="服务商提供的模型 ID" disabled={connected && editingModel !== 'new'} /></Form.Item><Form.Item name="provider" label="服务商" rules={[{ required: true }]}><Select options={providers.filter((p) => !connected || (p.configured && !p.id.startsWith('new-'))).map((p) => ({ value: p.name, label: p.name }))} disabled={connected && editingModel !== 'new'} /></Form.Item><Form.Item name="type" label="模型类型"><Select options={['LLM', 'Embedding', 'Rerank'].map((value) => ({ value, label: value }))} disabled={connected && editingModel !== 'new'} /></Form.Item><Form.Item noStyle shouldUpdate={(prev, next) => prev.type !== next.type}>{({ getFieldValue }) => getFieldValue('type') === 'Embedding' ? <Form.Item name="dimension" label="向量维度" rules={[{ required: true }]}><InputNumber min={1} max={16384} disabled={connected && editingModel !== 'new'} /></Form.Item> : null}</Form.Item><Form.Item name="enabled" valuePropName="checked" label="启用模型"><Switch /></Form.Item></Form></Drawer></div>
}

function RunLogs() {
  const { state, role } = useHub(); const [query, setQuery] = useState(''); const [kbId, setKbId] = useState('all'); const [selected, setSelected] = useState<HubLog | null>(null); const kbs = accessibleKbs(state, role)
  const scoped = state.logs.filter((log) => logKnowledgeIds(log).every((id) => kbs.some((kb) => kb.id === id))); const logs = scoped.filter((log) => log.query.includes(query) && (kbId === 'all' || logKnowledgeIds(log).includes(kbId))); const total = scoped.reduce((sum, log) => sum + log.input + log.output, 0)
  const columns: TableColumnsType<HubLog> = [{ title: '时间', dataIndex: 'time', width: 170 }, { title: '查询内容', dataIndex: 'query', ellipsis: true, width: 290 }, { title: '知识库', width: 220, render: (_, log) => logKnowledgeIds(log).map((id) => state.knowledge.find((kb) => kb.id === id)?.name || '已删除知识库').join('、') }, { title: '模型', dataIndex: 'model', width: 130 }, { title: '输入 / 输出 Tokens', width: 160, render: (_, log) => `${number(log.input)} / ${number(log.output)}` }, { title: '耗时', width: 90, render: (_, log) => `${log.duration} 秒` }, { title: '详情', width: 80, fixed: 'right', render: (_, log) => <Button type="link" onClick={() => setSelected(log)}>查看</Button> }]
  return <div className="page"><Heading title="运行日志" description="追踪每次问答的查询内容、知识来源、Token 消耗与响应耗时。" actions={<Tag>原型本机记录</Tag>} />{role === 'manager' && <Alert className="space-bottom" type="info" showIcon title="仅显示你管理的知识库相关记录" />}<Metrics items={[{ label: '问答请求', value: scoped.length, icon: <MessageOutlined /> }, { label: '累计 Tokens', value: number(total), icon: <NodeIndexOutlined /> }, { label: '平均响应', value: `${(scoped.reduce((n, l) => n + l.duration, 0) / (scoped.length || 1)).toFixed(2)} 秒`, icon: <HistoryOutlined /> }, { label: '来源引用', value: scoped.reduce((n, log) => n + log.citations, 0), icon: <LinkOutlined /> }]} /><Card className="table-card" styles={{ body: { padding: 0 } }}><div className="table-toolbar"><Space><Input prefix={<SearchOutlined />} placeholder="搜索查询内容" value={query} onChange={(e) => setQuery(e.target.value)} allowClear /><Select value={kbId} onChange={setKbId} options={[{ value: 'all', label: '全部知识库' }, ...kbs.map((kb) => ({ value: kb.id, label: kb.name }))]} /></Space><Button onClick={() => { setQuery(''); setKbId('all') }}>重置筛选</Button></div><Table rowKey="id" columns={columns} dataSource={logs} scroll={{ x: 1120 }} pagination={{ pageSize: 8 }} /></Card><Drawer title="请求链路详情" size={560} open={Boolean(selected)} onClose={() => setSelected(null)}>{selected && <><Descriptions column={1} size="small" items={[{ key: 'id', label: '请求 ID', children: selected.id }, { key: 'time', label: '请求时间', children: selected.time }, { key: 'role', label: '体验角色', children: selected.role }, { key: 'model', label: 'LLM 模型', children: selected.model }]} /><Divider titlePlacement="start">问题与回答</Divider><h4>{selected.query}</h4><p className="log-answer">{selected.answer}</p><Divider titlePlacement="start">消耗与耗时</Divider><div className="log-stats"><Statistic title="输入 Tokens" value={selected.input} /><Statistic title="输出 Tokens" value={selected.output} /><Statistic title="总耗时" value={selected.duration} suffix="秒" /></div><Alert className="space-top" type="info" showIcon title="Token 数由前端演示估算，正式版以服务商返回用量为准。" /></>}</Drawer></div>
}
