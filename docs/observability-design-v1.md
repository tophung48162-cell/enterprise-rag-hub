# 知枢 · RAG 中台可观测模块设计（1.0）

- 状态：**推荐方案已于 2026-10-31 确认；阶段 A 真实对话 Trace 已接入前后端**
- 日期：2026-10-29；原型与阶段 A 更新：2026-10-31
- 目标：让知识库构建、检索增强问答、模型与工具调用、异常和用量成本可以在同一条调用链中定位与复盘
- 当前基础：已有知识库任务、索引版本、问答 `QueryRun`、消息、引用快照、服务商 Token 和耗时记录；阶段 A 新增 Span、ModelCall、ErrorEvent 及真实查询接口。React 联机展示真实对话 Trace、异常和用量，断线时保留明确标记的脱敏原型。构建 Trace、完整上下文快照、工具／Skill 调用、异常指纹聚合和成本核算仍未接入

## 阶段 A 已交付范围（2026-10-31）

- 复用 `query_runs.id` 作为问答 Run ID，以根 Span ID 作为 `trace_id`；SSE `meta` 同步返回 `run_id` 与 `trace_id`。
- 新表 `observability_spans`、`model_calls`、`error_events`，迁移版本 `0005_observability`；历史 QueryRun 无 Span 时详情返回空数组，不伪造节点。
- 记录 LoadConfig、逐库 Retrieval、QueryEmbedding、VectorSearch、可选 Rerank、MergeAndRank、BuildContext、LLM、PersistResult，以及成功、失败和停止状态。异常时闭合仍为 running 的 Span／ModelCall。
- 模型调用记录服务商、模型、能力、耗时、首 Token、输入／输出／总 Token 和 `provider/unavailable` 用量来源；服务商未返回用量时运行仍可成功，同时生成 `USAGE_UNAVAILABLE` 警告。
- 提供 `GET /api/v1/observability/summary`、`/runs`、`/runs/{run_id}`、`/errors`。总览含真实状态、7 日趋势与慢模型调用；异常本阶段逐条返回，`count=1`，尚未按指纹聚合。
- 仅保存有界摘要和结构化元数据，不保存密钥、完整 Prompt 或 Base64。`estimated_cost=null`、`cost_coverage=0`，不做价格或账单推算。
- 联机前端展示真实总览、Run、Trace、异常和 Token；BuildContext 只展示实际元数据，并明确提示“完整消息快照将在阶段 B 接入”。价格规则仍仅为页面原型，不写服务端。

阶段 A 自动化验收覆盖成功、失败脱敏、用量缺失、历史 Run 兼容和真实前端联动；停止路径已实现，但未把单元级闭合测试描述为完整浏览器断流验收。真实云账号、PostgreSQL／pgvector 与 Docker 环境仍需另行联调。

## 1. 建设目标与边界

### 1.1 要回答的问题

1. 一次知识库构建停在哪个阶段，调用了哪些模型、工具或 Skill，哪次尝试失败？
2. 一次问答实际检索了什么、重排结果如何、最终把哪些历史和知识片段发给了模型？
3. 每次调用的输入输出、状态、耗时、重试和 Token 是多少，为什么失败或被截断？
4. 某个服务商、模型、知识库、应用或时间范围内的用量与估算成本是多少？
5. 超时、Worker 离线、队列消息丢失、SSE 中断、上下文溢出等 Harness 异常如何被发现和关联？

### 1.2 第一期不做

- 不做正式扣费、账单支付或服务商账单自动对账。
- 不用本地 Token 估算冒充服务商返回用量。
- 不为了展示而虚构 Agent、工具或 Skill 节点；没有实际发生的调用不出现。
- 不引入独立可观测平台作为 1.0 的强制部署依赖。
- 不在当前“角色选择”体验模式下宣称已经具备安全的数据隔离。

当前知识库构建主要是确定性任务流水线，不是自主规划 Agent。界面统一称“构建 Run”；只有未来实际引入 Agent 决策时，才增加 Agent 根节点和决策 Span。

## 2. 信息架构与页面设计

一级导航新增“可观测”，默认进入总览。所有列表共用时间范围、关键词和筛选条件；从总览指标可下钻到已带筛选条件的 Run 列表。

| 页面 | 核心内容 | 主要操作 |
| --- | --- | --- |
| 可观测总览 | 构建与问答运行量、成功率、失败数、P50／P95 耗时、Token、估算成本、异常趋势 | 筛选、下钻、刷新、导出聚合数据 |
| 构建 Run | 文档解析、OCR、分块、Embedding、索引激活的链路和批次进度 | 查看 Trace、重试入口、按知识库／文档／版本筛选 |
| 对话 Trace | 问题、回答、检索、Rerank、LLM、引用、Token、首 Token 与总耗时 | 查看完整链路、上下文和引用，跳转异常 |
| 工具／Skill 详情 | 单次调用参数、返回、状态、耗时、重试、错误及上下游 Span | 在调用树中定位、复制脱敏内容 |
| 上下文检查 | 最终消息数组、系统提示词、历史、知识片段、引用编号、预算和截断记录 | 展开原文、对照发送前后内容、查看哈希 |
| 异常中心 | 业务错误、模型错误、工具／Skill 错误和 Harness 系统事件 | 按错误码聚合、查看影响范围、跳转 Trace |
| Token 与成本 | 按服务商、模型、能力、应用、知识库和时间聚合用量与估算成本 | 配置价格规则、导出明细、识别未知用量 |

建议路由在确认原型时落为 `/observability`、`/observability/runs/:runId`、`/observability/errors`、`/observability/usage`；详情使用同一 Trace 页，通过节点抽屉展示模型、工具、Skill 和上下文，避免多个页面丢失调用链位置。

## 3. 可观测总览

### 3.1 顶部筛选

- 时间：最近 1 小时、24 小时、7 天、30 天、自定义；明确显示时区。
- 类型：全部、知识库构建、在线问答、检索测试、OCR、后台 Agent。
- 范围：知识库、文档、应用、会话、服务商、模型、运行状态。
- 体验角色仅作为已有业务上下文展示，不作为权限过滤器。

### 3.2 指标与图表

- 运行卡：总 Run、成功、失败、停止、运行中；成功率分母只含已结束 Run。
- 性能卡：端到端 P50／P95、问答首 Token P50／P95、构建平均耗时。
- 用量卡：输入、输出、总 Token；另列“用量未知调用数”，不能把未知当作 0。
- 成本卡：可估算成本、覆盖率和无法估算原因；标题固定为“估算成本”。
- 趋势图：按小时或天展示 Run、失败、Token、估算成本；支持同类筛选项联动。
- 异常排行：错误码、出现次数、受影响 Run、最近发生时间。
- 慢调用排行：模型、工具、Skill 的 P95 和最大耗时，点击定位到具体 Span。

样本不足时不展示误导性的百分位精度；没有数据时显示空状态，不生成演示曲线。

## 4. 构建 Run 与 Agent Trace

### 4.1 列表字段

`Run ID｜知识库｜文档｜索引版本｜状态｜当前阶段｜进度｜模型调用｜Token｜耗时｜重试｜开始时间`

支持按知识库、文档、任务、索引版本、模型、服务商、状态和错误码筛选。列表只展示已持久化事实；队列延迟、执行耗时和激活耗时分列，避免把等待时间误算为模型耗时。

### 4.2 详情布局

- 顶部：Run 状态、知识库／文档／版本、开始与结束时间、总耗时、重试次数、脱敏错误摘要。
- 左侧：父子调用树，显示阶段、状态、耗时、模型／工具／Skill 图标和异常数量。
- 中间：时间轴或瀑布图，展示串行、并行批次、排队和重试；可选择单个 Span。
- 右侧：选中节点的输入、输出、元数据、Token、上下文、错误和关联实体。
- 底部：该 Run 的模型调用、用量记录和 Harness 系统事件。

### 4.3 标准构建链路

```text
KnowledgeBuild Run
├── Upload / Validate Span
├── Parse Span
│   ├── OCR ModelCall（按需）
│   └── DocumentAsset ToolCall（如实际使用）
├── Chunk Span
├── Embedding Stage Span
│   ├── Embedding ModelCall · batch 1
│   ├── Embedding ModelCall · batch 2
│   └── …
├── VectorWrite Span
├── Validate Span
└── ActivateIndex Span
```

每个 Embedding 批次记录分块数量、字符量、向量维度、源哈希、尝试序号和服务商用量；不在每个分块上默认创建数据库 Span，以免观测数据超过业务数据。需要下钻时提供批次内失败分块 ID 列表。

若未来加入 Agent：

```text
Agent Run
├── AgentDecision Span（输入、结构化决策、输出）
├── Tool Span / Skill Span
│   └── 实际模型或子任务 Span
└── AgentDecision Span（后续决策）
```

自主决策次数、最大步数、终止原因和循环检测必须进入 Run 元数据。

## 5. 对话日志与问答 Trace

### 5.1 对话列表

保留现有查询内容、回答、应用、知识来源、状态、Token、首 Token 和总耗时，增加：

- `trace_id`、引用数、检索候选数、Rerank 状态、模型调用次数。
- 错误码、上下文截断标记、用量来源、估算成本。
- 按应用、会话、知识库、服务商、模型、状态和时间组合筛选。
- 默认脱敏显示问题与回答；长文本截断展示，但详情可按权限查看完整内容。

### 5.2 单次问答链路

```text
Chat Run（现有 query_runs.id 作为 run_id）
├── LoadConfig Span
├── Retrieval Span（每个知识库一个子 Span）
│   ├── QueryEmbedding ModelCall
│   ├── VectorSearch Span
│   └── Rerank ModelCall（启用时）
├── MergeAndRank Span
├── BuildContext Span
├── LLM ModelCall（流式）
└── PersistResult Span
```

Trace 中可对照查看：

- 原始问题、改写问题（未来如有）、最近 12 条历史消息。
- 每个知识库的活动索引版本、候选池、阈值、Top K 和召回耗时。
- 向量评分、Rerank 评分、合并去重和最终排序原因。
- 发给 LLM 的引用编号与最终回答使用的引用编号。
- 流式首 Token、结束时间、停止／断开连接位置、服务商 usage 是否返回。
- 持久化后的不可变引用原文快照，避免后续编辑导致复盘失真。

## 6. 模型、工具与 Skill 调用详情

### 6.1 模型调用

一次实际 provider 请求对应一条 `ModelCall`，重试产生新记录，不覆盖前一次：

- 服务商、模型配置 ID、远程模型 ID、能力和请求 ID。
- 脱敏输入、原始输出或流式聚合输出、输出截断标记。
- 开始／结束时间、队列等待、首 Token、总耗时、HTTP／服务商状态。
- 输入、输出、缓存和总 Token；`usage_source=provider/unavailable`。
- 尝试序号、父调用、是否重试、退避时长、脱敏错误码。

密钥、请求头、完整 Base64 图片和临时签名 URL 永不进入观测字段；图片只保留资产 ID、尺寸、类型、哈希和受控预览引用。

### 6.2 工具调用

记录工具名称与版本、结构化参数、返回摘要、状态、耗时、超时、重试、错误码和调用方 Span。输入输出使用 JSON 查看器，大文本折叠并支持下载脱敏副本。

`VectorSearch` 等内部确定性步骤默认是 Span，不为了界面丰富而改名成 Tool；只有经过真实工具抽象执行时才记录 `ToolCall`。

### 6.3 Skill 调用

记录 Skill 名称与版本、调用原因、输入参数、产出、状态、耗时、实际子步骤、异常和退出原因。Skill 本身不是模型调用，其内部模型、工具请求通过 `parent_span_id` 挂到该 Skill 下，Token 不能在上游重复累计。

## 7. 调用上下文检查

### 7.1 展示内容

1. **配置快照**：应用提示词版本、模型与参数、知识库顺序、Top K、候选池、阈值、Rerank 开关。
2. **最终消息数组**：按实际顺序展示 System、历史 User／Assistant 和当前 User 消息；这是“最终发送内容”，不是事后重建的近似文本。
3. **知识上下文**：每段的引用编号、知识库、文档、分块 ID、原文、双评分和字符／Token 预算。
4. **历史选择**：纳入和排除的消息 ID、原因、原始顺序。
5. **预算与截断**：模型上下文窗口、系统／历史／知识／输出预留、实际占用、裁剪顺序和被裁剪项。
6. **完整性校验**：上下文快照哈希、消息数量、是否完整保存、存储位置和采集时间。

### 7.2 当前实现的缺口

现有问答只按 Top K、候选池和最近 12 条消息限制上下文，尚无完整 Token 预算与动态裁剪。因此第一期原型可以设计预算区域，但后端埋点必须先实现真实的最终消息快照和预算计算，才能展示“已截断”等结论；在此之前只能显示“未启用动态预算”。

### 7.3 快照策略

- 小文本存 PostgreSQL，大输入输出和完整消息数组存私有 MinIO，数据库保留元数据、哈希和对象键。
- 默认保存结构化摘要；原文采集按运行类型配置开关、采样率和最大字节数。
- 超长内容保留头尾、长度、哈希和 `truncated=true`，不能静默丢失。
- 内容脱敏在持久化前执行；仅记录规则版本，不保存用于还原敏感原文的映射表。

## 8. 异常中心与 Harness 事件

### 8.1 异常分类

| 类别 | 示例 | 默认严重度 |
| --- | --- | --- |
| 业务校验 | 应用未发布、知识库不可用、模型被停用 | info／warning |
| 模型调用 | 鉴权失败、限流、超时、空响应、响应格式错误 | warning／error |
| 检索质量 | 无命中、活动索引缺失、向量维度不一致 | info／error |
| 工具／Skill | 参数校验失败、工具超时、Skill 不存在、子步骤失败 | warning／error |
| 上下文 | 超预算、截断、引用编号不一致、消息反序列化失败 | warning／error |
| Harness | Worker 离线、进程退出、任务丢失、DB 提交失败、SSE 意外断开、取消竞态、重试耗尽 | error／critical |
| 可观测自身 | Span 未闭合、快照写入失败、用量字段缺失、价格缺失 | warning |

服务商未返回 Token 是“用量未知”警告，不应把已成功问答标记为失败。用户主动停止单独记为 `stopped`，不计入系统故障率；异常断开需要区分客户端取消与服务器错误。

### 8.2 异常详情与操作

展示错误码、分类、脱敏摘要、首次／最近发生、次数、影响 Run、关联模型／工具／Skill、堆栈指纹和可重试性。内部堆栈仅服务端受控保存，API 默认不返回密钥、请求头或服务商原始敏感响应。

支持按指纹聚合、筛选、跳转 Trace 和导出；第一期不自动重试失败问答，避免重复模型收费。构建重试沿用现有幂等和业务约束。

## 9. Token 与成本分析

### 9.1 用量口径

- 单次调用：只采用服务商实际返回的 usage；缺失时字段为 `null`、`usage_source=unavailable`。
- Run 汇总：累加其所有实际模型调用，包括 Embedding、OCR、Rerank、LLM 和 Agent 内部调用；父子 Span 不重复累加。
- 输入、输出、缓存读取、缓存写入和总 Token 分列；不同服务商 total 定义不一致时保留原始 usage JSON。
- Rerank 等不返回 Token 的模型保留请求数、文档数等可用计量，不伪造 Token。

### 9.2 价格规则

`PriceRule` 支持：

- 服务商、远程模型 ID、能力、币种。
- 输入／输出／缓存读取／缓存写入的每百万 Token 单价。
- 每次请求、每张图片、每千份文档等适配器明确支持的单价。
- 生效起止时间、价格来源备注、创建与更新时间。

历史成本使用调用开始时间对应的价格版本，价格修改不回写历史结果。使用十进制数值计算；不同币种不直接相加，未完成汇率换算时分币种展示。

### 9.3 估算与未知状态

```text
模型调用估算成本 = 各项实际用量 × 命中价格规则之和
Run 估算成本 = 可估算模型调用成本之和
```

必须同时显示：

- `estimated_cost`：按本地配置价格计算，不是服务商账单。
- `cost_coverage`：有用量且有匹配价格的调用占比。
- `unknown_reason`：缺少 Token、缺少价格、币种不一致或计量方式不支持。

缺少任一项时对应成本显示“未知”，不能按 0 计入后声称是完整成本。总览提供价格配置完成率和未知用量排行。

### 9.4 分析视图

按日／周／月、服务商、模型、能力、知识库、应用、构建／问答类型分组；图表展示 Token、请求数、估算成本和成本覆盖率。明细导出包含 Run／ModelCall ID 和口径字段，便于复核。

## 10. 统一 Trace 与数据模型

### 10.1 标识和层级

兼容 OpenTelemetry Trace／Span 语义，使用：

```text
trace_id：一次端到端业务链路的稳定 ID
run_id：一次构建、问答或 Agent 运行
span_id：一个阶段或调用
parent_span_id：直接父节点；根节点为空
```

API、Celery Worker 和子任务通过任务载荷传播 `trace_id / run_id / parent_span_id`；外部模型只接收业务必需内容，不依赖服务商支持 Trace 协议。时间统一 UTC 时间戳，耗时用单调时钟测量，ID 和关联键使用 UUID。

### 10.2 表设计

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `observability_runs` | `id`、`trace_id`、`kind`、`status`、`kb_id`、`document_id`、`index_version_id`、`assistant_id`、`conversation_id`、`started_at`、`ended_at`、`duration_ms`、`attempt`、`metadata_json` | 统一运行索引；现有 `query_runs.id` 作为问答 Run ID，保留业务明细，避免复制问答正文 |
| `observability_spans` | `id`、`trace_id`、`run_id`、`parent_span_id`、`kind`、`name`、`status`、`started_at`、`ended_at`、`duration_ms`、`sequence`、`attributes_json`、`error_code` | 构建、检索、上下文、工具、Skill、Agent 和系统事件统一节点 |
| `model_calls` | `id`、`span_id`、`provider_id`、`model_config_id`、`remote_model_id`、`capability`、`provider_request_id`、`attempt`、`status`、`input_object_key`、`output_object_key`、`first_token_ms`、`duration_ms`、`error_code` | 一次真实 provider 请求一条，重试不覆盖 |
| `tool_calls` | `id`、`span_id`、`name`、`version`、`input_json`、`output_object_key`、`status`、`attempt`、`duration_ms`、`error_code` | 真实工具调用及结构化参数 |
| `skill_calls` | `id`、`span_id`、`name`、`version`、`reason`、`input_json`、`output_object_key`、`status`、`exit_reason`、`duration_ms`、`error_code` | Skill 与子 Span 关联，不重复计算 Token |
| `context_snapshots` | `id`、`run_id`、`span_id`、`kind`、`object_key`、`content_hash`、`message_count`、`byte_size`、`budget_json`、`truncated`、`redaction_version`、`created_at` | 保存最终实际上下文和预算证据 |
| `usage_records` | `id`、`model_call_id`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`、`total_tokens`、`request_count`、`raw_usage_json`、`usage_source` | 原始与标准化用量并存，未知保持 `null` |
| `error_events` | `id`、`run_id`、`span_id`、`category`、`severity`、`code`、`safe_message`、`fingerprint`、`retryable`、`internal_object_key`、`occurred_at` | 业务、模型和 Harness 异常统一检索 |
| `price_rules` | `id`、`provider_id`、`remote_model_id`、`capability`、`currency`、`unit_prices_json`、`effective_from`、`effective_to`、`source_note` | 版本化价格，仅用于成本估算 |

所有大对象键均指向私有存储；接口通过受控读取，不暴露永久公网地址。建立 `trace_id`、`run_id`、状态、开始时间、知识库／应用、模型和错误码索引，列表统一游标分页。

### 10.3 状态机

```text
Run / Span：queued → running → succeeded
                    │       ├→ failed
                    │       ├→ stopped
                    │       └→ timed_out

Model / Tool / Skill：running → succeeded / failed / stopped / timed_out
```

- `queued` 只用于 Run 或异步阶段，模型请求未发出时不虚构运行中 Span。
- 进程崩溃无法写入最终状态时，由心跳和超时扫描标记 `timed_out` 或 `unknown`，并生成 Harness 事件；不能永久显示 `running`。
- 父子状态不必相同：父 Run 可带警告成功；父失败必须能定位至少一个失败节点或 Harness 事件。
- 所有终态必须有结束时间；允许用量为空，不允许为填表而估算。

## 11. 埋点实现方案

1. 新增轻量内部 `RunRecorder / SpanRecorder`，业务服务显式创建根 Run 和关键 Span，保证数据库事务与状态语义可控。
2. LangChain 回调用于补充模型请求、流式首 Token、usage 和工具事件，但不让回调直接控制业务事务。
3. 模型网关统一生成 `ModelCall`，对成功、空响应、异常、取消和重试分别闭合记录。
4. Celery 在入队、出队、执行、重试和完成处记录事件；任务载荷带链路 ID 与幂等键。
5. SSE 记录客户端主动停止、连接异常和服务端异常；落库失败不能再通过已断开的流假定客户端已知。
6. 观测写入失败不阻断主问答或构建，但必须写服务端告警并标记 `observability_incomplete=true`，不能显示“完整 Trace”。
7. 字段命名兼容 OpenTelemetry，预留 OTLP 导出适配器；1.0 默认仍用 PostgreSQL／MinIO，无需新增 Collector。

## 12. 查询接口草案

```text
GET /api/v1/observability/summary
GET /api/v1/observability/runs
GET /api/v1/observability/runs/{run_id}
GET /api/v1/observability/runs/{run_id}/spans
GET /api/v1/observability/model-calls/{id}
GET /api/v1/observability/tool-calls/{id}
GET /api/v1/observability/skill-calls/{id}
GET /api/v1/observability/contexts/{id}
GET /api/v1/observability/errors
GET /api/v1/observability/usage
GET /api/v1/observability/usage/export
GET|POST|PATCH /api/v1/observability/price-rules
```

详情接口默认返回脱敏内容。`include_content=true` 不能绕过权限；当前无认证期间不开放“敏感原文查看”作为安全能力。

## 13. 脱敏、权限与保留策略

### 13.1 当前安全边界

目前的管理员、知识库管理人员、使用者只是前端角色选择，没有真实登录、用户身份或服务端鉴权。因此：

- 观测页面可用于内部原型和受控环境联调，但不能防止用户切换角色查看他人内容。
- 不在 1.0 宣称已实现原文查看权限、跨部门隔离或审计安全边界。
- 若部署到不可信网络，应先完成真实认证、服务端授权和审计，再开放完整问题、回答、知识片段与上下文。

### 13.2 默认保护

- 永远排除 API Key、Authorization、Cookie、连接串、完整签名 URL 和请求头。
- 对邮箱、手机号、证件号、常见密钥模式进行规则脱敏；保留 `redaction_version` 和命中计数。
- 服务端异常对外只返回安全错误码与摘要，内部堆栈单独受控保存。
- 导出文件使用相同脱敏和权限规则，并记录导出时间、筛选范围和操作者上下文。
- 后续鉴权上线后，原文查看使用独立权限，不与“能看指标”混为一谈。

### 13.3 采样与保留

建议默认值，实施前可配置：

- 指标、状态、错误和用量：100% 采集。
- 成功 Run 原文：默认关闭或按采样率采集；失败 Run 原文在授权且开启时优先保留。
- 大快照：单对象大小上限，超限保存头尾、哈希和截断标记。
- 聚合指标 90 天、Trace 元数据 30 天、原文快照 7 天；错误元数据可延长到 90 天。
- 到期由后台任务清理 MinIO 对象和数据库记录；业务消息、引用快照是否删除仍由业务保留策略独立决定。

## 14. 性能与一致性边界

- 观测写入采用批量、异步方式，但 Run 终态与用量需优先持久化；不能因追加大文本阻塞 SSE 主链路。
- 大列表只查元数据，输入输出和上下文按需读取；树形 Span 分页加载，单次 Run 设置最大展示节点数。
- Embedding 按批次记录，向量本身、完整文件和 Base64 不进入 Trace。
- 汇总表或按时间预聚合用于总览，避免每次扫描全部 ModelCall；数据量大后再评估专用时序／列式存储。
- 业务记录和观测记录允许最终一致，页面明确标注最后更新时间和不完整性。
- 成本汇总以 `model_call_id` 幂等去重；重试新调用可累计，重复 Worker 消息不可重复累计。

## 15. 分阶段实施与验收

### 阶段 A：统一链路与对话 Trace

- 接入 Run／Span、模型调用、状态、耗时、Token、错误和现有问答日志关联。
- 打通检索、Rerank、上下文构建、LLM、持久化及 SSE 取消。
- 验收：任意成功／失败／停止问答均能通过一个 Run ID 还原实际调用顺序；Token 与现有服务商返回一致，未知不变成 0。

### 阶段 B：构建 Trace、异常中心与上下文

- 覆盖 OCR、分块、Embedding 批次、索引写入和激活，传播 Celery 链路 ID。
- 保存最终模型消息、引用映射和预算证据，接入 Harness 超时／离线／断开等事件。
- 验收：故障注入能定位到具体批次和尝试；上下文快照与实际发送内容哈希一致；Worker 异常不会永久显示运行中。

### 阶段 C：工具／Skill／Agent 与成本分析

- 仅对真实存在的工具、Skill 和 Agent 调用埋点。
- 增加价格规则、估算成本、覆盖率、聚合分析和导出。
- 验收：父子调用不重复计数；价格生效时间正确；缺 Token／价格时明确未知；不同币种不混合求和。

### 全量质量要求

- 单元测试：状态机、ID 传播、脱敏、用量汇总、价格版本、未知成本和截断。
- 契约测试：列表筛选、游标分页、Trace 树、详情权限、导出字段。
- 故障测试：模型超时、流中断、Worker 重启、重复消息、快照写失败和价格缺失。
- 浏览器测试：总览下钻、构建与对话 Trace、上下文、异常跳转、成本筛选和移动端布局。
- 性能验收目标在真实 PostgreSQL 环境确定数据量后设定，不用 SQLite 替身结果冒充生产性能结论。

## 16. 推荐第一期原型范围

建议第一轮原型直接覆盖完整信息架构，但后端按阶段 A 优先实施：

1. 可观测总览：真实空状态、核心指标、趋势和异常排行。
2. Run 列表与统一详情：构建／对话切换、调用树、时间轴和节点抽屉。
3. 对话 Trace：问题、回答、检索、引用、模型输入输出和 Token。
4. 上下文检查：消息数组、知识片段、引用编号和预算／截断状态。
5. 异常中心：错误聚合、Harness 分类和 Trace 跳转。
6. Token 与成本：用量、价格规则、估算成本、覆盖率和未知原因。
7. 工具／Skill／Agent 节点：使用明确的空状态或真实测试夹具，不混入生产演示数据。

## 17. 已确认决策（2026-10-31）

用户已选择“按推荐方案”，对应确认结果如下：

1. **原型范围**：按第 16 节一次补齐七类页面，再分阶段接后端。
2. **原文采集**：采用默认脱敏、有限保留方案；成功调用原文默认关闭或采样，失败原文需在授权且开启时采集。
3. **保留期**：采用“原文 7 天、Trace 30 天、聚合 90 天”的默认值。
4. **成本口径**：只提供按价格规则估算的成本和覆盖率，不接服务商正式账单。
5. **权限前提**：真实登录上线前，观测模块只用于受控内部环境，不承诺角色间的数据安全隔离。
6. **实施顺序**：先完成“对话 Trace + 构建 Trace + 异常 + 用量”，再接工具／Skill／Agent 和成本价格规则。

**前端原型与阶段 A 真实对话 Trace 已完成；下一阶段进入阶段 B 的知识库构建 Trace、完整上下文快照和 Harness 异常补强。异常指纹聚合与价格规则后端仍按后续阶段推进。**
