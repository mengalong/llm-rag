# Local RAG System

基于知识图谱增强的本地 RAG 系统。支持多格式文档上传、自动切片、向量索引、知识图谱构建与可视化、流式问答及答案溯源。

## 功能特性

- **文档处理**：支持 PDF、DOCX、TXT、Markdown，拖拽上传，后台异步索引，实时进度展示
- **智能切片**：递归字符切片 / 按句子切片 / 固定长度切片，切片大小和重叠可自定义
- **向量索引**：ChromaDB 本地持久化，支持本地 sentence-transformers 或 Ollama embedding
- **知识图谱**：spaCy NER 实体抽取 + LLM 关系三元组提取，NetworkX 存储，Cytoscape.js 可视化
- **图谱增强 RAG**：向量检索 + NER/关键词双路图谱检索 + 1-hop 扩展，提升召回质量
- **流式问答**：SSE 流式输出，Markdown 渲染，多轮对话，历史会话持久化，自动生成会话标题
- **答案溯源**：来源标注数字编号 `[N]`，可点击定位，标注图谱扩展来源（"图谱" badge）
- **引用图谱**：回答中实体名可点击，弹窗展示关系子图，支持节点跳转和历史回退
- **图谱推理路径**：折叠展示本次检索命中的图谱推理链路
- **文件管理**：文档列表、切片详情查看、切片内容搜索
- **知识图谱页**：文档维度过滤、实体列表、实体搜索（NER+关键词）、实体分类（NER vs LLM）、总览统计
- **检索调试**：独立调试页面，展示完整检索过程，对比开启/不开启图谱的回答差异
- **亮/暗主题**：跟随系统自动切换，支持手动切换，持久化记忆

## 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | FastAPI + uvicorn |
| 向量数据库 | ChromaDB（本地嵌入式） |
| Embedding | Ollama 或 sentence-transformers |
| 知识图谱 | NetworkX + spaCy `zh_core_web_sm` |
| LLM | Claude API（兼容 OpenAI-compatible proxy） |
| 前端 | React 19 + Vite + TypeScript + Inter 字体 |
| 图谱可视化 | Cytoscape.js |
| Markdown 渲染 | react-markdown + remark-gfm |
| 元数据存储 | SQLite（aiosqlite） |

## 快速开始

### 环境要求

- Python 3.12+（conda 环境 `llm-rag`）
- Node.js 18+
- Ollama（可选，用于本地 embedding）
- Claude API Key 或兼容代理

### 安装

```bash
# 1. 克隆项目
git clone <repo-url>
cd llm-rag

# 2. 配置环境变量
cp .env.example backend/.env
# 编辑 backend/.env，至少填写 LLM_API_KEY 和 LLM_BASE_URL

# 3. 创建 conda 环境（如果没有）
conda create -n llm-rag python=3.12 -y
conda activate llm-rag

# 4. 安装依赖
make install

# 5. 下载 spaCy 中文模型
conda run -n llm-rag python -m spacy download zh_core_web_sm

# 6. 检查模型可用性（可选）
make check
```

### 启动

```bash
# 终端 1：启动后端（port 9000）
make dev-backend

# 终端 2：启动前端（port 5173）
make dev-frontend

# 浏览器访问
open http://localhost:5173
```

## 配置说明

所有配置在 `backend/.env`，复制 `.env.example` 后修改：

### LLM

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_API_KEY` | — | Anthropic API Key 或代理 Key |
| `LLM_BASE_URL` | `https://api.anthropic.com` | 可替换为 OpenAI-compatible 代理地址 |
| `LLM_MODEL` | `claude-sonnet-4-6` | 模型名称 |
| `LLM_MAX_TOKENS` | `4096` | 最大输出 token 数 |
| `LLM_TEMPERATURE` | `0.1` | 生成温度 |

### Embedding

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_BACKEND` | `local` | `local`（sentence-transformers）或 `ollama` |
| `EMBEDDING_MODEL` | `paraphrase-multilingual-MiniLM-L12-v2` | 中英双语模型 |
| `EMBEDDING_BASE_URL` | — | Ollama 地址，如 `http://localhost:11434` |

### 知识图谱

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GRAPH_LLM_MODEL` | （空）| 三元组提取模型，留空则复用 `LLM_MODEL` |
| `GRAPH_LLM_API_KEY` | （空）| 留空则复用 `LLM_API_KEY` |

### 切片

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CHUNK_SIZE` | `2000` | 切片最大字符数 |
| `CHUNK_OVERLAP` | `256` | 相邻切片重叠字符数 |

## 项目结构

```
llm-rag/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI 入口，CORS，请求日志
│   │   ├── config.py             # pydantic-settings，绝对路径锚定
│   │   ├── api/routes/
│   │   │   ├── documents.py      # 上传（含切片策略参数）、列表、切片查询、删除
│   │   │   ├── query.py          # RAG 问答（SSE 流式）、调试接口、会话标题生成
│   │   │   ├── graph.py          # 全图、子图、节点、实体搜索、分类、总览
│   │   │   └── health.py         # /health, /ready
│   │   ├── core/
│   │   │   ├── chunker.py        # 递归字符切片，保留页码和标题
│   │   │   ├── embedder.py       # LocalEmbedder / OllamaEmbedder 抽象
│   │   │   ├── vector_store.py   # ChromaDB 封装，$eq 过滤
│   │   │   ├── graph_builder.py  # spaCy NER（类型白名单过滤）+ Claude 三元组
│   │   │   ├── graph_store.py    # NetworkX GraphML 持久化，子图/文档/过滤查询
│   │   │   ├── rag_engine.py     # 向量 + NER/关键词双路图谱检索，source tracing
│   │   │   └── source_tracer.py  # chunk-id → 文档/页码/字符偏移
│   │   ├── processors/           # PDF / DOCX / TXT / Markdown 文本提取
│   │   ├── models/               # Pydantic v2 数据模型
│   │   └── db/
│   │       └── file_store.py     # SQLite，含进度、时间戳、切片策略字段
│   ├── scripts/
│   │   ├── check_models.py       # make check 模型可用性检测
│   │   └── rebuild_graph.py      # make rebuild-graph 重建知识图谱
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── ChatInterface.tsx  # 多轮对话，SSE 流式，Markdown 渲染，图谱实体弹窗
│       │   ├── DocumentsPage.tsx  # 文件管理，切片详情，策略配置
│       │   ├── GraphViewer.tsx    # 知识图谱：文档过滤、实体列表、搜索、分类、总览
│       │   ├── GraphEntityModal.tsx  # 实体关系弹窗，节点跳转，多尺寸
│       │   ├── DebugPage.tsx      # 检索调试，图谱/无图谱对比
│       │   ├── SessionList.tsx    # 历史会话侧边栏，主题切换
│       │   └── SourcePanel.tsx    # 溯源来源，图谱 badge 标注
│       ├── hooks/
│       │   ├── useSSE.ts          # SSE 流式问答，graphPaths/graphChunkIds
│       │   └── useDocuments.ts    # 文档管理，切片策略透传
│       └── api/
│           ├── client.ts          # axios + 日志拦截器，图谱/调试 API
│           └── sessions.ts        # localStorage 会话持久化，LLM 标题生成
├── .env.example
├── .gitignore
├── Makefile
├── CLAUDE.md
└── README.md
```

## 常用命令

```bash
make install          # 安装全部依赖
make check            # 检测 LLM + Embedding 模型是否可达
make dev-backend      # 启动后端 (port 9000, --reload)
make dev-frontend     # 启动前端 (port 5173, HMR)
make reset-db         # 清空所有文档数据（向量/图谱/SQLite）
make rebuild-graph    # 从已索引文档重建知识图谱（NER + LLM 关系抽取）
make rebuild-graph no-llm=1  # 仅 NER，跳过 LLM（速度快）

# 运行测试
cd backend && conda run -n llm-rag pytest tests/ -v

# 查看 API 文档
open http://localhost:9000/docs
```

## API 端点

```
POST /api/v1/documents/upload?chunk_strategy=recursive&chunk_size=2000&chunk_overlap=256
GET  /api/v1/documents/
GET  /api/v1/documents/{id}
GET  /api/v1/documents/{id}/chunks
DELETE /api/v1/documents/{id}

GET  /api/v1/query/stream?question=...&use_graph=true
POST /api/v1/query
POST /api/v1/query/title
POST /api/v1/query/debug          # 检索过程调试，返回双路对比答案

GET  /api/v1/graph/
GET  /api/v1/graph/subgraph?entity=...&depth=2
GET  /api/v1/graph/stats
GET  /api/v1/graph/overview
GET  /api/v1/graph/document/{document_id}
GET  /api/v1/graph/search?q=...
GET  /api/v1/graph/entity-categories
GET  /api/v1/graph/entity-type/{type}?page=1&page_size=50
GET  /api/v1/graph/node/{node_id}

GET  /api/v1/health
GET  /api/v1/ready
```

## 已知限制

- `.doc`（Word 97-2003）格式不支持，请转换为 `.docx` 后上传
- 知识图谱 LLM 关系抽取按 chunk 逐个调用，文档较大时耗时较长；可将 `GRAPH_LLM_API_KEY` 留空禁用（只保留 spaCy NER）
- ChromaDB `where` 过滤使用 `$eq` 运算符，升级 chromadb 版本时注意兼容性
- spaCy `zh_core_web_sm` 为轻量模型，NER 准确率有限；可换用 `zh_core_web_trf`（BERT-based）提升质量

## License

MIT


基于知识图谱增强的本地 RAG 系统。支持多格式文档上传、自动切片、向量索引、知识图谱构建与可视化、流式问答及答案溯源。

## 功能特性

- **文档处理**：支持 PDF、DOCX、TXT、Markdown，拖拽上传，后台异步索引，实时进度展示
- **智能切片**：递归字符切片 / 按句子切片 / 固定长度切片，切片大小和重叠可自定义
- **向量索引**：ChromaDB 本地持久化，支持本地 sentence-transformers 或 Ollama embedding
- **知识图谱**：spaCy NER 实体抽取 + LLM 关系三元组提取，NetworkX 存储，Cytoscape.js 可视化
- **图谱增强 RAG**：向量检索 + 知识图谱 1-hop 扩展，提升召回质量
- **流式问答**：SSE 流式输出，多轮对话，历史会话本地持久化，自动生成会话标题
- **答案溯源**：每条回答标注来源文件、页码、相关度分数，可展开查看原文片段
- **文件管理**：文档列表、切片详情查看、切片内容搜索

## 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | FastAPI + uvicorn |
| 向量数据库 | ChromaDB（本地嵌入式） |
| Embedding | Ollama 或 sentence-transformers |
| 知识图谱 | NetworkX + spaCy `zh_core_web_sm` |
| LLM | Claude API（兼容 OpenAI-compatible proxy） |
| 前端 | React 19 + Vite + TypeScript |
| 图谱可视化 | Cytoscape.js |
| 元数据存储 | SQLite（aiosqlite） |

## 快速开始

### 环境要求

- Python 3.12+（conda 环境 `llm-rag`）
- Node.js 18+
- Ollama（可选，用于本地 embedding）
- Claude API Key 或兼容代理

### 安装

```bash
# 1. 克隆项目
git clone <repo-url>
cd llm-rag

# 2. 配置环境变量
cp .env.example backend/.env
# 编辑 backend/.env，至少填写 LLM_API_KEY 和 LLM_BASE_URL

# 3. 创建 conda 环境（如果没有）
conda create -n llm-rag python=3.12 -y
conda activate llm-rag

# 4. 安装依赖
make install

# 5. 下载 spaCy 中文模型
conda run -n llm-rag python -m spacy download zh_core_web_sm

# 6. 检查模型可用性（可选）
make check
```

### 启动

```bash
# 终端 1：启动后端（port 9000）
make dev-backend

# 终端 2：启动前端（port 5173）
make dev-frontend

# 浏览器访问
open http://localhost:5173
```

## 配置说明

所有配置在 `backend/.env`，复制 `.env.example` 后修改：

### LLM

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_API_KEY` | — | Anthropic API Key 或代理 Key |
| `LLM_BASE_URL` | `https://api.anthropic.com` | 可替换为 OpenAI-compatible 代理地址 |
| `LLM_MODEL` | `claude-sonnet-4-6` | 模型名称 |
| `LLM_MAX_TOKENS` | `4096` | 最大输出 token 数 |
| `LLM_TEMPERATURE` | `0.1` | 生成温度 |

### Embedding

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_BACKEND` | `local` | `local`（sentence-transformers）或 `ollama` |
| `EMBEDDING_MODEL` | `paraphrase-multilingual-MiniLM-L12-v2` | 中英双语模型 |
| `EMBEDDING_BASE_URL` | — | Ollama 地址，如 `http://localhost:11434` |

### 知识图谱

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GRAPH_LLM_MODEL` | （空）| 三元组提取模型，留空则复用 `LLM_MODEL` |
| `GRAPH_LLM_API_KEY` | （空）| 留空则复用 `LLM_API_KEY` |

### 切片

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CHUNK_SIZE` | `2000` | 切片最大字符数 |
| `CHUNK_OVERLAP` | `256` | 相邻切片重叠字符数 |

## 项目结构

```
llm-rag/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI 入口，CORS，请求日志
│   │   ├── config.py             # pydantic-settings，绝对路径锚定
│   │   ├── api/routes/
│   │   │   ├── documents.py      # 上传（含切片策略参数）、列表、切片查询、删除
│   │   │   ├── query.py          # RAG 问答（SSE 流式）、会话标题生成
│   │   │   ├── graph.py          # 全图、子图、节点详情
│   │   │   └── health.py         # /health, /ready
│   │   ├── core/
│   │   │   ├── chunker.py        # 递归字符切片，保留页码和标题
│   │   │   ├── embedder.py       # LocalEmbedder / OllamaEmbedder 抽象
│   │   │   ├── vector_store.py   # ChromaDB 封装，$eq 过滤
│   │   │   ├── graph_builder.py  # spaCy NER + Claude 三元组，共现边
│   │   │   ├── graph_store.py    # NetworkX GraphML 持久化，子图查询
│   │   │   ├── rag_engine.py     # 向量 + 图谱扩展检索，source tracing
│   │   │   └── source_tracer.py  # chunk-id → 文档/页码/字符偏移
│   │   ├── processors/
│   │   │   ├── pdf.py            # pypdf 按页提取
│   │   │   ├── docx.py           # python-docx 保留标题层级
│   │   │   ├── txt.py            # 纯文本
│   │   │   ├── markdown.py       # Markdown 按 heading 分段
│   │   │   └── registry.py       # MIME → 处理器映射，.doc 格式友好报错
│   │   ├── models/               # Pydantic v2 数据模型
│   │   └── db/
│   │       └── file_store.py     # SQLite，含进度、时间戳、切片策略字段
│   ├── data/                     # 运行时数据（.gitignore 排除）
│   ├── scripts/
│   │   └── check_models.py       # make check 模型可用性检测
│   ├── tests/
│   │   ├── test_chunker.py
│   │   └── test_graph_builder.py
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── ChatInterface.tsx  # 多轮对话，SSE 流式，自动标题
│       │   ├── DocumentsPage.tsx  # 文件管理，切片详情，策略配置
│       │   ├── GraphViewer.tsx    # Cytoscape.js，点击展开子图，图例
│       │   ├── SessionList.tsx    # 历史会话侧边栏
│       │   └── SourcePanel.tsx    # 溯源来源折叠面板
│       ├── hooks/
│       │   ├── useSSE.ts          # SSE 流式问答，onDone 回调
│       │   └── useDocuments.ts    # 文档管理，切片策略透传
│       └── api/
│           ├── client.ts          # axios + 日志拦截器
│           └── sessions.ts        # localStorage 会话持久化，LLM 标题生成
├── .env.example                   # 配置模板（无真实密钥）
├── .gitignore
├── Makefile
└── CLAUDE.md
```

## 常用命令

```bash
make install          # 安装全部依赖
make check            # 检测 LLM + Embedding 模型是否可达
make dev-backend      # 启动后端 (port 9000, --reload)
make dev-frontend     # 启动前端 (port 5173, HMR)
make reset-db         # 清空所有文档数据（向量/图谱/SQLite）

# 运行测试
cd backend && conda run -n llm-rag pytest tests/ -v

# 查看 API 文档
open http://localhost:9000/docs
```

## API 端点

```
POST /api/v1/documents/upload?chunk_strategy=recursive&chunk_size=2000&chunk_overlap=256
GET  /api/v1/documents/
GET  /api/v1/documents/{id}
GET  /api/v1/documents/{id}/chunks
DELETE /api/v1/documents/{id}

GET  /api/v1/query/stream?question=...&use_graph=true
POST /api/v1/query
POST /api/v1/query/title

GET  /api/v1/graph/
GET  /api/v1/graph/subgraph?entity=...&depth=2
GET  /api/v1/graph/stats
GET  /api/v1/graph/node/{node_id}

GET  /api/v1/health
GET  /api/v1/ready
```

## 已知限制

- `.doc`（Word 97-2003）格式不支持，请转换为 `.docx` 后上传
- 知识图谱 LLM 关系抽取按 chunk 逐个调用，文档较大时耗时较长；可将 `GRAPH_LLM_API_KEY` 留空禁用（只保留 spaCy NER）
- ChromaDB `where` 过滤使用 `$eq` 运算符，升级 chromadb 版本时注意兼容性

## License

MIT
