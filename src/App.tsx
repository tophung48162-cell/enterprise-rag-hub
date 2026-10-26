import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Progress,
  Radio,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { TableColumnsType, UploadFile } from 'antd'
import {
  ApiOutlined,
  ArrowLeftOutlined,
  AuditOutlined,
  BookOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DownOutlined,
  EditOutlined,
  ExperimentOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FilterOutlined,
  HistoryOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  LeftOutlined,
  LinkOutlined,
  LoadingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoreOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  SlidersOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { documents, knowledgeBases, logs, models, providers } from './mockData'
import {
  canAccessPath,
  getAccessibleMenuItems,
  getDefaultRoute,
  persistRole,
  readStoredRole,
  ROLE_LABELS,
  ROLE_OPTIONS,
} from './permissions'
import type {
  DocumentRecord,
  KnowledgeBase,
  KnowledgeStatus,
  ModelRecord,
  ProviderRecord,
  Role,
  RunLog,
} from './types'
import './styles.css'

const { Header, Sider, Content } = Layout
const { Text, Title, Paragraph } = Typography
const { TextArea } = Input
const { Dragger } = Upload

const menuIcons: Record<string, React.ReactNode> = {
  chat: <MessageOutlined />,
  knowledge: <BookOutlined />,
  models: <ApiOutlined />,
  logs: <AuditOutlined />,
}

const statusMap: Record<KnowledgeStatus, { color: string; label: string }> = {
  ready: { color: 'success', label: '可用' },
  indexing: { color: 'processing', label: '正在建立索引' },
  failed: { color: 'error', label: '处理失败' },
}

function StatusTag({ status }: { status: KnowledgeStatus }) {
  const item = statusMap[status]
  return <Tag color={item.color}>{item.label}</Tag>
}

function PageHeader({
  title,
  description,
  extra,
  eyebrow,
}: {
  title: string
  description: string
  extra?: React.ReactNode
  eyebrow?: React.ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <Title level={2}>{title}</Title>
        <Text type="secondary">{description}</Text>
      </div>
      {extra && <div className="page-header-extra">{extra}</div>}
    </div>
  )
}

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

const breadcrumbName = (pathname: string) => {
  if (pathname.startsWith('/knowledge/') && pathname.endsWith('/import')) return ['知识库', '导入知识']
  if (pathname.startsWith('/knowledge/')) return ['知识库', '企业制度知识库']
  if (pathname.startsWith('/knowledge')) return ['知识库']
  if (pathname.startsWith('/models')) return ['模型服务']
  if (pathname.startsWith('/logs')) return ['运行日志']
  return ['在线对话']
}

function AppShell({ role, onRoleChange }: { role: Role; onRoleChange: (role: Role) => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const screens = Grid.useBreakpoint()
  const navigate = useNavigate()
  const location = useLocation()
  const menuItems = getAccessibleMenuItems(role).map((item) => ({
    key: item.path,
    icon: menuIcons[item.key],
    label: item.label,
  }))
  const selected = menuItems.find((item) => location.pathname.startsWith(item.key))?.key ?? '/chat'

  useEffect(() => {
    if (screens.lg === false) setCollapsed(true)
  }, [screens.lg])

  return (
    <Layout className="app-shell">
      <Sider
        theme="light"
        width={224}
        collapsedWidth={64}
        collapsed={collapsed}
        className="app-sider"
        trigger={null}
      >
        <button className="brand" onClick={() => navigate('/chat')} aria-label="返回在线对话">
          <LogoMark />
          {!collapsed && (
            <span className="brand-copy">
              <strong>知汇</strong>
              <small>企业知识中台</small>
            </span>
          )}
        </button>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          className="main-menu"
        />
        <div className="sider-footer">
          {!collapsed && (
            <div className="prototype-note">
              <ExperimentOutlined />
              <span>1.0 前端原型</span>
            </div>
          )}
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? '展开导航' : '收起导航'}
          />
        </div>
      </Sider>
      <Layout>
        <Header className="topbar">
          <Breadcrumb items={breadcrumbName(location.pathname).map((title) => ({ title }))} />
          <Space size={12}>
            <Tooltip title="当前版本未接入登录与真实鉴权，角色切换仅用于体验功能范围。">
              <Tag color="cyan" icon={<ExperimentOutlined />}>体验模式</Tag>
            </Tooltip>
            <Select
              aria-label="切换体验角色"
              value={role}
              options={ROLE_OPTIONS}
              onChange={onRoleChange}
              popupMatchSelectWidth={180}
              className="role-select"
              suffixIcon={<DownOutlined />}
            />
          </Space>
        </Header>
        <Content className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to={getDefaultRoute(role)} replace />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/knowledge" element={<Guard role={role}><KnowledgePage role={role} /></Guard>} />
            <Route path="/knowledge/:id" element={<Guard role={role}><KnowledgeDetail /></Guard>} />
            <Route path="/knowledge/:id/import" element={<Guard role={role}><ImportWizard /></Guard>} />
            <Route path="/models" element={<Guard role={role}><ModelsPage /></Guard>} />
            <Route path="/logs" element={<Guard role={role}><LogsPage role={role} /></Guard>} />
            <Route path="*" element={<Navigate to={getDefaultRoute(role)} replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

function Guard({ role, children }: { role: Role; children: React.ReactNode }) {
  const location = useLocation()
  if (!canAccessPath(role, location.pathname)) return <Navigate to="/chat" replace />
  return children
}

type Citation = {
  id: number
  file: string
  location: string
  heading: string
  content: string
  vectorScore: number
  rerankScore: number
}

const citations: Citation[] = [
  {
    id: 1,
    file: '员工休假与考勤管理制度.pdf',
    location: '第 12 页 · Chunk #086',
    heading: '第三章 / 假期管理 / 婚假',
    content: '员工申请婚假，应至少提前 3 个工作日在 OA 系统提交申请，并上传结婚证原件扫描件。直属负责人审批后，由人力资源部复核备案。',
    vectorScore: 0.86,
    rerankScore: 0.94,
  },
  {
    id: 2,
    file: '新员工入职指南.md',
    location: '假期申请 · Chunk #031',
    heading: '员工服务 / 常用流程',
    content: '婚假申请路径：工作台 → 人事服务 → 假勤申请。申请人应确认结婚登记日期符合公司婚假有效期规定。',
    vectorScore: 0.74,
    rerankScore: 0.87,
  },
]

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citationIds?: number[]
}

const initialMessages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '员工请婚假需要提前多久申请？需要哪些材料？' },
  {
    id: 'a1',
    role: 'assistant',
    content: '根据现行制度，婚假应至少提前 3 个工作日在 OA 系统提交。申请时需要上传结婚证扫描件，经直属负责人审批后由人力资源部复核备案。建议同时核对结婚登记日期是否在公司规定的有效期内。',
    citationIds: [1, 2],
  },
]

function ChatPage() {
  const { message } = AntApp.useApp()
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [selectedKbs, setSelectedKbs] = useState<string[]>(['company-policy'])
  const [stage, setStage] = useState<'idle' | 'retrieving' | 'generating'>('idle')
  const [citation, setCitation] = useState<Citation | null>(null)
  const timers = useRef<number[]>([])

  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  const stopGeneration = () => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    setStage('idle')
    message.info('已停止生成，已保留本轮问题')
  }

  const send = (preset?: string) => {
    const question = (preset ?? input).trim()
    if (!question || stage !== 'idle') return
    if (selectedKbs.length === 0) {
      message.warning('请先选择至少一个知识库')
      return
    }
    setMessages((items) => [...items, { id: `u-${Date.now()}`, role: 'user', content: question }])
    setInput('')
    setStage('retrieving')
    timers.current.push(window.setTimeout(() => setStage('generating'), 650))
    timers.current.push(window.setTimeout(() => {
      setMessages((items) => [
        ...items,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: '依据《员工休假与考勤管理制度》，该事项需先在 OA 发起申请，并提交对应证明材料。审批完成后由人力资源部复核；如遇特殊情况，建议同时联系直属负责人确认。',
          citationIds: [1, 2],
        },
      ])
      setStage('idle')
      timers.current = []
    }, 1450))
  }

  return (
    <div className="chat-page page-full-bleed">
      <aside className="conversation-sidebar">
        <Button type="primary" icon={<PlusOutlined />} block onClick={() => setMessages([])}>
          新建对话
        </Button>
        <Input prefix={<SearchOutlined />} placeholder="搜索历史会话" allowClear />
        <Text className="section-label">今天</Text>
        {['婚假申请需要哪些材料', '差旅住宿标准怎么查', '信息安全事件如何上报'].map((item, index) => (
          <button
            key={item}
            className={`conversation-item ${index === 0 && messages.length ? 'active' : ''}`}
            onClick={() => setMessages(initialMessages)}
          >
            <MessageOutlined />
            <span>{item}</span>
            <MoreOutlined />
          </button>
        ))}
        <Text className="section-label">7 天内</Text>
        {['采购合同法务复核条件', '客户 429 错误处理'].map((item) => (
          <button key={item} className="conversation-item" onClick={() => setMessages(initialMessages)}>
            <MessageOutlined /><span>{item}</span><MoreOutlined />
          </button>
        ))}
      </aside>
      <section className="chat-workspace">
        <div className="chat-toolbar">
          <div>
            <Text strong className="chat-title">制度咨询</Text>
            <div className="chat-subtitle"><Badge status="success" /> qwen-plus · 回答将附带可追溯依据</div>
          </div>
          <Select
            mode="multiple"
            maxCount={3}
            value={selectedKbs}
            onChange={setSelectedKbs}
            options={knowledgeBases.filter((item) => item.status === 'ready').map((item) => ({ value: item.id, label: item.name }))}
            placeholder="选择知识库"
            className="kb-multi-select"
            aria-label="选择对话知识库"
          />
        </div>
        <div className="message-list" aria-live="polite">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="empty-orbit"><RobotOutlined /></div>
              <Title level={2}>从企业知识中获得答案</Title>
              <Paragraph type="secondary">选择知识库，开始基于企业资料提问。每条答案都可以回溯到原始文件。</Paragraph>
              <div className="prompt-grid">
                {['员工请婚假需要哪些材料？', '差旅住宿标准按城市如何划分？', '信息安全事件应该如何上报？'].map((prompt) => (
                  <button key={prompt} onClick={() => send(prompt)}>
                    <span>{prompt}</span><RightOutlined />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-column">
              {messages.map((item) => (
                <div key={item.id} className={`message-row ${item.role}`}>
                  {item.role === 'assistant' && <Avatar icon={<RobotOutlined />} className="assistant-avatar" />}
                  <div className="message-stack">
                    <div className="message-bubble">
                      <Paragraph>{item.content}</Paragraph>
                      {item.citationIds && (
                        <div className="inline-citations">
                          {item.citationIds.map((id) => (
                            <Button key={id} size="small" onClick={() => setCitation(citations.find((c) => c.id === id) ?? null)}>
                              [{id}]
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                    {item.role === 'assistant' && (
                      <Space size={8} className="message-meta">
                        <Button type="text" size="small" icon={<CopyOutlined />} aria-label="复制回答" />
                        <Button type="text" size="small" icon={<ReloadOutlined />} aria-label="重新生成" />
                        <Text type="secondary">338 Tokens · 2.84 秒</Text>
                        <Button type="link" size="small" onClick={() => setCitation(citations[0])}>查看 2 条依据</Button>
                      </Space>
                    )}
                  </div>
                  {item.role === 'user' && <Avatar icon={<UserOutlined />} className="user-avatar" />}
                </div>
              ))}
              {stage !== 'idle' && (
                <div className="message-row assistant">
                  <Avatar icon={<RobotOutlined />} className="assistant-avatar" />
                  <div className="thinking-card">
                    <Spin indicator={<LoadingOutlined spin />} size="small" />
                    <div>
                      <Text strong>{stage === 'retrieving' ? '正在检索资料…' : '正在组织回答…'}</Text>
                      <Text type="secondary">{stage === 'retrieving' ? '已选择 1 个知识库，正在召回相关分块' : '已召回 8 个分块，正在生成可信回答'}</Text>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="composer-wrap">
          {selectedKbs.length === 0 && <Alert type="warning" showIcon message="请先选择知识库后再提问" />}
          <div className="composer">
            <TextArea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              autoSize={{ minRows: 1, maxRows: 5 }}
              placeholder="请输入问题，Enter 发送，Shift + Enter 换行"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
              aria-label="对话输入"
            />
            {stage === 'idle' ? (
              <Button type="primary" shape="circle" icon={<SendOutlined />} onClick={() => send()} disabled={!input.trim() || selectedKbs.length === 0} aria-label="发送问题" />
            ) : (
              <Button danger shape="circle" icon={<StopOutlined />} onClick={stopGeneration} aria-label="停止生成" />
            )}
          </div>
          <Text type="secondary" className="composer-tip">AI 生成内容可能存在偏差，请以引用原文为准</Text>
        </div>
      </section>
      <Drawer
        title="回答依据"
        width={460}
        open={Boolean(citation)}
        onClose={() => setCitation(null)}
        extra={<Tag color="success">已重排</Tag>}
      >
        {citation && (
          <div className="citation-detail">
            <div className="source-file">
              <FilePdfOutlined />
              <div><Text strong>{citation.file}</Text><Text type="secondary">{citation.location}</Text></div>
            </div>
            <Text type="secondary">{citation.heading}</Text>
            <blockquote>{citation.content}</blockquote>
            <Row gutter={12}>
              <Col span={12}><Card size="small"><Statistic title="向量分数" value={citation.vectorScore} precision={2} /></Card></Col>
              <Col span={12}><Card size="small"><Statistic title="重排分数" value={citation.rerankScore} precision={2} /></Card></Col>
            </Row>
            <Button icon={<EyeOutlined />} block>查看原文位置</Button>
          </div>
        )}
      </Drawer>
    </div>
  )
}

function KnowledgePage({ role }: { role: Role }) {
  const navigate = useNavigate()
  const { message } = AntApp.useApp()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const filtered = knowledgeBases.filter((item) =>
    item.name.includes(search) && (status === 'all' || item.status === status),
  )
  const columns: TableColumnsType<KnowledgeBase> = [
    {
      title: '知识库',
      dataIndex: 'name',
      width: 300,
      render: (_, record) => (
        <button className="table-title-button" onClick={() => navigate(`/knowledge/${record.id}`)}>
          <span className="kb-icon" style={{ '--kb-accent': record.accent } as React.CSSProperties}><DatabaseOutlined /></span>
          <span><strong>{record.name}</strong><small>{record.description}</small></span>
        </button>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 150, render: (value: KnowledgeStatus) => <StatusTag status={value} /> },
    { title: '文档', dataIndex: 'documents', width: 90, render: (value: number) => value.toLocaleString() },
    { title: '分块', dataIndex: 'chunks', width: 100, render: (value: number) => value.toLocaleString() },
    { title: 'Embedding 模型', dataIndex: 'embeddingModel', width: 210, render: (value: string) => <Tag>{value}</Tag> },
    { title: '最近更新', dataIndex: 'updatedAt', width: 130 },
    {
      title: '',
      width: 96,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" onClick={() => navigate(`/knowledge/${record.id}`)}>打开</Button>
          <Dropdown menu={{ items: [{ key: 'settings', label: '设置' }, { key: 'delete', label: '删除', danger: true }] }}>
            <Button type="text" icon={<MoreOutlined />} aria-label={`${record.name}更多操作`} />
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-container">
      <PageHeader
        title="知识库"
        description="导入企业资料，构建可检索、可引用的知识库。"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建知识库</Button>}
      />
      {role === 'manager' && <Alert className="scope-alert" showIcon message="当前仅展示你负责管理的知识库" type="info" />}
      <Row gutter={16} className="metric-row">
        <Col xs={12} md={6}><Card><Statistic title="知识库" value={knowledgeBases.length} suffix="个" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="已入库文档" value={280} suffix="份" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="可检索分块" value={17547} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="今日构建" value={12} suffix="项" /></Card></Col>
      </Row>
      <Card className="surface-card" styles={{ body: { padding: 0 } }}>
        <div className="table-toolbar">
          <Space wrap>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} prefix={<SearchOutlined />} placeholder="搜索知识库" allowClear />
            <Select value={status} onChange={setStatus} options={[
              { value: 'all', label: '全部状态' },
              { value: 'ready', label: '可用' },
              { value: 'indexing', label: '构建中' },
              { value: 'failed', label: '异常' },
            ]} />
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => message.success('列表已刷新')}>刷新</Button>
        </div>
        <Table rowKey="id" columns={columns} dataSource={filtered} pagination={false} scroll={{ x: 1080 }} locale={{ emptyText: <Empty description="没有匹配的知识库" /> }} />
      </Card>
      <Modal
        title="新建知识库"
        open={createOpen}
        okText="创建并导入"
        cancelText="取消"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.validateFields().then(() => {
          setCreateOpen(false)
          message.success('知识库已创建，请继续导入资料')
          navigate('/knowledge/company-policy/import')
        })}
      >
        <Alert message="创建后可以继续导入 Word、PDF、Markdown、图片和表格。" type="info" showIcon />
        <Form form={form} layout="vertical" className="modal-form">
          <Form.Item name="name" label="知识库名称" rules={[{ required: true, message: '请输入知识库名称' }, { min: 2, max: 30 }]}> <Input placeholder="例如：员工制度知识库" /> </Form.Item>
          <Form.Item name="description" label="描述"><TextArea rows={3} maxLength={200} showCount placeholder="说明知识库涵盖的业务范围" /></Form.Item>
          <Form.Item name="embedding" label="Embedding 模型" initialValue="qwen3-embedding-8b" rules={[{ required: true }]}>
            <Select options={[{ value: 'qwen3-embedding-8b', label: 'qwen3-embedding-8b · OpenRouter' }, { value: 'text-embedding-v4', label: 'text-embedding-v4 · 通义百炼' }]} />
          </Form.Item>
          <Form.Item name="rerank" label="Rerank 模型" initialValue="qwen3-rerank">
            <Select allowClear options={[{ value: 'qwen3-rerank', label: 'qwen3-rerank · 通义百炼' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

function fileIcon(type: DocumentRecord['type']) {
  if (type === 'pdf') return <FilePdfOutlined />
  if (type === 'xlsx') return <FileExcelOutlined />
  if (type === 'md') return <FileMarkdownOutlined />
  if (type === 'image') return <FileImageOutlined />
  return <FileTextOutlined />
}

const retrievalResults = [
  {
    id: 1,
    file: '员工休假与考勤管理制度.pdf',
    location: '第 12 页 · Chunk #086',
    content: '员工申请婚假，应至少提前 3 个工作日在 OA 系统提交申请，并上传结婚证原件扫描件。直属负责人审批后，由人力资源部复核备案。',
    vector: 0.86,
    rerank: 0.94,
  },
  {
    id: 2,
    file: '新员工入职指南.md',
    location: '假期申请 · Chunk #031',
    content: '婚假申请路径：工作台 → 人事服务 → 假勤申请。申请人应确认结婚登记日期符合公司婚假有效期规定。',
    vector: 0.74,
    rerank: 0.87,
  },
  {
    id: 3,
    file: '员工常见问题 FAQ.docx',
    location: '第 4 页 · Chunk #019',
    content: '如系统无法上传证明材料，可先保存申请草稿，并联系 HR 服务台协助处理。',
    vector: 0.68,
    rerank: 0.79,
  },
]

function SearchTest() {
  const [query, setQuery] = useState('员工请婚假需要提前多久申请？')
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun] = useState(true)
  const run = () => {
    if (!query.trim()) return
    setLoading(true)
    setHasRun(false)
    window.setTimeout(() => { setLoading(false); setHasRun(true) }, 850)
  }
  return (
    <div className="retrieval-layout">
      <Card className="retrieval-settings" title={<Space><SlidersOutlined />检索参数</Space>}>
        <Text strong>测试问题</Text>
        <TextArea value={query} onChange={(event) => setQuery(event.target.value)} rows={4} placeholder="输入一个真实业务问题，检查召回片段是否准确" />
        <Button type="primary" icon={<SearchOutlined />} block loading={loading} onClick={run} disabled={!query.trim()}>测试检索</Button>
        <Divider />
        <div className="setting-row"><Text>召回数量 Top K</Text><InputNumber min={1} max={20} defaultValue={10} /></div>
        <div className="setting-row"><Text>最低相似度</Text><InputNumber min={0} max={1} step={0.05} defaultValue={0.35} /></div>
        <div className="setting-row"><div><Text>启用 Rerank</Text><Text type="secondary">提升结果排序质量</Text></div><Switch defaultChecked /></div>
        <div className="setting-row"><Text>最终返回</Text><InputNumber min={1} max={10} defaultValue={5} /></div>
        <Alert type="info" showIcon message="Rerank: qwen3-rerank" />
      </Card>
      <div className="retrieval-results">
        <div className="result-summary">
          <div><Title level={4}>检索结果</Title><Text type="secondary">{hasRun ? '召回 8 个片段 · 重排保留 5 个 · 用时 420 ms' : '等待检索'}</Text></div>
          <Button icon={<HistoryOutlined />}>测试历史</Button>
        </div>
        {loading ? (
          <Card className="retrieval-loading"><Spin /><Text strong>正在召回并重排相关资料…</Text><Text type="secondary">向量检索 → Rerank → 结果整理</Text></Card>
        ) : hasRun ? retrievalResults.map((item, index) => (
          <Card key={item.id} className="result-card">
            <div className="result-rank">{index + 1}</div>
            <div className="result-body">
              <div className="result-source"><FileTextOutlined /><Text strong>{item.file}</Text><Text type="secondary">{item.location}</Text></div>
              <Paragraph>{item.content}</Paragraph>
              <Space><Tag color="cyan">向量 {item.vector}</Tag><Tag color="green">重排 {item.rerank}</Tag><Button type="link" size="small" icon={<EyeOutlined />}>查看原文</Button><Button type="text" size="small" icon={<CopyOutlined />} /></Space>
            </div>
          </Card>
        )) : <Empty description="输入业务问题开始测试检索" />}
      </div>
    </div>
  )
}

function KnowledgeDetail() {
  const navigate = useNavigate()
  const { id = 'company-policy' } = useParams()
  const kb = knowledgeBases.find((item) => item.id === id) ?? knowledgeBases[0]
  const [tab, setTab] = useState('documents')
  const [preview, setPreview] = useState<DocumentRecord | null>(null)
  const { message } = AntApp.useApp()

  const columns: TableColumnsType<DocumentRecord> = [
    {
      title: '文件', dataIndex: 'name', width: 320, render: (value: string, record) => (
        <button className="file-cell" onClick={() => setPreview(record)}><span className={`file-icon ${record.type}`}>{fileIcon(record.type)}</span><span><strong>{value}</strong><small>{record.size}</small></span></button>
      ),
    },
    { title: '处理状态', dataIndex: 'status', width: 170, render: (value: KnowledgeStatus) => <StatusTag status={value} /> },
    { title: '分块数', dataIndex: 'chunks', width: 100 },
    { title: '解析方式', dataIndex: 'parser', width: 180 },
    { title: '更新时间', dataIndex: 'updatedAt', width: 130 },
    {
      title: '', width: 110, fixed: 'right', render: (_, record) => record.status === 'failed'
        ? <Button type="link" danger onClick={() => message.info('已提交重新处理任务')}>重新处理</Button>
        : <Button type="link" onClick={() => setPreview(record)}>查看</Button>,
    },
  ]

  const tabItems = [
    {
      key: 'documents', label: '文件与分块', children: (
        <>
          <Alert
            className="task-banner"
            type="info"
            showIcon
            icon={<LoadingOutlined spin />}
            message="正在处理 1 个文件"
            description={<div className="banner-progress"><Progress percent={64} size="small" /><Text type="secondary">采购审批流程图.png · 正在执行云端 OCR</Text></div>}
            action={<Button size="small">查看任务</Button>}
          />
          <Card className="surface-card" styles={{ body: { padding: 0 } }}>
            <div className="table-toolbar"><Input prefix={<SearchOutlined />} placeholder="搜索文件名" allowClear /><Space><Select defaultValue="all" options={[{ value: 'all', label: '全部状态' }, { value: 'ready', label: '可用' }, { value: 'indexing', label: '处理中' }, { value: 'failed', label: '失败' }]} /><Button icon={<FilterOutlined />}>筛选</Button></Space></div>
            <Table rowKey="id" columns={columns} dataSource={documents} pagination={false} scroll={{ x: 1020 }} />
          </Card>
        </>
      ),
    },
    { key: 'search', label: '搜索测试', children: <SearchTest /> },
    {
      key: 'settings', label: '设置', children: (
        <Card className="settings-card" title="基础设置">
          <Form layout="vertical" initialValues={{ name: kb.name, description: kb.description, embedding: kb.embeddingModel, rerank: 'qwen3-rerank' }}>
            <Form.Item name="name" label="知识库名称"><Input /></Form.Item>
            <Form.Item name="description" label="描述"><TextArea rows={3} /></Form.Item>
            <Alert type="warning" showIcon message="修改 Embedding 模型后，需要重建所有文档索引。" />
            <Form.Item name="embedding" label="Embedding 模型"><Select options={[{ value: kb.embeddingModel, label: kb.embeddingModel }, { value: 'text-embedding-v4', label: 'text-embedding-v4' }]} /></Form.Item>
            <Form.Item name="rerank" label="Rerank 模型"><Select options={[{ value: 'qwen3-rerank', label: 'qwen3-rerank' }]} /></Form.Item>
            <Button type="primary" onClick={() => message.success('设置已保存')}>保存设置</Button>
          </Form>
        </Card>
      ),
    },
  ]

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={<Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/knowledge')}>返回知识库</Button>}
        title={kb.name}
        description={kb.description}
        extra={<Space><Button icon={<SearchOutlined />} onClick={() => setTab('search')}>搜索测试</Button><Button type="primary" icon={<CloudUploadOutlined />} onClick={() => navigate(`/knowledge/${kb.id}/import`)}>导入知识</Button></Space>}
      />
      <div className="kb-overview">
        <div><StatusTag status={kb.status} /></div>
        <Divider type="vertical" />
        <div><Text type="secondary">文档</Text><strong>{kb.documents}</strong></div>
        <div><Text type="secondary">分块</Text><strong>{kb.chunks.toLocaleString()}</strong></div>
        <div><Text type="secondary">Embedding</Text><strong>{kb.embeddingModel}</strong></div>
        <div><Text type="secondary">最近更新</Text><strong>{kb.updatedAt}</strong></div>
      </div>
      <Tabs activeKey={tab} onChange={setTab} items={tabItems} className="detail-tabs" />
      <Drawer title="文档与分块" width={560} open={Boolean(preview)} onClose={() => setPreview(null)} extra={<Button icon={<NodeIndexOutlined />}>重建索引</Button>}>
        {preview && (
          <div className="document-preview">
            <div className="source-file">{fileIcon(preview.type)}<div><Text strong>{preview.name}</Text><Text type="secondary">{preview.size} · {preview.parser}</Text></div></div>
            <Descriptions bordered size="small" column={2} items={[
              { key: 'status', label: '状态', children: <StatusTag status={preview.status} /> },
              { key: 'chunks', label: '分块', children: preview.chunks || '—' },
            ]} />
            <Divider titlePlacement="start">分块抽样</Divider>
            {[1, 2, 3].map((number) => (
              <Card key={number} size="small" className="chunk-card" title={`Chunk #0${number}`} extra={<Button type="link" size="small" icon={<EditOutlined />}>编辑</Button>}>
                <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}>员工申请相关假期时，应在 OA 系统提交申请并附上相应证明材料。审批完成后，相关记录将同步至考勤系统。</Paragraph>
                <Text type="secondary">第 {number + 4} 页 · 286 Tokens · 已建立索引</Text>
              </Card>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  )
}

const demoFiles: UploadFile[] = [
  { uid: 'demo-1', name: '员工手册_2026.pdf', status: 'done', size: 4820000, type: 'application/pdf' },
  { uid: 'demo-2', name: '差旅报销制度.docx', status: 'done', size: 1240000, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { uid: 'demo-3', name: '职级薪酬表.xlsx', status: 'done', size: 690000, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { uid: 'demo-4', name: '请假流程图.png', status: 'done', size: 1130000, type: 'image/png' },
]

const previewChunks = [
  { id: 1, type: '正文', source: '员工手册_2026.pdf · 第 6 页', tokens: 418, text: '公司实行每日八小时、每周四十小时的标准工时制度。员工应按规定时间进行上下班考勤，如因公外出，应提前在系统中提交外出申请。' },
  { id: 2, type: '表格', source: '职级薪酬表.xlsx · 薪酬标准', tokens: 362, text: '职级序列：P1-P3；岗位类型：专业序列；薪酬带宽依据岗位价值、任职能力与年度绩效综合确定。表格结构与表头关联已保留。' },
  { id: 3, type: '图片 OCR', source: '请假流程图.png · OCR 区域 1', tokens: 196, text: '请假流程：员工发起申请 → 直属主管审批 → 部门负责人审批 → 人力资源部备案 → 考勤系统同步。' },
]

function ImportWizard() {
  const navigate = useNavigate()
  const { id = 'company-policy' } = useParams()
  const { message } = AntApp.useApp()
  const [step, setStep] = useState(0)
  const [files, setFiles] = useState<UploadFile[]>([])
  const [parser, setParser] = useState('smart')
  const [building, setBuilding] = useState(false)
  const [editChunk, setEditChunk] = useState<(typeof previewChunks)[number] | null>(null)

  const next = () => {
    if (step === 0 && files.length === 0) {
      message.warning('请先选择文件，或加载示例文件')
      return
    }
    if (step < 3) setStep((value) => value + 1)
  }
  const build = () => {
    setBuilding(true)
    window.setTimeout(() => {
      message.success('构建任务已创建，后台将继续解析并建立索引')
      navigate(`/knowledge/${id}`)
    }, 1100)
  }

  const content = [
    <div className="wizard-panel upload-step" key="upload">
      <div className="wizard-section-heading"><Title level={3}>选择要导入的文件</Title><Text type="secondary">支持单文件最大 50 MB，每批最多 20 个文件。</Text></div>
      <Dragger
        multiple
        fileList={files}
        beforeUpload={(file) => { setFiles((items) => [...items, file]); return false }}
        onRemove={(file) => { setFiles((items) => items.filter((item) => item.uid !== file.uid)); return true }}
        accept=".doc,.docx,.pdf,.md,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">拖拽文件到此处，或点击选择文件</p>
        <p className="ant-upload-hint">支持 DOCX、PDF、Markdown、图片、XLSX、CSV</p>
      </Dragger>
      {files.length === 0 && <Button icon={<ExperimentOutlined />} onClick={() => setFiles(demoFiles)}>加载 4 个示例文件</Button>}
      <Alert type="info" showIcon message="扫描件或复杂版面将使用云端解析" description="文件内容会发送至你已配置的云端解析服务商；本原型不会真正上传任何文件。" />
    </div>,
    <div className="wizard-panel settings-step" key="settings">
      <div className="wizard-section-heading"><Title level={3}>解析与分块设置</Title><Text type="secondary">按内容类型选择解析方式，并控制进入检索索引的分块粒度。</Text></div>
      <Card title="解析方式" size="small">
        <Radio.Group value={parser} onChange={(event) => setParser(event.target.value)} className="parser-grid">
          <Radio.Button value="smart"><span><ThunderboltOutlined /><strong>智能选择</strong><small>按文件内容自动选择，推荐</small></span></Radio.Button>
          <Radio.Button value="local"><span><CodeOutlined /><strong>本地快速解析</strong><small>适合纯文字文档</small></span></Radio.Button>
          <Radio.Button value="cloud"><span><CloudUploadOutlined /><strong>云端高精度</strong><small>扫描件与复杂版面</small></span></Radio.Button>
        </Radio.Group>
        <div className="toggle-list">
          <div><span><Text strong>图片和扫描件自动 OCR</Text><Text type="secondary">调用已配置的云端 API</Text></span><Switch defaultChecked /></div>
          <div><span><Text strong>保留表格结构</Text><Text type="secondary">按表头关联行列数据</Text></span><Switch defaultChecked /></div>
          <div><span><Text strong>提取文档内嵌图片</Text><Text type="secondary">对图片内容执行识别</Text></span><Switch defaultChecked /></div>
        </div>
      </Card>
      <Card title="分块规则" size="small">
        <Form layout="vertical" className="chunk-settings-grid">
          <Form.Item label="分块策略"><Select defaultValue="general" options={[{ value: 'general', label: '通用分块' }, { value: 'heading', label: '按标题层级' }, { value: 'table', label: '按表格区域' }]} /></Form.Item>
          <Form.Item label="分块最大 Tokens"><InputNumber min={200} max={2000} defaultValue={500} /></Form.Item>
          <Form.Item label="重叠 Tokens"><InputNumber min={0} max={300} defaultValue={80} /></Form.Item>
        </Form>
      </Card>
      <Card size="small" title="索引模型"><Descriptions column={2} items={[{ key: 'embedding', label: 'Embedding', children: 'qwen3-embedding-8b' }, { key: 'rerank', label: 'Rerank', children: 'qwen3-rerank' }]} /></Card>
    </div>,
    <div className="wizard-panel preview-step" key="preview">
      <div className="wizard-section-heading"><Title level={3}>检查分块预览</Title><Text type="secondary">已生成 126 个分块，请抽查标题、段落、表格和页码是否完整。</Text></div>
      <div className="preview-grid">
        <Card size="small" className="preview-files" title="文件（4）">
          {demoFiles.map((file, index) => <button key={file.uid} className={index === 0 ? 'active' : ''}>{fileIcon(file.name.endsWith('.xlsx') ? 'xlsx' : file.name.endsWith('.png') ? 'image' : file.name.endsWith('.docx') ? 'docx' : 'pdf')}<span>{file.name}</span><CheckCircleFilled /></button>)}
        </Card>
        <div className="preview-chunks">
          {previewChunks.map((chunk) => (
            <Card key={chunk.id} size="small" className="chunk-card" title={<Space><Tag color={chunk.type === '正文' ? 'blue' : chunk.type === '表格' ? 'green' : 'gold'}>{chunk.type}</Tag><Text>Chunk #0{chunk.id}</Text></Space>} extra={<Button type="link" size="small" icon={<EditOutlined />} onClick={() => setEditChunk(chunk)}>编辑</Button>}>
              <Paragraph>{chunk.text}</Paragraph><Text type="secondary">{chunk.source} · {chunk.tokens} Tokens</Text>
            </Card>
          ))}
        </div>
        <Card size="small" className="preview-summary" title="解析摘要">
          <Statistic title="预计分块" value={126} />
          <Divider />
          <Descriptions column={1} size="small" items={[
            { key: 'page', label: '页数', children: '42 页' },
            { key: 'text', label: '识别文字', children: '38,620 字' },
            { key: 'table', label: '表格', children: '6 个' },
            { key: 'image', label: '图片', children: '12 张' },
            { key: 'ocr', label: 'OCR', children: '3 页' },
          ]} />
          <Alert type="warning" showIcon message="1 个版面需抽查" />
        </Card>
      </div>
    </div>,
    <div className="wizard-panel confirm-step" key="confirm">
      <div className="confirm-icon"><CheckOutlined /></div>
      <Title level={2}>准备开始构建知识库</Title>
      <Text type="secondary">确认以下设置后，系统将在后台解析文件、生成分块并建立向量索引。</Text>
      <Card className="confirm-summary">
        <Descriptions column={2} items={[
          { key: 'files', label: '文件数量', children: '4 个' },
          { key: 'pages', label: '总页数', children: '42 页' },
          { key: 'chunks', label: '预计分块', children: '126 个' },
          { key: 'parser', label: '解析方式', children: parser === 'smart' ? '智能选择' : parser === 'cloud' ? '云端高精度' : '本地快速解析' },
          { key: 'embedding', label: 'Embedding', children: 'qwen3-embedding-8b' },
          { key: 'ocr', label: '需 OCR 文件', children: '1 个' },
        ]} />
      </Card>
      <Alert type="success" showIcon message="构建过程在后台进行，离开页面不会中断任务。" />
    </div>,
  ][step]

  return (
    <div className="import-page page-full-bleed">
      <div className="import-header">
        <Button type="text" icon={<LeftOutlined />} onClick={() => navigate(`/knowledge/${id}`)}>退出导入</Button>
        <div><Text strong>导入知识</Text><Text type="secondary">企业制度知识库</Text></div>
        <Tag color="cyan">草稿已自动保存</Tag>
      </div>
      <div className="wizard-container">
        <Steps current={step} items={[{ title: '上传文件' }, { title: '解析设置' }, { title: '分块预览' }, { title: '开始构建' }]} />
        {content}
      </div>
      <div className="wizard-footer">
        <Text type="secondary">{step === 0 ? `${files.length} 个文件待处理` : step === 1 ? '参数仅用于本次导入' : step === 2 ? '预览内容可在导入后继续编辑' : '构建完成后可立即进行搜索测试'}</Text>
        <Space>
          <Button disabled={step === 0 || building} onClick={() => setStep((value) => value - 1)}>上一步</Button>
          {step < 3 ? <Button type="primary" onClick={next}>{step === 1 ? '生成预览' : '下一步'}</Button> : <Button type="primary" icon={<NodeIndexOutlined />} loading={building} onClick={build}>确认并构建索引</Button>}
        </Space>
      </div>
      <Modal title="编辑分块内容" open={Boolean(editChunk)} onCancel={() => setEditChunk(null)} onOk={() => { setEditChunk(null); message.success('分块内容已保存') }} okText="保存修改">
        <Alert type="info" showIcon message="保存后，该分块将在构建时使用修改后的内容。" />
        <TextArea className="chunk-editor" rows={8} defaultValue={editChunk?.text} />
      </Modal>
    </div>
  )
}

function ProviderStatus({ record }: { record: ProviderRecord }) {
  if (record.status === 'connected') return <Tag color="success" icon={<CheckCircleFilled />}>连接可用 · {record.latency} ms</Tag>
  if (record.status === 'warning') return <Tag color="warning" icon={<InfoCircleOutlined />}>延迟偏高 · {record.latency} ms</Tag>
  return <Tag>未启用</Tag>
}

function ModelsPage() {
  const { message } = AntApp.useApp()
  const [tab, setTab] = useState('providers')
  const [modelType, setModelType] = useState<ModelRecord['type']>('LLM')
  const [testing, setTesting] = useState<string | null>(null)
  const [providerEdit, setProviderEdit] = useState<ProviderRecord | null>(null)

  const testProvider = (record: ProviderRecord) => {
    setTesting(record.id)
    window.setTimeout(() => {
      setTesting(null)
      if (record.status === 'warning') message.warning(`${record.name} 连接成功，但响应延迟偏高`)
      else message.success(`${record.name} 连接可用，耗时 ${record.latency} ms`)
    }, 850)
  }

  const providerColumns: TableColumnsType<ProviderRecord> = [
    { title: '服务商', dataIndex: 'name', width: 170, render: (value: string, record) => <div className="provider-name"><Avatar shape="square">{value.slice(0, 2)}</Avatar><div><Text strong>{value}</Text><Text type="secondary">{record.protocol}</Text></div></div> },
    { title: 'API 地址', dataIndex: 'endpoint', width: 290, render: (value: string) => <Text code>{value}</Text> },
    { title: '能力', width: 200, render: () => <Space size={4}><Tag>LLM</Tag><Tag>Embedding</Tag><Tag>Rerank</Tag></Space> },
    { title: '连接状态', width: 210, render: (_, record) => <ProviderStatus record={record} /> },
    { title: '模型数', dataIndex: 'models', width: 90 },
    { title: '', width: 180, fixed: 'right', render: (_, record) => <Space><Button loading={testing === record.id} onClick={() => testProvider(record)}>测试连接</Button><Button type="link" onClick={() => setProviderEdit(record)}>配置</Button></Space> },
  ]
  const modelColumns: TableColumnsType<ModelRecord> = [
    { title: '模型名称', dataIndex: 'name', width: 280, render: (value: string, record) => <Space><Text strong>{value}</Text>{record.isDefault && <Tag color="cyan">默认</Tag>}</Space> },
    { title: '服务商', dataIndex: 'provider', width: 170 },
    { title: '类型', dataIndex: 'type', width: 130, render: (value: string) => <Tag color={value === 'LLM' ? 'blue' : value === 'Embedding' ? 'green' : 'gold'}>{value}</Tag> },
    { title: '规格', width: 180, render: (_, record) => record.dimension ? `${record.dimension} 维` : record.type === 'LLM' ? '128K 上下文' : 'Top 100 候选' },
    { title: '状态', dataIndex: 'enabled', width: 110, render: (value: boolean) => <Badge status={value ? 'success' : 'default'} text={value ? '已启用' : '已停用'} /> },
    { title: '', width: 180, fixed: 'right', render: () => <Space><Button onClick={() => message.success('模型调用测试通过')}>测试模型</Button><Button type="link">编辑</Button></Space> },
  ]

  return (
    <div className="page-container">
      <PageHeader title="模型服务" description="统一配置 LLM、Embedding 和 Rerank 模型，知识库无需绑定单一厂商。" extra={<Button type="primary" icon={<PlusOutlined />}>{tab === 'providers' ? '新增服务商' : '新增模型'}</Button>} />
      <Alert className="scope-alert" type="info" showIcon icon={<KeyOutlined />} message="API Key 保存后仅显示掩码，无法再次查看完整密钥。原型不会发送或保存真实密钥。" />
      <Card className="surface-card models-card">
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'providers', label: '服务商', children: <Table rowKey="id" columns={providerColumns} dataSource={providers} pagination={false} scroll={{ x: 1150 }} /> },
          { key: 'models', label: '模型配置', children: <><div className="model-type-filter"><Segmented value={modelType} onChange={(value) => setModelType(value as ModelRecord['type'])} options={['LLM', 'Embedding', 'Rerank']} /><Text type="secondary">共 {models.filter((model) => model.type === modelType).length} 个模型</Text></div><Table rowKey="id" columns={modelColumns} dataSource={models.filter((model) => model.type === modelType)} pagination={false} scroll={{ x: 1040 }} /></> },
        ]} />
      </Card>
      <Drawer title={providerEdit ? `配置 ${providerEdit.name}` : '配置服务商'} width={520} open={Boolean(providerEdit)} onClose={() => setProviderEdit(null)} extra={<Button type="primary" onClick={() => { setProviderEdit(null); message.success('服务商配置已保存') }}>保存</Button>}>
        {providerEdit && <Form layout="vertical" initialValues={{ name: providerEdit.name, url: providerEdit.endpoint, timeout: 30, retry: 2, enabled: true }}>
          <Form.Item name="name" label="显示名称"><Input /></Form.Item>
          <Form.Item name="url" label="Base URL"><Input /></Form.Item>
          <Form.Item label="API Key"><Input.Password value={providerEdit.keyMask} readOnly /><Text type="secondary">留空表示不修改现有密钥</Text></Form.Item>
          <Row gutter={16}><Col span={12}><Form.Item name="timeout" label="超时（秒）"><InputNumber min={5} max={120} /></Form.Item></Col><Col span={12}><Form.Item name="retry" label="重试次数"><InputNumber min={0} max={5} /></Form.Item></Col></Row>
          <Form.Item name="enabled" label="启用状态" valuePropName="checked"><Switch /></Form.Item>
          <Button icon={<ThunderboltOutlined />} loading={testing === providerEdit.id} onClick={() => testProvider(providerEdit)}>测试连接</Button>
        </Form>}
      </Drawer>
    </div>
  )
}

function LogsPage({ role }: { role: Role }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<RunLog | null>(null)
  const data = useMemo(() => logs.filter((item) => item.query.includes(query) && (status === 'all' || item.status === status)), [query, status])
  const columns: TableColumnsType<RunLog> = [
    { title: '时间', dataIndex: 'createdAt', width: 170 },
    { title: '查询内容', dataIndex: 'query', width: 330, ellipsis: true, render: (value: string) => <Text strong>{value}</Text> },
    { title: '知识库', dataIndex: 'knowledgeBase', width: 180 },
    { title: '模型', dataIndex: 'model', width: 190, render: (value: string) => <Tag>{value}</Tag> },
    { title: 'Tokens', dataIndex: 'tokens', width: 110, render: (value: number) => value.toLocaleString() },
    { title: '首字 / 总耗时', width: 150, render: (_, record) => `${record.firstToken || '—'} / ${record.duration} 秒` },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: RunLog['status']) => value === 'success' ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag> },
    { title: '', fixed: 'right', width: 90, render: (_, record) => <Button type="link" onClick={() => setSelected(record)}>详情</Button> },
  ]
  const successRate = Math.round((logs.filter((item) => item.status === 'success').length / logs.length) * 100)
  const tokenTotal = logs.reduce((sum, item) => sum + item.tokens, 0)

  return (
    <div className="page-container">
      <PageHeader title="运行日志" description="跟踪每次知识问答的查询、Token 消耗、模型和阶段耗时。" extra={<Button icon={<ReloadOutlined />}>刷新数据</Button>} />
      {role === 'manager' && <Alert className="scope-alert" type="info" showIcon message="仅展示你所管理知识库的运行日志" />}
      <Row gutter={16} className="metric-row">
        <Col xs={12} md={6}><Card><Statistic title="今日请求" value={logs.length} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="成功率" value={successRate} suffix="%" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="平均耗时" value={9.57} suffix="秒" precision={2} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Token 总量" value={tokenTotal} /></Card></Col>
      </Row>
      <Card className="surface-card" styles={{ body: { padding: 0 } }}>
        <div className="table-toolbar log-filters">
          <Space wrap>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} prefix={<SearchOutlined />} placeholder="搜索查询内容" allowClear />
            <Select defaultValue="24h" options={[{ value: '24h', label: '最近 24 小时' }, { value: '7d', label: '最近 7 天' }, { value: '30d', label: '最近 30 天' }]} />
            <Select value={status} onChange={setStatus} options={[{ value: 'all', label: '全部状态' }, { value: 'success', label: '成功' }, { value: 'failed', label: '失败' }]} />
            <Select defaultValue="all" options={[{ value: 'all', label: '全部知识库' }, ...knowledgeBases.map((item) => ({ value: item.id, label: item.name }))]} />
          </Space>
          <Button onClick={() => { setQuery(''); setStatus('all') }}>重置</Button>
        </div>
        <Table rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 8 }} scroll={{ x: 1290 }} />
      </Card>
      <Drawer title="请求详情" width={560} open={Boolean(selected)} onClose={() => setSelected(null)} extra={selected && (selected.status === 'success' ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>)}>
        {selected && <div className="log-detail">
          <Descriptions column={2} size="small" items={[
            { key: 'id', label: '请求 ID', children: <Text copyable>{selected.id}</Text> },
            { key: 'time', label: '时间', children: selected.createdAt },
            { key: 'role', label: '角色', children: selected.role },
            { key: 'kb', label: '知识库', children: selected.knowledgeBase },
            { key: 'model', label: '模型', children: selected.model },
            { key: 'citations', label: '引用', children: `${selected.citations} 个分块` },
          ]} />
          <Divider titlePlacement="start">查询与回答</Divider>
          <Text strong>用户问题</Text><Paragraph className="detail-copy">{selected.query}</Paragraph>
          <Text strong>模型回答</Text><Paragraph className="detail-copy">{selected.answer}</Paragraph>
          <Divider titlePlacement="start">Token 消耗</Divider>
          <Row gutter={12}><Col span={8}><Card size="small"><Statistic title="输入" value={selected.promptTokens} /></Card></Col><Col span={8}><Card size="small"><Statistic title="输出" value={selected.completionTokens} /></Card></Col><Col span={8}><Card size="small"><Statistic title="总计" value={selected.tokens} /></Card></Col></Row>
          <Divider titlePlacement="start">阶段耗时</Divider>
          <Timeline items={[
            { color: 'green', children: '问题处理 · 42 ms' },
            { color: 'green', children: '向量召回 · 184 ms' },
            { color: 'green', children: 'Rerank · 126 ms' },
            { color: selected.firstToken ? 'green' : 'red', children: `首 Token · ${selected.firstToken || '未返回'} 秒` },
            { color: selected.status === 'success' ? 'green' : 'red', children: `完整生成 · ${selected.duration} 秒` },
          ]} />
        </div>}
      </Drawer>
    </div>
  )
}

export default function App() {
  const [role, setRole] = useState<Role>(() => readStoredRole())
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = AntApp.useApp()

  const changeRole = (nextRole: Role) => {
    persistRole(nextRole)
    setRole(nextRole)
    if (!canAccessPath(nextRole, location.pathname)) {
      navigate('/chat')
      message.warning('当前角色无权访问原页面，已返回在线对话')
    } else {
      message.success(`已切换为${ROLE_LABELS[nextRole]}`)
    }
  }

  return <AppShell role={role} onRoleChange={changeRole} />
}
