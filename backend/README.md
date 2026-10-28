# 知枢后端

FastAPI + LangChain 后端当前实现服务商／模型配置、真实模型连接测试、云端 OCR、知识库与 Markdown 持久化分块、版本化向量索引、向量检索与 Rerank、Alembic 迁移和独立 Celery Worker。

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
- Celery 有限重试、指数退避、软／硬超时和独立 Worker 进程。
- 存活／数据库就绪检查、请求 ID 和统一脱敏错误结构。

## 尚未实现

Word／PDF／Excel 服务端解析、HNSW 索引、SSE 问答和查询日志仍属于后续阶段。React 已接入本 README 中的服务商／模型、图片 OCR、知识库、Markdown 分块、索引构建和检索 API；其余页面仍使用明确标记的浏览器 Mock。当前联调测试使用 HTTP 替身，真实云服务、PostgreSQL／pgvector 和容器运行仍未验收。

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

当前 48 项测试覆盖配置、密钥、模型网关契约、同步／异步 OCR、失败重试、队列异常、知识库与模型引用保护、Markdown 上传校验、原件持久化、结构化分块、幂等重切、分块编辑、删除清理、版本化索引构建、维度校验、活动版本切换、源内容变化、重复消息、构建锁定、余弦召回、候选池重排、不可变快照、模型切换保护和迁移。测试中的云响应由测试替身提供，**不代表已经使用真实 OpenRouter、AIHubmix 或通义账号完成云端联调**，也不代表 PostgreSQL／pgvector、Docker 或 HNSW 已验收。
