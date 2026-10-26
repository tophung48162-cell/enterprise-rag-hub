# 知枢 · 企业知识中台后端设计（1.0）

- 状态：待技术选型确认，尚未进入后端实现
- 日期：2026-10-27
- 范围：企业内部通用版，不含登录、SSO、多租户、计费、Agent 和工作流编排

## 1. 设计目标与边界

后端需要把当前前端 Mock 替换为真实服务，形成以下闭环：

```text
配置服务商与模型 → 创建知识库 → 上传原始文件 → 解析 / OCR
→ 预览与编辑分块 → 异步构建索引 → 检索测试
→ 配置并发布问答应用 → 流式对话与引用 → 日志和用量追踪
```

必须满足：

- 使用 Python LangChain 组织文档、Embedding、检索、Rerank 和 LLM 问答链路。
- 支持 Word、PDF（文字、图片、表格、扫描页）、Markdown、图片和表格。
- OCR 只调用云端 API，不要求下载或部署本地 OCR 模型。
- 支持 OpenRouter、AIHubmix、通义百炼；LLM、Embedding、Rerank 分开配置。
- 记录查询内容、引用、真实 Token、首 Token 耗时、总耗时、阶段耗时和错误。
- 保留管理员、知识库管理人员、使用者三种体验角色，但不把角色选择描述为身份认证。

暂不实现：用户体系、细粒度成员授权、多租户隔离、按量计费、自动 Agent、可视化工作流、跨企业数据共享。

## 2. 推荐技术组合

### 2.1 默认推荐

| 层次 | 推荐 | 选择理由 | 优势 | 代价／限制 |
| --- | --- | --- | --- | --- |
| API 框架 | FastAPI + Pydantic | 与 Python LangChain 同语言，适合异步模型调用和流式响应 | 类型清晰、OpenAPI 自动文档、生态成熟、开发快 | 后台任务不能放在 Web 进程内，需独立 Worker |
| ORM／迁移 | SQLAlchemy 2 + Alembic | 明确管理事务和数据库版本 | 适合复杂查询、迁移可审查 | 比直接使用轻量 ORM 多一些模板代码 |
| 元数据数据库 | PostgreSQL | 业务数据、任务状态、日志和权限范围需要事务与关联查询 | 稳定、备份成熟、减少组件数量 | 需要运维数据库 |
| 向量检索 | PostgreSQL + pgvector | 1.0 数据规模尚未证明需要独立向量数据库 | 向量与业务过滤同事务、部署简单、支持 HNSW | 超大规模、高吞吐或复杂混合检索不如专用服务灵活 |
| 原始文件存储 | MinIO（S3 兼容） | 原件、图片和解析产物不应塞进数据库或浏览器 | 私有桶、生命周期、便于迁移到云 OSS | 比本地磁盘多一个服务 |
| 缓存／队列 | Redis + Celery | 解析、OCR、Embedding 和索引必须异步、可重试 | 成熟、支持并发、超时、重试和 Worker 隔离 | Redis 与 Worker 增加部署和监控工作 |
| RAG 编排 | LangChain Python | 用户明确要求，且模型、文档和检索抽象适合本场景 | 模型与向量接口丰富、支持流式调用 | 需锁定版本；不能把框架抽象替代错误处理和事务 |
| 对话推送 | Fetch Streaming + SSE 事件格式 | POST 请求可携带应用、会话和问题，浏览器可直接消费 | 单向流式简单，便于传阶段、增量文本、引用和用量 | 需要处理断线、取消和代理缓冲 |
| 部署 | Docker Compose 单机 | 符合企业内部 1.0 和当前规模未知的边界 | 一键启动、依赖固定、易于验收 | 不等于高可用；后续再按规模升级 |

**默认组合：** `FastAPI + PostgreSQL/pgvector + MinIO + Redis/Celery + LangChain + Docker Compose`。

### 2.2 可替换方案

| 决策 | 方案 A | 方案 B | 建议 |
| --- | --- | --- | --- |
| 向量数据库 | pgvector：组件少、事务一致、适合 1.0 | Qdrant：向量过滤和扩展能力更专注，但新增数据库与备份体系 | 默认 A；预计百万级以上分块或检索压力明显时评估 B |
| 任务队列 | Celery：重试、路由和并发控制完整 | RQ：更简单，但复杂任务运营能力较少 | 默认 A |
| 文件存储 | MinIO：私有、S3 兼容 | 本地磁盘：简单，但备份、扩容和多 Worker 共享困难 | 默认 A；仅单元测试使用临时目录 |
| OCR | 通义云端 OCR／视觉模型：与现有服务商体系统一 | 其他云 OCR／文档智能服务：可能强化特定版式，但增加密钥和适配器 | 默认先接通义；以表格和扫描件验收结果决定是否增加第二适配器 |
| API 框架 | FastAPI：异步和 LangChain 衔接自然 | Django Ninja：后台管理能力更强，但本项目暂不做用户和复杂后台 | 默认 A |

### 2.3 不推荐用于 1.0 正式链路的选择

- Chroma／FAISS 本地文件：适合实验，不利于多 Worker 一致性、备份和版本切换。
- Web 进程内 `BackgroundTasks` 构建索引：部署重启会丢失任务，无法可靠控制资源。
- 把 PDF、图片或 API Key 存入前端 Local Storage：存在容量、持久性和安全问题。
- 用一个“OpenAI 兼容”适配器假设所有服务商能力完全一致：Embedding、Rerank、流式用量和错误格式需要分别验证。

## 3. 总体架构

```text
React 前端
   │ 同源 /api/v1，JSON / multipart / SSE
   ▼
FastAPI API 服务
   ├── 角色体验上下文与输入校验
   ├── 业务事务、配置和会话
   ├── 模型网关 ───────────────┐
   └── 任务提交                │
          │                    │
          ▼                    │
Redis / Celery Worker           │
   ├── 文件解析与云端 OCR       │
   ├── 分块与 Embedding         │
   └── 索引版本构建             │
                               ▼
                  OpenRouter / AIHubmix / 通义百炼

PostgreSQL + pgvector：业务记录、分块、向量、日志
MinIO：原始文件、解析产物、页面图片和表格附件
Redis：队列、短期状态和限流计数（不作为业务真相来源）
```

部署进程：`frontend`、`api`、`worker`、`postgres`、`minio`、`redis`。1.0 可以由同一台 Docker 主机承载，但 API 与 Worker 必须是不同进程。

## 4. 后端模块划分

```text
backend/
├── app/
│   ├── api/v1/              # 路由、请求／响应 Schema、SSE
│   ├── core/                # 配置、异常、时间、ID、加密
│   ├── db/                  # Engine、Session、Alembic 迁移
│   ├── models/              # SQLAlchemy 持久化模型
│   ├── services/            # 事务与业务规则
│   ├── ingestion/           # 文件检测、解析器、OCR、分块
│   ├── indexing/            # 索引版本、向量写入、切换
│   ├── retrieval/           # 召回、过滤、Rerank、引用
│   ├── chat/                # LangChain RAG、上下文预算、取消
│   ├── providers/           # LLM／Embedding／Rerank 适配器
│   ├── storage/             # S3／MinIO 对象存储
│   └── observability/       # 请求日志、模型调用、指标
├── workers/                 # Celery 任务入口
├── tests/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   └── fixtures/            # 各格式小型测试文件
└── pyproject.toml
```

LangChain 用在 `ingestion`、`indexing`、`retrieval`、`chat` 和模型适配边界；数据库状态、权限校验、事务和任务幂等仍由业务服务负责。

## 5. 核心数据模型

所有表使用 UUID 主键和 UTC 时间戳。模型、知识库、应用之间使用稳定 UUID 外键，不使用模型名称或显示名作为关联键。

### 5.1 配置与知识资产

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `providers` | `id`、`kind`、`name`、`base_url`、`secret_ciphertext`、`enabled` | 密钥只写不读，接口仅返回掩码和已配置状态 |
| `model_configs` | `id`、`provider_id`、`remote_model_id`、`capability`、`dimensions`、`enabled`、`config_json` | `capability` 为 LLM／Embedding／Rerank；记录真实能力探测结果 |
| `knowledge_bases` | `id`、`name`、`description`、`department`、`visibility`、`embedding_model_id`、`rerank_model_id`、`chunk_config`、`active_index_version_id` | `visibility` 控制是否允许应用关联；不代替用户认证 |
| `documents` | `id`、`kb_id`、`original_name`、`mime`、`extension`、`size_bytes`、`sha256`、`object_key`、`status`、`parser_version`、`error_code` | 保存原件元数据和处理状态，不保存二进制大字段 |
| `document_assets` | `id`、`document_id`、`kind`、`page_number`、`bbox_json`、`object_key` | PDF 图片、页面截图、表格附件等 |
| `parsed_documents` | `id`、`document_id`、`version`、`parser`、`ocr_provider`、`content_hash`、`created_at` | 每次解析形成不可变版本，是重建分块的数据源 |
| `parsed_blocks` | `id`、`parsed_document_id`、`sequence`、`kind`、`text`、`page_number`、`bbox_json`、`metadata_json` | 段落、标题、图片 OCR、表格行／单元格及来源坐标 |

### 5.2 分块与索引

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `chunks` | `id`、`kb_id`、`document_id`、`parsed_document_id`、`sequence`、`text`、`content_hash`、`token_count`、`source_json`、`edited_at` | 保存来源页码、标题路径、表格位置和人工编辑记录 |
| `index_versions` | `id`、`kb_id`、`embedding_model_id`、`dimensions`、`chunk_config`、`status`、`created_at`、`activated_at` | `building → ready → active → archived`，失败不覆盖旧版本 |
| `chunk_embeddings` | `chunk_id`、`index_version_id`、`embedding`、`model_calls_id` | 向量与索引版本绑定；不同维度不得混入同一版本 |

索引版本切换必须在数据库事务中完成：新版本全部写入并校验后，才更新知识库的 `active_index_version_id`。问答只读取当前活动版本；重建期间继续使用旧版本，旧版本延迟归档。

### 5.3 应用、会话与日志

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `assistants` | `id`、`name`、`description`、`llm_model_id`、`system_prompt`、`top_k`、`candidate_k`、`similarity_threshold`、`rerank_enabled`、`published_at` | 保存草稿和发布配置 |
| `assistant_knowledge_bases` | `assistant_id`、`kb_id` | 多知识库关联及顺序 |
| `conversations` | `id`、`assistant_id`、`title`、`created_at`、`updated_at` | 1.0 不关联登录用户 |
| `messages` | `id`、`conversation_id`、`role`、`content`、`status`、`created_at` | 支持用户、助手和系统状态 |
| `citations` | `id`、`message_id`、`chunk_id`、`ordinal`、`score`、`snapshot_text` | 快照保证后续重建后仍能审阅当次引用 |
| `query_runs` | `id`、`conversation_id`、`assistant_id`、`query`、`answer`、`role_context`、`status`、`llm_model_id`、`input_tokens`、`output_tokens`、`first_token_ms`、`total_ms`、`error_code` | 一次问答一条主记录；状态含成功、失败、停止 |
| `run_knowledge_bases` | `run_id`、`kb_id` | 完整记录多知识库范围 |
| `run_stages` | `run_id`、`stage`、`started_at`、`duration_ms`、`status`、`metadata_json` | 检索、Rerank、生成等阶段耗时 |
| `model_calls` | `id`、`run_id`、`task_id`、`provider_id`、`model_config_id`、`capability`、`input_tokens`、`output_tokens`、`total_tokens`、`duration_ms`、`usage_source`、`status` | 统一记录索引和问答模型调用；`usage_source` 区分服务商返回与本地估算 |
| `tasks` | `id`、`type`、`kb_id`、`document_id`、`status`、`progress`、`attempt`、`idempotency_key`、`error_code`、`payload_json` | 持久化任务状态，Redis 不作为唯一记录 |

## 6. 状态机与事务规则

### 6.1 文档处理

```text
uploaded → parsing → parsed → chunking → pending_index → indexing → ready
              │          │          │             │
              └──────────┴──────────┴─────────────┴──→ failed
```

- `failed` 保存阶段、错误码和可重试标记，不向用户暴露密钥或堆栈。
- 重试从最近一个完整产物继续；原件解析失败才重跑 OCR，避免重复收费。
- 文档删除时先阻止运行中的可写任务，再使后续任务通过版本检查失效，最后清理数据库和对象。
- 同一文档、同一解析参数、同一索引参数使用幂等键，防止双击产生重复任务。

### 6.2 人工编辑与重建

- 编辑分块只修改当前草稿，不直接改历史引用快照。
- 重建始终读取 `parsed_blocks` 或明确保存的人工修订，不把旧分块拼接后再次切分。
- 修改 Embedding 模型、向量维度或分块参数必须创建新索引版本。
- 新版本激活前，旧分块和旧索引继续服务；新版本激活后，检索测试和问答自动使用同一活动版本。

## 7. 文件解析设计

### 7.1 上传安全与校验

- 每批最多 20 份、单文件最大 50 MB；前后端同时校验，以后端为准。
- 校验扩展名、MIME、实际文件签名和空文件；拒绝可执行内容和路径穿越文件名。
- 按 SHA-256 和同知识库文件名检测重复，重复策略由接口明确返回，不静默覆盖。
- 原件写入私有 MinIO 桶；下载通过短期签名 URL 或受控代理，不暴露永久公网地址。

### 7.2 各格式策略

| 格式 | 首选解析方式 | 结构化输出 |
| --- | --- | --- |
| DOC／DOCX | DOCX 直接解析段落、标题、表格和图片关系；旧 DOC 先通过受控转换服务 | 标题路径、段落、表格、图片 OCR 块 |
| PDF | PyMuPDF／pdfplumber 提取文字、页面与表格；扫描页或低文本密度页走云 OCR | 页码、块坐标、表格结构、图片 OCR 来源 |
| Markdown | 按标题层级解析，保留代码块和表格边界 | 标题路径、段落、列表、代码、表格 |
| PNG／JPG／WEBP | 云端 OCR；保留原图及识别区域 | 文本块、区域坐标、原图引用 |
| XLSX／XLS | 按 Sheet、表头和行组解析，不把整表无结构转成一长串文本 | Sheet、行号、列名、单元格来源 |
| CSV | 编码检测后按表头和行组解析 | 行号、列名和值 |

OCR 通过统一 `OcrProvider` 接口接入。默认使用通义云端能力，接口只接收必要文件或受控临时 URL；调用前记录数据出站边界。任何 OCR 失败都不得静默生成“示例内容”。

### 7.3 分块策略

- 结构优先：标题路径 + 语义段落，再按 Token 目标长度切分。
- 普通文本可使用 LangChain 文本分割器，保留来源 metadata。
- 表格按表头 + 行组生成可检索文本，同时保留结构化 JSON 和原始 Sheet／单元格坐标。
- 图片 OCR 文本保留页码和区域；无有效文本时标记为空，不进入向量索引。
- `chunk_size`、`overlap` 按 Token 计算并校验；预览与正式构建必须调用同一个分块实现和相同参数。

## 8. 模型网关

### 8.1 统一接口

```text
ChatProvider.stream(messages, config, cancel_token)
EmbeddingProvider.embed_documents(texts, config)
EmbeddingProvider.embed_query(text, config)
RerankProvider.rerank(query, documents, top_n, config)
Provider.probe_capabilities(config)
```

- OpenAI 兼容协议只是传输层，不代表模型能力一致。
- 通义文本 Rerank 和多模态 Rerank 可能存在接口差异，分别适配。
- OpenRouter 的 Chat、Embedding 和 Rerank 分别配置远程模型 ID。
- AIHubmix 在实现阶段用账号可用模型做契约测试；未验证的能力不允许保存为可用配置，也不静默用 LLM 模拟 Rerank。
- 连接测试按所选模型能力发起最小真实请求，返回延迟和用量；失败显示脱敏后的服务商错误。

### 8.2 密钥与调用约束

- API Key 只在服务端提交和保存，使用主密钥加密；主密钥由部署环境注入。
- 读取接口永不返回明文，日志、异常和链路详情均脱敏。
- 模型被知识库或应用引用时禁止直接改名、改类型、改维度和删除。
- 已激活索引的 Embedding 配置不可原地变化，只能创建新版本。
- 为每个服务商设置连接／读取超时、有限重试、并发限制和速率错误退避；非幂等 LLM 请求不盲目重试。

## 9. 检索与 LangChain 问答链路

### 9.1 检索

```text
问题 → 校验应用与知识库范围 → 读取各库活动索引
→ Query Embedding → 每库向量召回 candidate_k
→ 合并去重 → 可选真实 Rerank → Top K → 构造带来源的上下文
```

- 向量召回阈值与 Rerank 分数分开，避免把不同模型的分值视为同一量纲。
- 只检索 `ready` 文档、活动索引和当前应用明确关联的知识库。
- 多知识库结果保留全部 `kb_id`，日志不得只记录首个命中库。
- Rerank 不可用时按应用配置返回明确错误或执行已声明的降级，不能假装完成了重排。
- 1.0 先做向量召回 + Rerank；关键词／混合检索在基准测试证明有收益后再加。

### 9.2 生成

使用 LangChain 组合检索器、消息历史和 Chat Model：

1. 仅携带有限的近期对话；必要时先生成独立检索问题，保留原始问题用于日志。
2. 为系统提示词、历史、检索上下文和输出分别设置 Token 预算，超限优先减少上下文块而不是截断来源标识。
3. 要求模型仅依据上下文回答，资料不足时明确说明；文档内指令视为不可信数据。
4. 上下文使用稳定引用编号，返回引用 ID、文件、页码、原文快照和分数。
5. 流式输出发送真实增量；结束后持久化完整回答、引用和用量。
6. 无命中时直接返回“没有找到足够依据”，不调用 LLM 编造答案。

### 9.3 SSE 事件

```text
run_started       { run_id, conversation_id }
retrieval_done    { citations, duration_ms }
generation_delta  { delta }
usage             { input_tokens, output_tokens, usage_source }
done              { message_id, duration_ms }
error             { error_code, message, retryable }
```

客户端中断或调用取消接口时，服务端向上游传播取消，主记录标记 `stopped`；已经产生的用量和耗时如实保留。不能把停止请求误记为成功。

## 10. API 设计（`/api/v1`）

统一错误结构：

```json
{
  "error": {
    "code": "MODEL_CAPABILITY_UNSUPPORTED",
    "message": "该模型不支持 Rerank",
    "request_id": "req_...",
    "retryable": false,
    "details": {}
  }
}
```

列表接口使用 `page`、`page_size`、`keyword` 和明确筛选字段；变更接口支持 `Idempotency-Key`。时间返回 ISO 8601 UTC。

### 10.1 服务商与模型

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET / POST` | `/providers` | 查询／创建服务商；密钥只写 |
| `PATCH / DELETE` | `/providers/{id}` | 修改配置／删除未引用服务商 |
| `POST` | `/providers/{id}/test` | 真实连接测试 |
| `GET / POST` | `/models` | 查询／创建模型配置 |
| `PATCH / DELETE` | `/models/{id}` | 修改／删除，执行依赖保护 |
| `POST` | `/models/{id}/test` | 按 LLM／Embedding／Rerank 能力测试 |

### 10.2 知识库、文件与任务

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET / POST` | `/knowledge-bases` | 列表／创建 |
| `GET / PATCH / DELETE` | `/knowledge-bases/{id}` | 详情／设置／删除保护 |
| `GET` | `/knowledge-bases/{id}/documents` | 文件列表和状态筛选 |
| `POST` | `/knowledge-bases/{id}/documents` | multipart 上传原件并创建解析任务 |
| `GET / DELETE` | `/documents/{id}` | 文件详情／删除 |
| `POST` | `/documents/{id}/preview` | 使用指定解析与分块参数生成预览 |
| `POST` | `/documents/{id}/retry` | 从失败阶段重试 |
| `GET` | `/documents/{id}/chunks` | 分块列表、正文和来源 |
| `PATCH` | `/chunks/{id}` | 编辑草稿分块，标记待索引 |
| `POST` | `/knowledge-bases/{id}/index-versions` | 创建异步重建任务 |
| `GET` | `/knowledge-bases/{id}/index-versions` | 查看活动版和历史版 |
| `POST` | `/knowledge-bases/{id}/retrieval-test` | 使用活动索引召回和 Rerank |
| `GET` | `/tasks/{id}` | 进度、阶段和错误；前端轮询 |

### 10.3 应用、对话与日志

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET / POST` | `/assistants` | 应用列表／创建 |
| `GET / PATCH / DELETE` | `/assistants/{id}` | 详情／编辑／删除 |
| `POST` | `/assistants/{id}/publish` | 校验知识库开放状态、模型可用性和索引后发布 |
| `POST` | `/assistants/{id}/unpublish` | 取消发布，不删除历史会话 |
| `GET / POST` | `/conversations` | 历史会话／新建 |
| `GET / DELETE` | `/conversations/{id}` | 消息详情／删除 |
| `POST` | `/conversations/{id}/messages` | 发送问题，SSE 返回生成过程 |
| `POST` | `/query-runs/{id}/cancel` | 停止生成 |
| `GET` | `/logs` | 按时间、知识库、模型、状态和关键词分页 |
| `GET` | `/logs/{id}` | 问答、全部知识来源、引用、用量和阶段详情 |

## 11. 角色与无登录边界

| 能力 | 管理员 | 知识库管理人员 | 使用者 |
| --- | --- | --- | --- |
| 服务商／模型配置 | 允许 | 拒绝 | 拒绝 |
| 知识库管理 | 全部 | 标记为管理范围的知识库 | 拒绝 |
| 应用配置 | 全部 | 管理范围内应用 | 拒绝 |
| 已发布应用对话 | 允许 | 允许 | 允许 |
| 日志 | 全部 | 完整位于管理范围内的记录 | 拒绝 |

1.0 可以用受控角色上下文驱动接口检查，但由于没有登录，请求方可以切换角色，**这不是安全权限边界**。部署时必须限制在受信内网或网关之后；如果未来要防止越权，必须引入真实身份认证和服务端授权，不能仅靠前端隐藏菜单。

## 12. 日志、用量与可观测性

- 每次请求生成 `request_id`，贯穿 API、任务、模型调用和前端错误提示。
- 查询日志保存问题、回答、角色上下文、应用、全部知识库、引用、模型和状态。
- Token 优先使用服务商返回值；缺失时才本地估算，并以 `usage_source=estimated` 明确标识。
- 记录首 Token、检索、Rerank、生成和总耗时；停止与失败同样记录。
- 应用日志默认不记录 API Key、完整请求头、原始文件内容或模型上下文中的敏感配置。
- 查询内容本身可能敏感，应提供保留期限和清理任务；1.0 默认可配置保留天数。
- 健康检查区分存活与就绪；就绪检查数据库、Redis、MinIO，不在健康检查中调用收费模型。

## 13. 部署与配置

```yaml
services:
  frontend:   # 静态构建与反向代理 /api
  api:        # FastAPI
  worker:     # Celery，独立资源限额
  postgres:   # PostgreSQL + pgvector，持久卷
  minio:      # 私有对象存储，持久卷
  redis:      # 队列与短期状态，持久化策略按部署确定
```

配置分为：

- 部署配置：数据库、Redis、MinIO、加密主密钥、CORS、文件限制、日志保留期。
- 页面配置：服务商 Base URL、模型 API Key、模型能力、知识库和应用参数。
- 前端只接收 API 地址和非敏感运行信息，不内置任何服务商密钥。

备份至少覆盖 PostgreSQL 和 MinIO，并做一次恢复演练。升级使用 Alembic 迁移，禁止启动时静默修改生产表结构。

## 14. 测试与验收设计

### 14.1 每模块自测

| 模块 | 必测内容 |
| --- | --- |
| 模型网关 | 三家服务商分能力契约测试、超时、限流、错误脱敏、Token 解析 |
| 上传解析 | 各格式真实样本、扫描 PDF、图片、表格、空文件、伪造扩展名、超大文件 |
| 分块索引 | 预览与构建一致、人工编辑、重复任务、失败重试、版本切换、旧索引可用 |
| 检索 | 活动版本隔离、多库过滤、无命中、Rerank 顺序、来源页码和表格坐标 |
| 对话 | 多轮上下文、真实流式、停止、异常、上下文预算、引用与回答对应 |
| 日志 | 真实／估算用量标识、首 Token 和阶段耗时、多库来源、失败与停止状态 |
| 权限边界 | 各角色菜单对应接口均校验，不能通过直接调用 URL 绕过 |

### 14.2 端到端验收

使用一组包含文字、图片和表格的真实测试资料跑通：

```text
配置通义 LLM／Embedding／Rerank → 新建知识库 → 上传混合资料
→ 检查 OCR 和表格分块 → 构建 → 检索测试 → 发布应用
→ 在线多轮流式问答 → 打开引用 → 查看真实 Token 和耗时
```

再用 OpenRouter、AIHubmix 分别执行其账号实际支持能力的契约测试。任何服务商未支持的能力必须显示“不支持”，而不是以演示数据通过验收。

性能目标需在明确分块规模、文档大小和并发量后确定；当前不虚构企业容量指标。

## 15. 实施顺序

1. **工程骨架**：Docker Compose、数据库迁移、MinIO、统一错误和健康检查；验证服务启动与对象读写。
2. **模型网关**：服务商、模型、密钥和真实连接测试；完成分能力契约测试。
3. **知识接入**：上传、解析、云 OCR、解析产物和分块预览；完成格式样本测试。
4. **索引检索**：异步任务、版本化向量索引、重建、召回和 Rerank；完成一致性与失败恢复测试。
5. **问答应用**：应用发布校验、LangChain RAG、多轮 SSE、停止和引用；完成真实模型联调。
6. **日志与收尾**：真实用量、阶段耗时、筛选、部署文档和混合格式端到端验收。

每个模块完成后先自测和修复，再进入下一模块；前端通过 API Client 逐步替换 Mock，保留已有空态、失败、无权限和加载交互。

## 16. 开始编码前需要确认

若无其他调整，回复“按推荐方案”即表示选择：

1. FastAPI + SQLAlchemy／Alembic。
2. PostgreSQL + pgvector。
3. MinIO + Redis／Celery。
4. LangChain Python + SSE。
5. 云端 OCR 先接通义，其他云 OCR 通过适配器扩展。
6. Docker Compose 单机部署作为 1.0 交付方式。

如需调整，只需指出对应组件，例如“向量数据库改用 Qdrant”。确认后才创建后端代码和安装相关依赖。

## 17. 官方资料

- LangChain 模型与流式：https://docs.langchain.com/oss/python/langchain/models
- LangChain 流式：https://docs.langchain.com/oss/python/langchain/streaming
- pgvector：https://github.com/pgvector/pgvector
- 通义向量模型：https://help.aliyun.com/zh/model-studio/embedding-interfaces-compatible-with-openai
- 通义 Rerank：https://help.aliyun.com/zh/model-studio/rerank
- OpenRouter RAG：https://openrouter.ai/docs/guides/evaluate-and-optimize/rag
- OpenRouter Rerank：https://openrouter.ai/docs/api/api-reference/rerank/submit-a-rerank-request
