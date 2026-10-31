# 知枢后端

FastAPI + LangChain 后端当前实现服务商／模型配置、真实模型连接测试、云端 OCR、知识库与 Markdown 持久化分块、版本化向量索引、向量检索与 Rerank、问答应用、持久化会话、SSE 检索增强问答、引用快照、Token 日志、真实对话与索引构建 Trace、完整上下文快照，以及 Alembic 迁移和独立 Celery Worker。

## 已实现

- OpenRouter、AIHubmix、通义百炼服务商配置；API Key 使用 Fernet 加密后存入数据库，读取接口不返回明文。
- LLM、Embedding、Rerank 分能力配置和最小真实 HTTP 连接测试。
- 通义 OCR 模型通过 LangChain `ChatOpenAI` 接收 Base64 图片；记录真实响应、Token 和耗时。
- PNG、JPEG、WEBP 文件签名校验；原图写入私有 S3／MinIO 存储。
- 同步识别、持久化异步识别、结果查询和失败记录重试。
- OCR 状态保存在 PostgreSQL：`queued → processing → ready / failed`；Redis 只承担队列和短期结果，不是任务真相来源。
- 知识库创建、列表、设置与非空删除保护；被知识库引用的模型不能删除。
- Markdown 文件名、空文件、50 MB、UTF‑8、二进制与重复内容校验；原件保存到 S3／MinIO，元数据保存到 PostgreSQL。
- LangChain `MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter` 持久化分块、幂等重切、人工编辑与文档删除清理。
- LangChain `OpenAIEmbeddings` 每批 32 个分块调用服务商，校验返回数量和维度；当前结果未暴露可靠 Token 用量时明确记录 `usage_source=unavailable`。
- `queued / building / active / ready / failed` 索引版本、源分块 SHA‑256 校验、构建进度、耗时和脱敏错误码；全部成功后才切换活动版本，旧版本向量快照保留。
- 生产使用 pgvector 类型，SQLite 测试使用 JSON 变体；构建期间锁定知识修改，重复 Worker 消息不重复调用已激活版本。
- 查询固定使用活动版本的 Embedding 模型；PostgreSQL 通过 pgvector 余弦距离召回候选，SQLite 测试使用等价余弦计算。
- 支持相似度阈值、候选池和 Top K；Rerank 在整个候选池内排序，返回向量／重排双评分及阶段耗时，无效响应和调用失败明确报错。
- 问答应用持久化、知识库去重、模型能力校验和发布约束；已发布应用使用的知识库不能直接关闭或删除。
- 会话、消息、引用快照、QueryRun 和关联知识库持久化；删除会话时显式清理相关记录。
- LangChain `ChatOpenAI` 流式问答，启用 `stream_usage`；多知识库检索合并、最近 12 条多轮历史、系统提示词和引用编号约束。
- SSE `meta / citations / token / done / error` 事件；成功、失败和中断状态落库，公开错误不泄露 API Key 或上游堆栈。
- Token 只记录服务商 `usage_metadata`，未提供时保持空值和 `usage_source=unavailable`，不按字符估算；同时记录首 Token 和总耗时。
- 真实对话 Trace：根 Span、配置、逐库检索、Embedding、向量查询、可选 Rerank、上下文、LLM 和持久化节点；`meta` 返回 `trace_id`。
- 真实索引构建 Trace：复用 `index_versions.id` 作为构建 Run ID，记录源校验、Embedding 阶段与批次、向量写入、索引校验和激活；失败闭合运行中节点，重试追加新的批次尝试。
- `knowledge_activities` 在上传和分块操作发生时保存真实耗时、参数、数量、状态与脱敏错误；新构建 Trace 挂载每份当前文档最新的成功上传／分块节点，重复分块不会重复堆叠历史节点，历史文档没有活动记录时不补造。
- `observability_spans / model_calls / error_events` 通过可空 `run_id`／`build_id` 分别关联问答与构建；异常时闭合未完成节点，提供合并总览、Run、Trace 详情、原始异常与指纹聚合接口，历史无 Span 的 Run 保持兼容。
- 异常指纹聚合跨构建与问答统计发生次数、去重影响 Run、首次／最近发生时间和组内最高严重度；最新事件用于摘要、重试建议与 Trace 定位，原始事件接口保持不变。
- `context_snapshots` 在 LLM 调用前保存实际消息数组、元数据和 SHA‑256 上下文哈希；详情接口按 BuildContext 返回完整快照，旧对话无快照时不做事后重建。
- Celery 有限重试、指数退避、软／硬超时和独立 Worker 进程。
- 存活／数据库就绪检查、请求 ID 和统一脱敏错误结构。

## 尚未实现

Word／PDF／Excel 服务端解析、HNSW 索引、价格规则后端与正式账单仍属于后续阶段；OCR 和其他格式文档解析尚未纳入构建 Trace，动态 Token 预算、快照采样与保留清理也尚未实现。上传／分块失败活动已持久化，但独立失败活动查询页面仍待补强。React 已接入本 README 中的真实接口，并保留明确标记的浏览器演示回退。当前联调测试使用 HTTP 替身，真实云服务、PostgreSQL／pgvector 和容器运行仍未验收。

## 本地开发

要求 Python 3.12+，并准备 PostgreSQL、Redis 和 S3／MinIO。完整依赖可使用仓库根目录的 Docker Compose。

```bash
# 在仓库根目录执行一次
python -m venv .venv
.venv/bin/pip install -e './backend[dev]'
cp .env.example .env
cp .env.example backend/.env

# 生成自己的主密钥，分别写入根目录和 backend/.env
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

`backend/.env` 至少设置 `HUB_ENCRYPTION_KEY`；不使用 Compose 时，还需按实际地址设置 `HUB_DATABASE_URL`、`HUB_REDIS_URL` 和 `HUB_S3_*`。

```bash
cd backend
../.venv/bin/alembic upgrade head
../.venv/bin/uvicorn app.main:app --reload --port 8000

# 另开终端，仍在 backend 目录
../.venv/bin/celery -A workers.celery_app.celery_app worker --loglevel=INFO --concurrency=2
```

API 文档位于 `http://localhost:8000/docs`。启动前必须运行迁移；生产环境禁止用 `create_all` 代替 Alembic。

## Docker Compose

在仓库根目录配置 `.env` 后执行：

```bash
docker compose config
docker compose up --build
```

Compose 启动 `frontend`、`api`、`worker`、`postgres`、`minio`、`redis`，并通过一次性 `minio-init` 创建私有桶。API 启动时先执行 Alembic，Worker 等待 API 就绪后启动。当前开发机未安装 Docker，因此仓库只完成了 Compose 静态校验，尚未进行容器运行验收。

## 知识库与 Markdown 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET / POST` | `/api/v1/knowledge-bases` | 知识库列表／创建 |
| `GET / PATCH / DELETE` | `/api/v1/knowledge-bases/{id}` | 详情／设置／非空删除保护 |
| `GET / POST` | `/api/v1/knowledge-bases/{id}/documents` | 文档列表／multipart Markdown 上传 |
| `GET / DELETE` | `/api/v1/documents/{id}` | 文档详情／删除原件及分块 |
| `POST` | `/api/v1/documents/{id}/preview` | 按参数由 LangChain 重切并持久化分块 |
| `GET` | `/api/v1/documents/{id}/chunks` | 查询持久化分块 |
| `PATCH` | `/api/v1/chunks/{id}` | 编辑正文并标记 `pending_index` |

上传接口当前只接受 `.md`。同名或同 SHA‑256 文件会返回冲突；重复预览在事务内替换旧分块，不产生重复序号。预览只保存分块，需另行创建索引版本才会调用 Embedding。

## 版本化向量索引接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST / GET` | `/api/v1/knowledge-bases/{id}/index-versions` | 创建构建任务／查询版本列表 |
| `GET` | `/api/v1/index-versions/{id}` | 查询构建进度、耗时、用量和失败信息 |

索引构建通过 `index.build` 任务交给 Worker，LangChain 调用 OpenAI 兼容的 Embedding 接口。每次构建生成不可变向量快照；全部批次成功且维度一致后才激活新版本，失败时保留旧活动版本。当前使用 pgvector 向量字段，尚未建立 HNSW 索引。

## 向量检索接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/knowledge-bases/{id}/retrieval` | 活动索引向量召回、阈值过滤和可选 Rerank |

请求字段为 `query`、`top_k`、`candidate_k`、`similarity_threshold`、`rerank`。响应包含活动版本 ID、候选数量、Embedding／Rerank／总耗时，以及每项的来源快照、向量分数和重排分数。通义使用 `reranks`，OpenRouter／AIHubmix 使用 `rerank`；兼容顶层和通义 `output.results` 响应结构。

## 应用、会话与问答接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET / POST` | `/api/v1/assistants` | 应用列表／创建 |
| `PATCH` | `/api/v1/assistants/{id}` | 修改检索、提示词和发布配置 |
| `GET / POST` | `/api/v1/assistants/{id}/conversations` | 会话列表／创建 |
| `GET / DELETE` | `/api/v1/conversations/{id}` | 消息与引用详情／删除会话 |
| `POST` | `/api/v1/conversations/{id}/messages/stream` | SSE 检索增强流式回答 |
| `GET` | `/api/v1/query-runs` | 最近 200 条问答日志，可选 `kb_id` 筛选 |

SSE 依次发送 `meta`、`citations`、多个 `token` 和 `done`；失败发送 `error`。`meta` 同时返回 `trace_id`。回答完成后保存消息、不可变引用快照和服务商 Token 用量。客户端断开时记录 `stopped`，异常记录 `failed`，不会将部分回答标记为成功。

## 可观测接口（阶段 B）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/observability/summary` | 构建与问答合并指标、状态、7 日趋势和慢模型调用 |
| `GET` | `/api/v1/observability/runs` | 构建与对话 Run 列表；支持 `search/status/provider/kind/limit` |
| `GET` | `/api/v1/observability/runs/{run_id}` | 问答 ID 或索引版本 ID 对应的 Run、父子 Span、模型调用用量和 BuildContext 完整快照；历史无 Trace 时 `spans=[]` |
| `GET` | `/api/v1/observability/errors` | 构建与问答原始逐条异常事件，保留审计与下钻能力 |
| `GET` | `/api/v1/observability/errors/groups` | 按指纹聚合发生次数、去重影响 Run、最高严重度和首次／最近发生时间 |

`estimated_cost` 始终为 `null`，缺失 Token 不估算；密钥、请求头和 Base64 不进入观测字段。完整 Prompt 仅来自 LLM 调用前的真实 `context_snapshots`，不对历史对话事后补造；原文包含企业内容，当前角色选择不是安全边界。价格规则和正式账单仍未实现。

## OCR 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/ocr/recognize` | multipart 同步识别，返回 `201` |
| `POST` | `/api/v1/ocr/recognize/async` | multipart 保存原图并入队，返回 `202` 和 `queued` |
| `GET` | `/api/v1/ocr/{result_id}` | 查询持久化状态和结果 |
| `POST` | `/api/v1/ocr/{result_id}/retry` | 从失败记录保存的原图创建同步重试，返回 `201` |

异步请求示例：

```bash
curl -X POST http://localhost:8000/api/v1/ocr/recognize/async \
  -F 'model_config_id=你的通义OCR模型配置UUID' \
  -F 'file=@./scan.png'
```

只支持服务商类型为通义、能力为 LLM 且远程模型 ID 含 `ocr` 的配置。OCR 失败不会返回示例文本，也不会在错误中暴露 API Key 或上游堆栈。

## 自测

```bash
cd backend
../.venv/bin/ruff check app tests workers migrations
../.venv/bin/pytest
```

当前 65 项测试覆盖配置、密钥、LangChain 模型网关、同步／异步 OCR、知识库与模型引用保护、Markdown 持久化分块、版本化索引、活动版本切换、余弦召回、候选池重排、不可变快照、应用发布约束、会话持久化、SSE 引用与增量回答、多轮上下文、Token 有／无返回、失败脱敏、日志筛选和迁移；观测测试覆盖真实问答与构建 Trace 树、上传／分块活动同链挂载、重复分块仅采用最新记录、18／6／24 Token、构建维度失败闭合、重试第 2 次尝试、完整快照与网关实际输入一致、用量缺失警告、异常脱敏、跨问答／构建异常指纹聚合，以及历史无 Span Run 的兼容读取。测试中的云响应由测试替身提供，**不代表已经使用真实 OpenRouter、AIHubmix 或通义账号完成云端联调**，也不代表 PostgreSQL／pgvector、Docker 或 HNSW 已验收。
