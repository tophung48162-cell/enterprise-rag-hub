# 知枢后端

FastAPI + LangChain 后端第一阶段，当前实现服务商／模型配置、真实模型连接测试、云端 OCR、Alembic 迁移和独立 Celery OCR Worker。

## 已实现

- OpenRouter、AIHubmix、通义百炼服务商配置；API Key 使用 Fernet 加密后存入数据库，读取接口不返回明文。
- LLM、Embedding、Rerank 分能力配置和最小真实 HTTP 连接测试。
- 通义 OCR 模型通过 LangChain `ChatOpenAI` 接收 Base64 图片；记录真实响应、Token 和耗时。
- PNG、JPEG、WEBP 文件签名校验；原图写入私有 S3／MinIO 存储。
- 同步识别、持久化异步识别、结果查询和失败记录重试。
- OCR 状态保存在 PostgreSQL：`queued → processing → ready / failed`；Redis 只承担队列和短期结果，不是任务真相来源。
- Celery 有限重试、指数退避、软／硬超时和独立 Worker 进程。
- 存活／数据库就绪检查、请求 ID 和统一脱敏错误结构。

## 尚未实现

知识库与文档管理、Word／PDF／表格解析、分块、pgvector 索引、检索、Rerank 问答、SSE 对话和查询日志仍属于后续阶段。当前 React 页面仍使用浏览器 Mock，尚未连接这些 API。

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

当前 15 项测试覆盖配置、密钥、模型网关契约、同步／异步 OCR、失败重试、队列异常和空库迁移。测试中的云响应由测试替身提供，**不代表已经使用真实 OpenRouter、AIHubmix 或通义账号完成云端联调**。
