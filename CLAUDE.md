# Local RAG System — CLAUDE.md

## 项目概述

本地知识图谱增强 RAG 系统。用户上传文档 → 自动切片 → 向量化存储 + 知识图谱构建 → 图谱增强向量检索 → Claude 流式问答 + 溯源。

**运行环境**
- conda 环境：`llm-rag`（Python 3.12.13）
- 后端端口：9000
- 前端端口：5173（Vite proxy → 9000）

---

## 启动命令

```bash
make dev-backend    # cd backend && conda run --no-capture-output -n llm-rag uvicorn app.main:app --reload --port 9000 --log-level info
make dev-frontend   # cd frontend && npm run dev
make check          # 检测 LLM + Embedding 可达性
make reset-db       # 清空 data/（向量/图谱/SQLite）
cd backend && conda run -n llm-rag pytest tests/ -v
```

API 文档：http://localhost:9000/docs

---

## 目录结构

```
backend/app/
├── main.py              FastAPI 入口，CORS，HTTP 请求日志中间件
├── config.py            pydantic-settings，路径用 __file__ 锚定为绝对路径
├── api/routes/
│   ├── documents.py     上传（含切片策略 query 参数）、列表、/{id}/chunks、删除
│   ├── query.py         POST /query, GET /query/stream (SSE), POST /query/title
│   ├── graph.py         GET /graph, /graph/subgraph, /graph/node/{id}, /graph/stats
│   └── health.py
├── core/
│   ├── chunker.py       递归字符切片，_split_text 无递归实现（避免爆栈）
│   ├── embedder.py      LocalEmbedder（sentence-transformers）/ OllamaEmbedder（httpx）
│   ├── vector_store.py  ChromaDB 封装，where 必须用 {"$eq": val} 格式
│   ├── graph_builder.py spaCy zh_core_web_sm NER + Claude 三元组提取（逐 chunk）
│   ├── graph_store.py   NetworkX Graph，GraphML 持久化，to_graph_data() 序列化
│   ├── rag_engine.py    向量检索 + 图谱 1-hop 扩展，build_sources_from_hits()
│   └── source_tracer.py chunk-id → doc/page/offset
├── processors/
│   ├── pdf.py           pypdf 按页提取，保留页码
│   ├── docx.py          python-docx，按 Heading 分段
│   ├── markdown.py      按 # 标题行分段
│   ├── txt.py           全文一段
│   └── registry.py      .doc 格式抛友好错误，.md 强制 text/markdown
├── models/
│   ├── document.py      Document（含 progress/progress_step/indexed_at/chunk_strategy）
│   ├── query.py         QueryRequest, QueryResponse, Source, GraphPath
│   └── graph.py         GraphNode, GraphEdge, GraphData, GraphStats
└── db/
    └── file_store.py    SQLite via aiosqlite，MIGRATE_STMTS 做字段迁移

frontend/src/
├── App.tsx              三 Tab 布局（对话/文件管理/知识图谱），Tab 切换时 SessionList ↔ 普通 sidebar
├── api/
│   ├── client.ts        axios，Document 接口含 indexed_at/chunk_strategy/progress_step
│   └── sessions.ts      localStorage 持久化，generateSessionTitle() 调 /query/title
├── hooks/
│   ├── useSSE.ts        SSE done 事件清空 answer 状态（修复重复气泡 bug）
│   └── useDocuments.ts  upload(file, chunkSettings?) 透传切片参数
└── components/
    ├── ChatInterface.tsx  流式气泡 + 持久消息分离，避免重复渲染
    ├── DocumentsPage.tsx  切片策略面板（3 种），chunkScroll + flex min-height:0 修复滚动
    ├── GraphViewer.tsx    Cytoscape cose 布局，点击节点展开子图，fullData 重置
    ├── SessionList.tsx    历史会话侧边栏
    └── SourcePanel.tsx    折叠来源面板
```

---

## 关键设计决策

**ChromaDB where 过滤**：必须用 `{"$eq": value}` 而非直接 `{"key": value}`，否则新版 chromadb 静默返回空。所有 `.get(where=...)` 和 `.delete(where=...)` 调用均已修正。

**流式气泡重复 bug**：SSE `done` 事件时将 `setState` 的 `answer` 清空为 `''`，流式气泡条件 `loading || answer` 变 false，气泡消失，`onDone` 回调随后将完整消息写入 `session.messages`，只渲染一条。

**切片滚动 bug**：`detailPane` 和 `chunkScroll` 需要 `min-height: 0`，`chunkCard` 设 `flex-shrink: 0` + `overflow: visible`，`chunkBody` 设 `max-height: 400px` + `overflow-y: auto`。

**路径锚定**：`config.py` 用 `Path(__file__).parent.parent.resolve()` 计算 `backend/` 绝对路径，所有 data 目录均基于此，不受 uvicorn 启动目录影响。

**LLM 关系抽取性能**：每个 chunk 单独调用一次 LLM，大文档（45 chunks）耗时几分钟属正常。不需要图谱关系时可将 `GRAPH_LLM_API_KEY` 留空跳过此步骤。

**会话标题生成**：仅在第一轮 Q&A 完成后触发一次 `POST /query/title`，失败时 fallback 到问题前 20 字，不阻塞对话流程。

---

## 配置速查（backend/.env）

```bash
# LLM
LLM_API_KEY=...
LLM_BASE_URL=https://api.anthropic.com   # 或 oneapi 代理
LLM_MODEL=claude-sonnet-4-6

# Embedding（两选一）
EMBEDDING_BACKEND=local                  # sentence-transformers，无需额外服务
EMBEDDING_BACKEND=ollama                 # 需要 Ollama 运行
EMBEDDING_MODEL=paraphrase-multilingual-MiniLM-L12-v2
EMBEDDING_BASE_URL=http://localhost:11434

# 知识图谱三元组提取（留空复用 LLM_*）
GRAPH_LLM_MODEL=
GRAPH_LLM_API_KEY=

# 切片默认值
CHUNK_SIZE=2000
CHUNK_OVERLAP=256
```

---

## 注意事项

- `.doc`（Word 97-2003）不支持，须转为 `.docx`
- `backend/data/` 在 `.gitignore` 中，不会提交
- `backend/.env` 在 `.gitignore` 中，不会提交；提交的是 `.env.example`
- spaCy 模型需单独下载：`conda run -n llm-rag python -m spacy download zh_core_web_sm`
- 端口 9000（后端）已替代旧的 8000，`vite.config.ts` proxy target 同步更新
