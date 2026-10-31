import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, App as AntApp, Button, Card, Descriptions, Drawer, Empty, Form, Input, InputNumber, Progress, Result, Select, Space, Table, Tabs, Tag, Tooltip } from 'antd'
import type { TableColumnsType } from 'antd'
import { ApiOutlined, ArrowLeftOutlined, ArrowRightOutlined, BranchesOutlined, BugOutlined, CheckCircleOutlined, CodeOutlined, DashboardOutlined, DatabaseOutlined, DollarOutlined, DownloadOutlined, EditOutlined, EyeOutlined, FileTextOutlined, InfoCircleOutlined, LineChartOutlined, MessageOutlined, NodeIndexOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, ThunderboltOutlined, ToolOutlined, WarningOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  SPAN_KIND_LABELS,
  filterRuns,
  formatDuration,
  formatTokens,
  initialPriceRules,
  observabilityErrors,
  observabilityRuns,
  observabilitySpans,
  successRate,
  sumKnownTokens,
  trendData,
} from './observabilityData'
import type { ObservabilityError, ObservabilityRun, ObservabilitySpan, ObservabilityStatus, PriceRule } from './observabilityData'
import './observability.css'

const number = (value: number) => value.toLocaleString('zh-CN')
const money = (value: number | null, currency = '¥') => value === null ? '未知' : `${currency}${value.toFixed(4)}`

function StatusTag({ status }: { status: ObservabilityStatus }) {
  return <Tag color={STATUS_COLORS[status]} className={`obs-status status-${status}`}>{STATUS_LABELS[status]}</Tag>
}

function RunKindTag({ kind }: { kind: ObservabilityRun['kind'] }) {
  return <Tag className={`obs-kind kind-${kind}`} icon={kind === 'chat' ? <MessageOutlined /> : <DatabaseOutlined />}>{kind === 'chat' ? '在线问答' : '知识库构建'}</Tag>
}

function SpanKindIcon({ span }: { span: ObservabilitySpan }) {
  if (span.kind === 'model') return <ApiOutlined />
  if (span.kind === 'tool') return <ToolOutlined />
  if (span.kind === 'skill') return <RobotOutlined />
  if (span.kind === 'harness') return <ThunderboltOutlined />
  return <NodeIndexOutlined />
}

function DemoNotice() {
  return <div className="obs-demo-notice"><InfoCircleOutlined /><span><b>交互原型 · 脱敏样例数据</b>　页面用于确认功能与布局，尚未连接真实观测接口；工具、Skill 与 Agent 节点仅在明确标记的测试夹具中出现。</span><Tag>非真实监控</Tag></div>
}

function ObservabilityNav({ active }: { active: 'overview' | 'runs' | 'errors' | 'usage' }) {
  const navigate = useNavigate()
  const items = [
    { key: 'overview', label: '可观测总览', path: '/observability', icon: <DashboardOutlined /> },
    { key: 'runs', label: '运行链路', path: '/observability/runs', icon: <BranchesOutlined /> },
    { key: 'errors', label: '异常中心', path: '/observability/errors', icon: <BugOutlined /> },
    { key: 'usage', label: 'Token 与成本', path: '/observability/usage', icon: <DollarOutlined /> },
  ] as const
  return <div className="obs-subnav" role="navigation" aria-label="可观测模块导航">{items.map((item) => <button key={item.key} className={active === item.key ? 'active' : ''} onClick={() => navigate(item.path)}>{item.icon}<span>{item.label}</span></button>)}</div>
}

function PageShell({ active, title, description, actions, children }: { active: 'overview' | 'runs' | 'errors' | 'usage'; title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return <div className="page observability-page">
    <div className="obs-page-heading"><div><span className="obs-eyebrow">OBSERVABILITY</span><h1>{title}</h1><p>{description}</p></div><div className="obs-heading-actions">{actions}</div></div>
    <ObservabilityNav active={active} />
    <DemoNotice />
    {children}
  </div>
}

function MetricCard({ label, value, note, icon, tone = 'blue', onClick }: { label: string; value: string; note: string; icon: ReactNode; tone?: string; onClick?: () => void }) {
  const content = <><span className={`obs-metric-icon tone-${tone}`}>{icon}</span><span className="obs-metric-copy"><small>{label}</small><strong>{value}</strong><span>{note}</span></span>{onClick && <ArrowRightOutlined className="obs-metric-arrow" />}</>
  return onClick ? <button className="obs-metric clickable" onClick={onClick}>{content}</button> : <div className="obs-metric">{content}</div>
}

function TrendChart() {
  const width = 720
  const height = 220
  const left = 38
  const top = 18
  const chartHeight = 150
  const step = (width - left - 24) / (trendData.length - 1)
  const points = trendData.map((item, index) => ({ ...item, x: left + index * step, y: top + chartHeight - (item.runs / 180) * chartHeight }))
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
  const area = `${path} L ${points.at(-1)!.x} ${top + chartHeight} L ${points[0].x} ${top + chartHeight} Z`
  return <div className="obs-trend-chart"><div className="obs-chart-legend"><span><i className="legend-line" />运行量</span><span><i className="legend-bar" />失败数</span><small>近 7 天</small></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近七天运行量与失败趋势图">
    {[0, 60, 120, 180].map((tick) => { const y = top + chartHeight - (tick / 180) * chartHeight; return <g key={tick}><line x1={left} x2={width - 24} y1={y} y2={y} className="chart-grid" /><text x={left - 9} y={y + 4} textAnchor="end" className="chart-axis">{tick}</text></g> })}
    <path d={area} className="chart-area" /><path d={path} className="chart-line" />
    {points.map((point) => <g key={point.day}><rect x={point.x - 5} y={top + chartHeight - point.failed * 3} width="10" height={point.failed * 3} rx="2" className="chart-failure-bar" /><circle cx={point.x} cy={point.y} r="4" className="chart-point" /><text x={point.x} y={top + chartHeight + 27} textAnchor="middle" className="chart-axis">{point.day}</text></g>)}
  </svg></div>
}

export function ObservabilityOverview() {
  const navigate = useNavigate()
  const { message } = AntApp.useApp()
  const failedRuns = observabilityRuns.filter((run) => run.status === 'failed')
  const totalTokens = sumKnownTokens(observabilityRuns)
  const knownCost = observabilityRuns.reduce((sum, run) => sum + (run.estimatedCost || 0), 0)
  const unknownUsage = observabilityRuns.filter((run) => run.usage.source === 'unavailable').length
  const slowSpans = observabilitySpans.filter((span) => span.kind === 'model').sort((a, b) => b.durationMs - a.durationMs).slice(0, 5)
  const statusCounts = (['succeeded', 'failed', 'stopped', 'running'] as const).map((status) => ({ status, count: observabilityRuns.filter((run) => run.status === status).length }))
  let cursor = 0
  const gradient = statusCounts.map((item) => {
    const start = cursor
    cursor += (item.count / observabilityRuns.length) * 100
    const color = item.status === 'succeeded' ? '#2fa47c' : item.status === 'failed' ? '#dc6a62' : item.status === 'stopped' ? '#e0a24b' : '#4c7df0'
    return `${color} ${start}% ${cursor}%`
  }).join(',')
  return <PageShell active="overview" title="可观测总览" description="从知识构建到在线问答，统一追踪运行状态、调用链路与资源消耗。" actions={<Space><Select aria-label="总览时间范围" defaultValue="7d" options={[{ value: '24h', label: '最近 24 小时' }, { value: '7d', label: '最近 7 天' }, { value: '30d', label: '最近 30 天' }]} /><Button icon={<ReloadOutlined />} onClick={() => message.success('原型样例已刷新')}>刷新</Button></Space>}>
    <div className="obs-metrics-grid">
      <MetricCard label="运行次数" value={number(observabilityRuns.length)} note="构建与问答 · 样例范围" icon={<BranchesOutlined />} onClick={() => navigate('/observability/runs')} />
      <MetricCard label="运行成功率" value={`${successRate(observabilityRuns)}%`} note={`${failedRuns.length} 次失败 · 运行中不计入`} icon={<CheckCircleOutlined />} tone="green" onClick={() => navigate('/observability/runs?status=failed')} />
      <MetricCard label="已知 Tokens" value={number(totalTokens)} note={`${unknownUsage} 次调用用量未知`} icon={<NodeIndexOutlined />} tone="violet" onClick={() => navigate('/observability/usage')} />
      <MetricCard label="估算成本" value={money(knownCost)} note="非服务商账单 · CNY" icon={<DollarOutlined />} tone="orange" onClick={() => navigate('/observability/usage')} />
    </div>
    <div className="obs-overview-grid">
      <Card title="运行趋势" extra={<Button type="link" onClick={() => navigate('/observability/runs')}>查看运行链路 <ArrowRightOutlined /></Button>}><TrendChart /></Card>
      <Card title="运行状态分布" extra={<Tag>已结束 + 运行中</Tag>}><div className="obs-status-distribution"><div className="obs-donut" style={{ background: `conic-gradient(${gradient})` }}><div><strong>{observabilityRuns.length}</strong><span>全部 Run</span></div></div><div className="obs-status-legend">{statusCounts.map((item) => <button key={item.status} onClick={() => navigate(`/observability/runs?status=${item.status}`)}><i className={`dot-${item.status}`} /><span>{STATUS_LABELS[item.status]}</span><b>{item.count}</b><small>{Math.round(item.count / observabilityRuns.length * 100)}%</small></button>)}</div></div></Card>
    </div>
    <div className="obs-overview-grid lower">
      <Card title="异常排行" extra={<Button type="link" onClick={() => navigate('/observability/errors')}>进入异常中心 <ArrowRightOutlined /></Button>}><div className="obs-error-list">{observabilityErrors.slice(0, 4).map((error) => <button key={error.id} onClick={() => navigate(`/observability/runs/${error.runId}?span=${error.spanId}`)}><span className={`obs-error-icon severity-${error.severity}`}><WarningOutlined /></span><span><b>{error.code}</b><small>{error.category} · {error.message}</small></span><strong>{error.count}<small> 次</small></strong><ArrowRightOutlined /></button>)}</div></Card>
      <Card title="慢模型调用" extra={<Tag>P95 下钻</Tag>}><div className="obs-slow-list">{slowSpans.map((span, index) => <button key={span.id} onClick={() => navigate(`/observability/runs/${span.runId}?span=${span.id}`)}><span className="obs-rank">0{index + 1}</span><span><b>{span.model}</b><small>{span.name} · {span.provider}</small></span><StatusTag status={span.status} /><strong>{formatDuration(span.durationMs)}</strong></button>)}</div></Card>
    </div>
    <Card className="obs-cost-coverage"><div><span className="obs-coverage-icon"><LineChartOutlined /></span><div><b>成本覆盖率需要与金额一起阅读</b><p>2 次 Run 存在价格或 Token 缺口，对应金额显示“未知”，不按 0 计入完整成本。</p></div></div><Button onClick={() => navigate('/observability/usage')}>检查未知用量</Button></Card>
  </PageShell>
}

export function ObservabilityRuns() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState(params.get('kind') || 'all')
  const [status, setStatus] = useState(params.get('status') || 'all')
  const [provider, setProvider] = useState('all')
  const runs = useMemo(() => filterRuns(observabilityRuns, { search, kind, status, provider }), [search, kind, status, provider])
  const columns: TableColumnsType<ObservabilityRun> = [
    { title: '运行 / 目标', key: 'run', width: 285, render: (_, run) => <div className="obs-run-name"><RunKindTag kind={run.kind} /><b>{run.name}</b><small>{run.target} · {run.id}</small></div> },
    { title: '状态', key: 'status', width: 100, render: (_, run) => <StatusTag status={run.status} /> },
    { title: '模型 / 服务商', key: 'model', width: 220, render: (_, run) => <div className="obs-table-stack"><b>{run.model}</b><small>{run.provider}</small></div> },
    { title: 'Tokens', key: 'tokens', width: 125, render: (_, run) => <Tooltip title={run.usage.source === 'unavailable' ? '服务商未返回，不进行估算' : '服务商实际返回'}><span className={run.usage.total === null ? 'obs-unknown' : ''}>{formatTokens(run.usage.total)}</span></Tooltip> },
    { title: '耗时', key: 'duration', width: 110, render: (_, run) => formatDuration(run.durationMs) },
    { title: '估算成本', key: 'cost', width: 110, render: (_, run) => <span className={run.estimatedCost === null ? 'obs-unknown' : ''}>{money(run.estimatedCost)}</span> },
    { title: '开始时间', dataIndex: 'startedAt', width: 170 },
    { title: '操作', key: 'action', fixed: 'right', width: 90, render: (_, run) => <Button type="link" onClick={() => navigate(`/observability/runs/${run.id}`)}>查看 Trace</Button> },
  ]
  return <PageShell active="runs" title="运行链路" description="统一检索知识库构建和在线对话 Run，进入单次调用树与上下文现场。" actions={<Button icon={<DownloadOutlined />} onClick={() => downloadRuns(runs)}>导出当前结果</Button>}>
    <div className="obs-filter-panel"><Input prefix={<SearchOutlined />} placeholder="搜索 Run ID、问题、知识库或应用" value={search} onChange={(event) => setSearch(event.target.value)} allowClear /><Select aria-label="运行类型" value={kind} onChange={setKind} options={[{ value: 'all', label: '全部类型' }, { value: 'build', label: '知识库构建' }, { value: 'chat', label: '在线问答' }]} /><Select aria-label="运行状态" value={status} onChange={setStatus} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))]} /><Select aria-label="服务商" value={provider} onChange={setProvider} options={[{ value: 'all', label: '全部服务商' }, ...['通义百炼', 'AIHubmix', 'OpenRouter'].map((value) => ({ value, label: value }))]} /><Button onClick={() => { setSearch(''); setKind('all'); setStatus('all'); setProvider('all') }}>重置</Button></div>
    <div className="obs-result-summary"><span>共 <b>{runs.length}</b> 次运行</span><span><i className="live-dot" />原型数据不自动更新</span></div>
    <Card className="obs-table-card"><Table rowKey="id" columns={columns} dataSource={runs} scroll={{ x: 1330 }} pagination={false} locale={{ emptyText: <Empty description="没有匹配的运行记录" /> }} /></Card>
  </PageShell>
}

function downloadRuns(runs: ObservabilityRun[]) {
  const rows = [['Run ID', '类型', '名称', '状态', '模型', '总 Tokens', '用量来源', '估算成本', '开始时间'], ...runs.map((run) => [run.id, run.kind, run.name, run.status, run.model, run.usage.total ?? '未知', run.usage.source, run.estimatedCost ?? '未知', run.startedAt])]
  downloadCsv('知枢-运行链路-原型.csv', rows)
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = '\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function TraceTree({ spans, selected, onSelect }: { spans: ObservabilitySpan[]; selected: string; onSelect: (id: string) => void }) {
  const flattened: Array<{ span: ObservabilitySpan; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    spans.filter((span) => span.parentId === parentId).forEach((span) => { flattened.push({ span, depth }); walk(span.id, depth + 1) })
  }
  walk(null, 0)
  return <div className="obs-trace-tree">{flattened.map(({ span, depth }) => <button key={span.id} className={selected === span.id ? 'selected' : ''} style={{ paddingLeft: 14 + depth * 16 }} onClick={() => onSelect(span.id)}><span className={`obs-tree-icon kind-${span.kind}`}><SpanKindIcon span={span} /></span><span><b>{span.name}</b><small>{SPAN_KIND_LABELS[span.kind]} · {formatDuration(span.durationMs)}</small></span><i className={`tree-status status-${span.status}`} /></button>)}</div>
}

function TraceWaterfall({ run, spans, selected, onSelect }: { run: ObservabilityRun; spans: ObservabilitySpan[]; selected: string; onSelect: (id: string) => void }) {
  return <div className="obs-waterfall"><div className="obs-waterfall-axis"><span>0 ms</span><span>{formatDuration(run.durationMs / 2)}</span><span>{formatDuration(run.durationMs)}</span></div>{spans.filter((span) => span.parentId !== null).map((span) => <button key={span.id} className={selected === span.id ? 'selected' : ''} onClick={() => onSelect(span.id)}><span className="obs-waterfall-name">{span.name}</span><span className="obs-waterfall-track"><i className={`waterfall-bar status-${span.status}`} style={{ left: `${Math.min(96, span.offsetMs / run.durationMs * 100)}%`, width: `${Math.max(1.2, Math.min(100 - span.offsetMs / run.durationMs * 100, span.durationMs / run.durationMs * 100))}%` }} /></span><small>{formatDuration(span.durationMs)}</small></button>)}</div>
}

function ContextInspector({ run, span }: { run: ObservabilityRun; span: ObservabilitySpan }) {
  if (run.kind === 'build') return <div className="obs-context-panel"><Alert type="info" showIcon title="构建上下文快照" description="此节点不是对话模型调用。展示批次、源哈希和资产引用，不伪造 System／User 消息。" /><Descriptions column={2} size="small" items={Object.entries(span.metadata).map(([key, value]) => ({ key, label: key, children: String(value) }))} /><div className="obs-code-block"><div><CodeOutlined /> 节点输入</div><pre>{span.input}</pre></div><div className="obs-code-block"><div><CodeOutlined /> 节点输出</div><pre>{span.output}</pre></div></div>
  const llm = observabilitySpans.find((item) => item.runId === run.id && item.kind === 'model' && item.name.includes('LLM'))
  const usage = llm?.usage || run.usage
  return <div className="obs-context-panel">
    <div className="obs-context-title"><div><b>最终发送给模型的上下文</b><p>消息顺序与引用编号来自同一份不可变快照，而非事后推测。</p></div><Tag icon={<CheckCircleOutlined />} color="success">快照已校验</Tag></div>
    <Alert type="warning" showIcon title="目标交互预览" description="当前后端尚未启用动态 Token 预算；以下预算与截断状态用于确认原型，真实接入后必须由实际快照驱动。" />
    <div className="obs-budget-grid"><div><span>系统提示词</span><b>420</b><small>Tokens</small></div><div><span>对话历史</span><b>286</b><small>排除最早 2 条</small></div><div><span>知识片段</span><b>1,108</b><small>5 个引用</small></div><div><span>输出预留</span><b>800</b><small>Tokens</small></div></div>
    <div className="obs-budget-bar"><span style={{ width: '18%' }} className="budget-system" /><span style={{ width: '12%' }} className="budget-history" /><span style={{ width: '44%' }} className="budget-knowledge" /><span style={{ width: '26%' }} className="budget-reserve" /></div>
    <div className="obs-context-messages">
      <article><div><Tag color="blue">SYSTEM</Tag><b>应用提示词与回答约束</b><span>420 Tokens</span></div><p>你是企业员工服务助手。只能依据提供的知识原文和对话历史作答；资料不足时明确说明不知道。使用资料中的事实时，在对应句末标注引用编号。</p></article>
      <article><div><Tag>HISTORY</Tag><b>最近 4 条已完成消息</b><span>286 Tokens</span></div><p>User：我下周要出差。　Assistant：请确认出差地点与行程。　……</p><small className="obs-truncation-note"><WarningOutlined /> 2 条最早历史因预算被排除 · reason=context_budget</small></article>
      <article><div><Tag color="purple">KNOWLEDGE</Tag><b>知识原文与稳定引用编号</b><span>1,108 Tokens</span></div><div className="obs-context-citation"><b>[1] 费用管理制度 › 差旅报销</b><p>报销时应提交行程单、交通票据及住宿发票……</p><span>vector 0.8912 · rerank 0.9438</span></div><div className="obs-context-citation"><b>[2] 采购审批规范 › 事前审批</b><p>单笔超过 5,000 元的费用需补充事前审批记录……</p><span>vector 0.8621 · rerank 0.9175</span></div></article>
      <article><div><Tag color="green">USER</Tag><b>当前问题</b><span>完整保留</span></div><p>{run.query || run.name}</p></article>
    </div>
    <Descriptions size="small" column={3} items={[{ key: 'hash', label: '上下文哈希', children: 'sha256:98f2…a71c' }, { key: 'messages', label: '消息数量', children: '7 条' }, { key: 'usage', label: '服务商用量', children: `${formatTokens(usage.input)} / ${formatTokens(usage.output)}` }]} />
  </div>
}

function SpanDetail({ run, span }: { run: ObservabilityRun; span: ObservabilitySpan }) {
  const { message } = AntApp.useApp()
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); message.success('已复制脱敏内容') } catch { message.warning('浏览器未允许复制') } }
  return <div className="obs-span-detail">
    <div className="obs-span-heading"><div><span className={`obs-detail-kind kind-${span.kind}`}><SpanKindIcon span={span} /></span><div><h3>{span.name}</h3><p>{SPAN_KIND_LABELS[span.kind]} Span · {span.id}</p></div></div><StatusTag status={span.status} /></div>
    <Tabs defaultActiveKey="io" items={[
      { key: 'io', label: '输入与输出', children: <div className="obs-io-panel"><Descriptions size="small" column={2} items={[{ key: 'summary', label: '调用说明', children: span.summary, span: 2 }, { key: 'provider', label: '服务商', children: span.provider || '内部执行' }, { key: 'model', label: '模型／组件', children: span.model || SPAN_KIND_LABELS[span.kind] }, { key: 'duration', label: '执行耗时', children: formatDuration(span.durationMs) }, { key: 'attempt', label: '尝试序号', children: span.attempt || 1 }, ...Object.entries(span.metadata).slice(0, 6).map(([key, value]) => ({ key, label: key, children: String(value) }))]} /><div className="obs-code-block"><div><span><CodeOutlined /> 输入（已脱敏）</span><Button type="text" size="small" onClick={() => void copy(span.input)}>复制</Button></div><pre>{span.input}</pre></div><div className="obs-code-block"><div><span><CodeOutlined /> 输出（已脱敏）</span><Button type="text" size="small" onClick={() => void copy(span.output)}>复制</Button></div><pre>{span.output}</pre></div></div> },
      { key: 'context', label: '调用上下文', children: <ContextInspector run={run} span={span} /> },
      { key: 'usage', label: '用量与异常', children: <div className="obs-usage-panel"><div className="obs-usage-numbers"><div><small>输入 Tokens</small><b>{formatTokens(span.usage?.input ?? null)}</b></div><div><small>输出 Tokens</small><b>{formatTokens(span.usage?.output ?? null)}</b></div><div><small>总 Tokens</small><b>{formatTokens(span.usage?.total ?? null)}</b></div><div><small>估算成本</small><b>{money(span.estimatedCost ?? null)}</b></div></div>{span.usage?.source === 'unavailable' || !span.usage ? <Alert type="warning" showIcon title="用量或成本未知" description="该节点没有完整的服务商用量，或未配置可匹配价格。未知值不按 0 计入完整成本。" /> : <Alert type="success" showIcon title="服务商已返回用量" description="成本仍只是按本地原型价格规则计算，不代表服务商账单。" />}{span.errorCode && <div className="obs-inline-error"><BugOutlined /><div><b>{span.errorCode}</b><p>{span.output}</p></div><Button onClick={() => message.info('可在异常中心按错误指纹查看聚合记录')}>查看错误说明</Button></div>}<Descriptions size="small" column={1} items={[{ key: 'source', label: '用量来源', children: span.usage?.source === 'provider' ? '服务商实际返回' : '未提供' }, { key: 'run', label: 'Run ID', children: run.id }, { key: 'trace', label: 'Trace ID', children: run.traceId }, { key: 'redaction', label: '脱敏策略', children: 'redaction-v1 · 密钥与请求头永不采集' }]} /></div> },
    ]} />
  </div>
}

export function ObservabilityRunDetail() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const run = observabilityRuns.find((item) => item.id === runId)
  const spans = observabilitySpans.filter((span) => span.runId === runId)
  const [selected, setSelected] = useState(params.get('span') || spans[0]?.id || '')
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false)
  useEffect(() => { setSelected(params.get('span') || spans[0]?.id || '') }, [runId])
  if (!run) return <Result status="404" title="未找到这条原型运行记录" extra={<Button onClick={() => navigate('/observability/runs')}>返回运行链路</Button>} />
  const selectedSpan = spans.find((span) => span.id === selected) || spans[0]
  return <PageShell active="runs" title={run.name} description={`${run.id} · ${run.startedAt}`} actions={<Space><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/observability/runs')}>返回列表</Button><Button className="obs-mobile-tree-button" icon={<BranchesOutlined />} onClick={() => setMobileTreeOpen(!mobileTreeOpen)}>调用树</Button></Space>}>
    <div className="obs-run-summary"><div><RunKindTag kind={run.kind} /><StatusTag status={run.status} />{run.errorCode && <Tag color="error">{run.errorCode}</Tag>}</div><div className="obs-run-facts"><span><small>目标</small><b>{run.target}</b></span><span><small>总耗时</small><b>{formatDuration(run.durationMs)}</b></span><span><small>总 Tokens</small><b>{formatTokens(run.usage.total)}</b></span><span><small>估算成本</small><b>{money(run.estimatedCost)}</b></span><span><small>成本覆盖率</small><b>{run.costCoverage}%</b></span></div><Progress percent={run.progress} size="small" status={run.status === 'failed' ? 'exception' : run.status === 'succeeded' ? 'success' : 'active'} /></div>
    {run.kind === 'chat' && <div className="obs-conversation-summary"><div><MessageOutlined /><span><small>用户问题</small><b>{run.query}</b></span></div><p>{run.answer || '本次运行未生成可用回答。'}</p></div>}
    <div className={`obs-trace-layout ${mobileTreeOpen ? 'tree-open' : ''}`}>
      <aside className="obs-trace-sidebar"><div className="obs-panel-title"><span>调用树</span><Tag>{spans.length} Spans</Tag></div><TraceTree spans={spans} selected={selectedSpan?.id || ''} onSelect={(id) => { setSelected(id); setMobileTreeOpen(false) }} /><div className="obs-trace-id"><small>TRACE ID</small><code>{run.traceId}</code><span>OpenTelemetry 兼容语义</span></div></aside>
      <section className="obs-trace-main"><Card title="瀑布时间轴" extra={<span className="obs-card-note">点击阶段可联动节点详情</span>}><TraceWaterfall run={run} spans={spans} selected={selectedSpan?.id || ''} onSelect={setSelected} /></Card>{selectedSpan ? <Card className="obs-span-card"><SpanDetail run={run} span={selectedSpan} /></Card> : <Empty description="此运行没有 Span 记录" />}</section>
    </div>
  </PageShell>
}

export function ObservabilityErrors() {
  const navigate = useNavigate()
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ObservabilityError | null>(null)
  const errors = observabilityErrors.filter((error) => (category === 'all' || error.category === category) && (severity === 'all' || error.severity === severity) && (!search || `${error.code} ${error.message}`.toLowerCase().includes(search.toLowerCase())))
  const columns: TableColumnsType<ObservabilityError> = [
    { title: '严重度', key: 'severity', width: 100, render: (_, error) => <Tag color={error.severity === 'critical' ? 'error' : error.severity === 'error' ? 'volcano' : 'warning'}>{error.severity === 'critical' ? '严重' : error.severity === 'error' ? '错误' : '警告'}</Tag> },
    { title: '错误码 / 摘要', key: 'error', width: 380, render: (_, error) => <div className="obs-table-stack"><b>{error.code}</b><small>{error.message}</small></div> },
    { title: '分类', dataIndex: 'category', width: 130 },
    { title: '次数', dataIndex: 'count', width: 80 },
    { title: '最近发生', dataIndex: 'lastOccurredAt', width: 170 },
    { title: '可重试', key: 'retry', width: 90, render: (_, error) => error.retryable ? '是' : '否' },
    { title: '操作', key: 'action', width: 160, render: (_, error) => <Space><Button type="link" onClick={() => setSelected(error)}>详情</Button><Button type="link" onClick={() => navigate(`/observability/runs/${error.runId}?span=${error.spanId}`)}>定位 Trace</Button></Space> },
  ]
  return <PageShell active="errors" title="异常中心" description="按错误指纹聚合业务、模型、上下文与 Harness 异常，快速回到原始调用现场。" actions={<Button icon={<ReloadOutlined />} onClick={() => { setCategory('all'); setSeverity('all'); setSearch('') }}>重置筛选</Button>}>
    <div className="obs-metrics-grid errors"><MetricCard label="异常事件" value={number(observabilityErrors.reduce((sum, error) => sum + error.count, 0))} note="按错误指纹聚合前" icon={<BugOutlined />} tone="red" /><MetricCard label="严重异常" value={number(observabilityErrors.filter((error) => error.severity === 'critical').length)} note="需要优先检查 Harness" icon={<WarningOutlined />} tone="orange" /><MetricCard label="影响 Run" value={number(new Set(observabilityErrors.map((error) => error.runId)).size)} note="可逐条定位原始链路" icon={<BranchesOutlined />} /><MetricCard label="用量不完整" value={number(observabilityErrors.filter((error) => error.code === 'USAGE_UNAVAILABLE').length)} note="成功不等于用量完整" icon={<InfoCircleOutlined />} tone="violet" /></div>
    <div className="obs-filter-panel"><Input prefix={<SearchOutlined />} placeholder="搜索错误码或摘要" value={search} onChange={(event) => setSearch(event.target.value)} allowClear /><Select aria-label="异常分类" value={category} onChange={setCategory} options={[{ value: 'all', label: '全部分类' }, ...['模型调用', '检索质量', '工具／Skill', '上下文', 'Harness', '可观测自身'].map((value) => ({ value, label: value }))]} /><Select aria-label="异常严重度" value={severity} onChange={setSeverity} options={[{ value: 'all', label: '全部严重度' }, { value: 'warning', label: '警告' }, { value: 'error', label: '错误' }, { value: 'critical', label: '严重' }]} /></div>
    <Card className="obs-table-card"><Table rowKey="id" columns={columns} dataSource={errors} scroll={{ x: 1160 }} pagination={false} /></Card>
    <Drawer title="异常详情" size={620} open={Boolean(selected)} onClose={() => setSelected(null)} extra={selected && <Button type="primary" onClick={() => navigate(`/observability/runs/${selected.runId}?span=${selected.spanId}`)}>定位 Trace</Button>}>{selected && <div className="obs-error-drawer"><Alert type={selected.severity === 'warning' ? 'warning' : 'error'} showIcon title={selected.code} description={selected.message} /><Descriptions column={1} size="small" items={[{ key: 'category', label: '异常分类', children: selected.category }, { key: 'fingerprint', label: '错误指纹', children: selected.fingerprint }, { key: 'count', label: '聚合次数', children: `${selected.count} 次` }, { key: 'first', label: '首次发生', children: selected.firstOccurredAt }, { key: 'last', label: '最近发生', children: selected.lastOccurredAt }, { key: 'retry', label: '建议重试', children: selected.retryable ? '可按业务幂等规则重试' : '不建议自动重试' }, { key: 'run', label: '关联 Run', children: selected.runId }, { key: 'span', label: '关联 Span', children: selected.spanId }]} /><div className="obs-code-block"><div><CodeOutlined /> 安全诊断信息</div><pre>{`error.category=${selected.category}\nerror.code=${selected.code}\nretryable=${selected.retryable}\napi_key=[EXCLUDED]\nauthorization=[EXCLUDED]\nprovider_response=[REDACTED]`}</pre></div><Alert type="info" showIcon title="当前角色选择不是安全边界" description="真实登录与服务端授权上线前，不开放不可信网络中的敏感原文查看。" /></div>}</Drawer>
  </PageShell>
}

interface UsageGroup { key: string; requests: number; input: number; output: number; total: number; cost: number; unknown: number }

export function ObservabilityUsage() {
  const { message } = AntApp.useApp()
  const [groupBy, setGroupBy] = useState('provider')
  const [priceRules, setPriceRules] = useState<PriceRule[]>(initialPriceRules)
  const [editing, setEditing] = useState<PriceRule | 'new' | null>(null)
  const [form] = Form.useForm()
  const groups = useMemo(() => {
    const map = new Map<string, UsageGroup>()
    observabilityRuns.forEach((run) => {
      const key = groupBy === 'model' ? run.model : groupBy === 'application' ? run.target : groupBy === 'knowledge' ? run.secondaryTarget.split(' · ')[0] : run.provider
      const current = map.get(key) || { key, requests: 0, input: 0, output: 0, total: 0, cost: 0, unknown: 0 }
      current.requests += 1
      current.input += run.usage.input || 0
      current.output += run.usage.output || 0
      current.total += run.usage.total || 0
      current.cost += run.estimatedCost || 0
      if (run.usage.total === null || run.estimatedCost === null) current.unknown += 1
      map.set(key, current)
    })
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [groupBy])
  const total = sumKnownTokens(observabilityRuns)
  const maxTotal = Math.max(...groups.map((group) => group.total), 1)
  const openRule = (rule: PriceRule | 'new') => { setEditing(rule); form.resetFields(); form.setFieldsValue(rule === 'new' ? { provider: '通义百炼', capability: 'LLM', currency: 'CNY', inputPrice: 0, outputPrice: 0, requestPrice: 0, effectiveFrom: '2026-10-31', sourceNote: '手工配置价格，仅用于估算' } : rule) }
  const saveRule = async () => {
    const values = await form.validateFields()
    if (editing === 'new') setPriceRules((rules) => [...rules, { ...values, id: `price-${Date.now()}` }])
    else if (editing) setPriceRules((rules) => rules.map((rule) => rule.id === editing.id ? { ...rule, ...values } : rule))
    setEditing(null)
    message.success('价格规则已保存在本次原型会话中')
  }
  const columns: TableColumnsType<ObservabilityRun> = [
    { title: 'Run / 类型', key: 'run', width: 260, render: (_, run) => <div className="obs-table-stack"><b>{run.id}</b><small>{run.kind === 'chat' ? '在线问答' : '知识库构建'} · {run.model}</small></div> },
    { title: '输入 Tokens', key: 'input', width: 140, render: (_, run) => formatTokens(run.usage.input) },
    { title: '输出 Tokens', key: 'output', width: 140, render: (_, run) => formatTokens(run.usage.output) },
    { title: '总 Tokens', key: 'total', width: 140, render: (_, run) => formatTokens(run.usage.total) },
    { title: '用量来源', key: 'source', width: 140, render: (_, run) => <Tag color={run.usage.source === 'provider' ? 'success' : 'warning'}>{run.usage.source === 'provider' ? '服务商返回' : '未提供'}</Tag> },
    { title: '估算成本', key: 'cost', width: 130, render: (_, run) => <span className={run.estimatedCost === null ? 'obs-unknown' : ''}>{money(run.estimatedCost)}</span> },
    { title: '覆盖率', dataIndex: 'costCoverage', width: 100, render: (value) => `${value}%` },
  ]
  const priceColumns: TableColumnsType<PriceRule> = [
    { title: '服务商 / 模型', key: 'model', render: (_, rule) => <div className="obs-table-stack"><b>{rule.model}</b><small>{rule.provider} · {rule.capability}</small></div> },
    { title: '币种', dataIndex: 'currency', width: 80 },
    { title: '输入 / 百万 Tokens', dataIndex: 'inputPrice', width: 170, render: (value, rule) => `${rule.currency === 'CNY' ? '¥' : '$'}${value}` },
    { title: '输出 / 百万 Tokens', dataIndex: 'outputPrice', width: 170, render: (value, rule) => `${rule.currency === 'CNY' ? '¥' : '$'}${value}` },
    { title: '生效日期', dataIndex: 'effectiveFrom', width: 120 },
    { title: '操作', key: 'action', width: 80, render: (_, rule) => <Button type="link" icon={<EditOutlined />} onClick={() => openRule(rule)}>编辑</Button> },
  ]
  return <PageShell active="usage" title="Token 与成本" description="按服务商、模型和业务目标分析真实用量；成本仅按价格规则估算，未知值绝不按零补齐。" actions={<Space><Button icon={<DownloadOutlined />} onClick={() => downloadCsv('知枢-Token用量-原型.csv', [['Run ID', '输入', '输出', '总计', '用量来源', '估算成本'], ...observabilityRuns.map((run) => [run.id, run.usage.input ?? '未知', run.usage.output ?? '未知', run.usage.total ?? '未知', run.usage.source, run.estimatedCost ?? '未知'])])}>导出明细</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openRule('new')}>新增价格规则</Button></Space>}>
    <div className="obs-metrics-grid"><MetricCard label="已知总 Tokens" value={number(total)} note="未返回用量不计入" icon={<NodeIndexOutlined />} tone="violet" /><MetricCard label="模型请求 Run" value={number(observabilityRuns.length)} note="构建与问答合并视图" icon={<ApiOutlined />} /><MetricCard label="CNY 估算成本" value={money(observabilityRuns.reduce((sum, run) => sum + (run.estimatedCost || 0), 0))} note="不与 USD 直接相加" icon={<DollarOutlined />} tone="orange" /><MetricCard label="完整成本覆盖" value={`${Math.round(observabilityRuns.filter((run) => run.costCoverage === 100).length / observabilityRuns.length * 100)}%`} note={`${observabilityRuns.filter((run) => run.estimatedCost === null).length} 次成本未知`} icon={<LineChartOutlined />} tone="green" /></div>
    <Alert className="obs-usage-alert" type="warning" showIcon title="估算成本 ≠ 服务商账单" description="缺少 Token、价格或计量方式不支持时显示“未知”。历史价格按生效时间匹配，不同币种分开统计。" />
    <Card title="用量分析" extra={<Select aria-label="用量分组" value={groupBy} onChange={setGroupBy} options={[{ value: 'provider', label: '按服务商' }, { value: 'model', label: '按模型' }, { value: 'application', label: '按应用／知识库' }, { value: 'knowledge', label: '按索引／知识目标' }]} />}><div className="obs-usage-bars"><div className="obs-usage-bars-head"><span>分组</span><span>Tokens 与占比</span><span>估算成本</span></div>{groups.map((group) => <div className="obs-usage-bar-row" key={group.key}><div><b>{group.key}</b><small>{group.requests} 次 Run · {number(group.total)} Tokens{group.unknown ? ` · ${group.unknown} 项不完整` : ''}</small></div><div className="obs-usage-track"><i style={{ width: `${Math.max(2, group.total / maxTotal * 100)}%` }} /><span>{number(group.total)}</span></div><strong>{money(group.cost)}</strong></div>)}</div></Card>
    <Card title="价格规则" className="space-top" extra={<Tag>原型会话内生效</Tag>}><Table rowKey="id" columns={priceColumns} dataSource={priceRules} pagination={false} scroll={{ x: 900 }} /><p className="obs-table-footnote">单价均为演示配置。生产实现需使用十进制计算，并保存价格来源和生效起止时间。</p></Card>
    <Card title="调用用量明细" className="space-top obs-table-card"><Table rowKey="id" columns={columns} dataSource={observabilityRuns} pagination={false} scroll={{ x: 1110 }} /></Card>
    <Drawer title={editing === 'new' ? '新增价格规则' : '编辑价格规则'} size={540} open={Boolean(editing)} onClose={() => setEditing(null)} extra={<Button type="primary" onClick={() => void saveRule()}>保存规则</Button>}><Form form={form} layout="vertical"><Alert className="space-bottom" type="info" showIcon title="仅用于本地估算，不会修改服务商价格。" /><Form.Item name="provider" label="服务商" rules={[{ required: true }]}><Select options={['通义百炼', 'AIHubmix', 'OpenRouter'].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="model" label="远程模型 ID" rules={[{ required: true, whitespace: true, message: '请输入模型 ID' }]}><Input placeholder="例如：qwen-plus" /></Form.Item><div className="obs-form-grid"><Form.Item name="capability" label="模型能力" rules={[{ required: true }]}><Select options={['LLM', 'Embedding', 'Rerank', 'OCR'].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="currency" label="币种" rules={[{ required: true }]}><Select options={[{ value: 'CNY', label: 'CNY · 人民币' }, { value: 'USD', label: 'USD · 美元' }]} /></Form.Item><Form.Item name="inputPrice" label="输入单价 / 百万 Tokens" rules={[{ required: true }]}><InputNumber min={0} step={0.1} /></Form.Item><Form.Item name="outputPrice" label="输出单价 / 百万 Tokens" rules={[{ required: true }]}><InputNumber min={0} step={0.1} /></Form.Item><Form.Item name="requestPrice" label="每次请求单价" rules={[{ required: true }]}><InputNumber min={0} step={0.01} /></Form.Item><Form.Item name="effectiveFrom" label="生效日期" rules={[{ required: true }]}><Input type="date" /></Form.Item></div><Form.Item name="sourceNote" label="价格来源备注" rules={[{ required: true, whitespace: true, message: '请填写价格来源说明' }]}><Input.TextArea rows={3} /></Form.Item></Form></Drawer>
  </PageShell>
}
