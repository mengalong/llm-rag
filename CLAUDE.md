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
make rebuild-graph          # 从已索引文档重建知识图谱（NER + LLM 关系抽取）
make rebuild-graph no-llm=1 # 仅 NER，跳过 LLM（速度快，适合测试过滤效果）
cd backend && conda run -n llm-rag pytest tests/ -v
```

API 文档：http://localhost:9000/docs

---

## 目录结构

```
backend/app/
├── main.py / config.py
├── api/routes/       documents.py / query.py / graph.py / health.py
├── core/             chunker / embedder / vector_store / graph_builder / graph_store / rag_engine / source_tracer
├── processors/       pdf / docx / markdown / txt / registry
├── models/           document / query / graph
└── db/               file_store.py（SQLite + aiosqlite）

frontend/src/
├── App.tsx           四 Tab 布局（对话/文件管理/知识图谱/检索调试）
├── api/              client.ts / sessions.ts
├── hooks/            useSSE.ts / useDocuments.ts
└── components/       ChatInterface / DocumentsPage / GraphViewer / GraphEntityModal / DebugPage / SessionList / SourcePanel
```

---

## 关键设计决策

**ChromaDB where 过滤**：必须用 `{"$eq": value}` 而非直接 `{"key": value}`，否则新版 chromadb 静默返回空。所有 `.get(where=...)` 和 `.delete(where=...)` 调用均已修正。

**流式气泡重复问题**：`onDone` 和清空流式状态合并为一次 React 批处理，避免两次渲染闪烁。会话标题生成异步后台执行，通过独立的 `onSessionTitleUpdate` 回调只更新 title 字段，不触发消息区重渲染。

**图谱检索双路策略**：`rag_engine.py` 同时运行 spaCy NER 和关键词 fuzzy 匹配，结果合并去重。NER 识别不到的描述性短语（如"本次咨询服务"）通过关键词子串匹配仍可命中图谱节点。

**实体过滤**：`graph_builder.py` 设有 `VALID_ENTITY_TYPES` 白名单，过滤数字、时间、序号等噪音实体类型，只保留 PERSON/ORG/GPE 等有语义的类型。

**LLM 关系抽取性能**：每个 chunk 单独调用一次 LLM，大文档（45 chunks）耗时几分钟属正常。不需要图谱关系时可将 `GRAPH_LLM_API_KEY` 留空跳过此步骤。


---

## 配置速查（backend/.env）

```bash
# LLM
LLM_API_KEY=...
LLM_BASE_URL=https://api.anthropic.com   # 或 oneapi 代理
LLM_MODEL=claude-sonnet-4-6

# Embedding（两选一：local=sentence-transformers 无需额外服务，ollama=需 Ollama 运行）
EMBEDDING_BACKEND=local
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
- spaCy 模型需单独下载：`conda run -n llm-rag python -m spacy download zh_core_web_sm`
