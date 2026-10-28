# 知枢 · 企业知识中台

面向企业内部知识服务场景的通用知识中台，目标是覆盖“配置模型 → 构建知识库 → 导入与分块 → 检索测试 → 发布问答应用 → 在线对话 → 运行日志”的完整流程。

> **当前边界**：React 页面仍是浏览器 Mock 原型，角色选择不是真实登录或服务端鉴权。后端已实现服务商／模型配置、真实模型连接测试、通义云端 OCR、持久化异步任务和容器编排，但前端尚未接入后端；知识解析、向量索引、检索问答和真实日志仍待开发。

## 功能

- **工作台**：知识资产统计、知识服务流程、常用应用和处理动态。
- **模型服务**：管理 OpenRouter、AIHubmix、通义百炼，区分 LLM、Embedding、Rerank，提供引用和重复配置保护。
- **知识库**：独立知识库、部门与名称筛选、文件与任务、三栏分块工作区、检索测试。
- **知识导入**：支持 Word、PDF、Markdown、图片、表格的交互入口，以及上传校验、解析设置、分块预览和构建流程。
- **问答应用**：关联知识库，配置 LLM、提示词、Top K、相似度、Rerank、草稿与发布。
- **在线对话**：多轮会话、历史记录、停止生成、无命中提示、来源引用和复制回答。
- **运行日志**：查询内容、知识来源、模型、输入／输出 Tokens、耗时和请求详情。
- **角色视图**：管理员、知识库管理人员、使用者，包含菜单、数据范围和直接路由检查。
- **响应式布局**：桌面端三栏工作区及移动端导航和主要页面适配。

## 页面预览

![工作台](docs/screenshots/workbench-v2.png)

![知识库分块工作区](docs/screenshots/knowledge-chunks-v2.png)

## 技术栈

- 前端：React 19、TypeScript 5、Vite 7、React Router 7、Ant Design 6
- 后端：FastAPI、SQLAlchemy 2、Alembic、LangChain Python
- 数据与任务：PostgreSQL／pgvector、MinIO、Redis、Celery
- 部署与测试：Docker Compose、Vitest、Playwright、pytest、Ruff

## 本地运行

要求 Node.js 20 或更高版本。

```bash
npm ci
npm run dev
```

开发服务器默认监听 `http://127.0.0.1:4173`，首页路由为 `/workbench`。如果端口被占用，以终端输出为准。

常用页面：

```text
/workbench
/models
/knowledge
/knowledge/cuisine?tab=chunks
/applications
/chat
/logs
```

## 测试与构建

```bash
# 30 项单元／组件测试
npm test

# 17 项浏览器端到端测试，需要本机 Google Chrome
npm run test:e2e

# TypeScript 检查与生产构建
npm run build

# 预览 dist
npm run preview
```

端到端测试覆盖角色权限、知识导入与重建、问答发布、多轮对话、历史会话、停止生成、引用与日志、模型引用保护、任务清理和移动端布局。测试由 Playwright 自动启动并关闭临时开发服务器。

## 数据与状态

演示数据保存在当前浏览器的 Local Storage：

- `knowledge-hub-workspace-v3`：知识库、文档、分块、任务、模型、应用、会话和日志。
- `knowledge-hub-role-v3`：当前体验角色。

数据按浏览器 Origin 隔离，不会跨设备或跨端口共享。Markdown 和 CSV 可在浏览器读取文本；其他格式使用明确标记的示例解析结果。API Key 不会保存到浏览器存储。

## 后端与完整部署

技术选型和完整架构见 [后端 1.0 设计](docs/backend-design-v1.md)，本地开发、接口和测试说明见 [后端 README](backend/README.md)。

已确认并实现的第一阶段组合为 FastAPI、SQLAlchemy／Alembic、PostgreSQL、MinIO、Redis／Celery 和 LangChain。当前可用接口包括服务商与模型配置、模型连接测试，以及通义 OCR 的同步识别、异步入队、状态查询和失败重试。异步状态持久化在数据库，Redis 不是唯一任务记录。

```bash
cp .env.example .env
# 按 .env 中的说明生成并填写 HUB_ENCRYPTION_KEY
docker compose up --build
```

完整部署将启动前端、API、独立 Worker、PostgreSQL／pgvector、MinIO 和 Redis。当前开发机没有 Docker，以上编排只做了静态校验；真实云模型也需要配置有效账号后另行联调。

后续阶段包括知识与文档接口、Word／PDF／表格解析、版本化向量索引、真实检索与 Rerank、LangChain SSE 问答和运行日志。前端会通过 API Client 逐步替换 Mock，保留已有加载、空态、失败重试和无权限交互。

## 主要源码

```text
src/HubApp.tsx          当前六个模块及主要交互
src/hub.css            页面样式与响应式规则
src/workspace.ts       数据类型、种子数据、分块与检索模拟
src/permissions.ts     角色、菜单与路径权限
src/*.test.ts(x)       单元／组件测试
e2e/hub.spec.ts        浏览器端到端回归
```

`src/App.tsx`、`src/styles.css` 和 `src/mockData.ts` 为早期版本保留源码，不是当前运行入口。

## License

本项目基于 [MIT License](LICENSE) 开源。
