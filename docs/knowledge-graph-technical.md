# 知识图谱技术文档

> 本文档描述 Local RAG System 中知识图谱的完整技术实现，涵盖构建、存储、检索、问答增强和可视化展示五个阶段。

---

## 一、图谱构建

### 1.1 触发时机

文档上传后，后台任务完成向量化索引后，进入图谱构建阶段。构建分两轮串行执行：

```
文档上传 → 文件解析 → 文本切片 → 向量化 → [NER 实体抽取] → [LLM 关系抽取] → 图谱持久化
```

### 1.2 NER 实体抽取（第一轮）

**模型**：spaCy `zh_core_web_sm`（轻量中文模型，lazy-load 单例）

**实体类型白名单**（`VALID_ENTITY_TYPES`）：

| 类型 | 说明 |
|---|---|
| PERSON | 人名 |
| ORG | 组织机构 |
| GPE | 地名/地缘政治实体 |
| PRODUCT | 产品名称 |
| LOC | 地理位置 |
| WORK_OF_ART | 作品名 |
| EVENT | 事件名称 |
| FAC | 设施名称 |
| NORP | 民族/政治组织 |

**过滤规则**（`_is_valid_entity`，四条全部满足才入图）：
1. 实体类型必须在白名单内（过滤 CARDINAL/DATE/TIME/ORDINAL 等噪音类型）
2. 文本长度 ≥ 2 字符
3. 不能是纯数字字符串
4. 不能是仅由数字、空白、常见标点组成的字符串（如 `1.`、`（3）`）

**节点建立**：同一 Chunk 内识别到的所有合法实体，两两建立 `co-occurs`（共现）边，边的权重在重复出现时累加。

**节点 ID 生成**：

```python
hashlib.md5(label.strip().lower().encode()).hexdigest()[:16]
```

使用标签小写后的 MD5 前 16 位，保证同名实体跨文档自动合并到同一节点。

### 1.3 LLM 关系抽取（第二轮）

**触发条件**：`GRAPH_LLM_API_KEY` 不为空（留空则跳过整个阶段）

**调用规则**：
- Chunk 长度 ≥ 20 字符才处理
- 每个 Chunk 单独调用一次 LLM（串行，大文档耗时分钟级）
- 取 Chunk 前 1500 字符作为输入

**System Prompt**：

```
You are an information extraction system.
Extract relation triples from the text and return ONLY a JSON array.
Each element: {"subject": "...", "relation": "...", "object": "..."}.
Use concise noun phrases. Return [] if no clear relations found.
```

**输出解析**：从响应中截取第一个 `[` 到最后一个 `]` 之间的内容，JSON 解析为三元组数组，解析失败时静默跳过。

**节点类型**：LLM 抽取的 subject/object 创建节点时 `type="ENTITY"`（区别于 NER 节点的具体类型），便于后续按来源分类。

**边建立**：若边已存在则累加权重，不更新关系名称。

### 1.4 两种实体节点的区别

| 维度 | NER 节点 | LLM 节点 |
|---|---|---|
| type 字段 | PERSON/ORG/GPE/PRODUCT/LOC 等 | ENTITY |
| 边类型 | co-occurs（共现） | 具体语义关系（开发了/属于/包括…） |
| 产生阶段 | 第一轮，所有 Chunk | 第二轮，≥20字 Chunk |
| 质量特点 | 结构化类型，但噪音较多 | 语义丰富，质量取决于 LLM |
| 数量（示例） | ~60 个 | ~1340 个 |

### 1.5 图谱持久化

- **存储格式**：GraphML 文件，`backend/data/graphs/knowledge_graph.graphml`
- **运行时**：NetworkX `nx.Graph` 内存单例，启动时从磁盘加载，每次写入后调用 `save_graph()` 刷新
- **每个 Chunk** 额外保存快照：`data/graphs/{doc_id}.chunks.json`，供图谱重建使用

**节点属性**：`label`、`type`、`document_ids`（JSON 字符串）、`chunk_ids`（JSON 字符串）  
**边属性**：`id`、`relation`、`weight`（float）、`chunk_ids`（JSON 字符串）

### 1.6 重建图谱

```bash
make rebuild-graph          # NER + LLM 完整重建
make rebuild-graph no-llm=1 # 仅 NER，速度快
```

重建脚本（`scripts/rebuild_graph.py`）读取所有已索引文档的 chunk 快照文件，清空内存图后重新跑两轮构建流程。

---

## 二、图谱检索

### 2.1 检索入口

问答时用户开启「图谱」开关，检索流程执行 `_do_graph_retrieval()`。

### 2.2 双路实体识别

NER 和关键词匹配**并行执行**，结果合并去重（NER 优先）：

```python
ner_entities    = _extract_entities_from_question(question)    # spaCy NER
fuzzy_pairs     = _fuzzy_match_entities(question)              # 关键词子串匹配
all_entities    = list(dict.fromkeys(ner_entities + fuzzy_entities))
```

**NER 路**：对问题文本直接运行 `zh_core_web_sm`，提取实体文本列表。

**关键词匹配路**（`_fuzzy_match_entities`）：

1. 正则提取问题中长度 ≥ 2 的连续中文/字母数字串
2. 过滤停用词（的/了/在/是/怎么/哪些 等约 60 个）
3. 对每个词生成长度 2-6 的所有子串，扩充候选关键词列表
4. 遍历图谱所有节点，统计各关键词出现在节点 label 中的次数
5. 按（命中关键词数 desc, label 长度 desc）排序，返回最多 5 个结果
6. 每个结果附带「最长命中关键词」（`matched_by`），便于调试溯源

**解决的问题**：spaCy 只能识别命名实体（人名/地名等），对"本次咨询服务"、"底座层"等描述性短语无能为力。关键词匹配兜底，显著提升图谱命中率。

### 2.3 图谱节点查找与扩展（`_get_graph_chunks`）

对每个识别到的实体：

1. **精确匹配**：计算实体 MD5 节点 ID，直接查找图谱节点
2. **部分匹配 fallback**：若精确匹配失败，扫描所有节点，找第一个 label 包含该实体文本（不区分大小写）的节点
3. **1-hop 扩展**：对命中节点，取最多 **5 个**邻居节点
4. 邻居节点的 `chunk_ids` 一并加入召回集合
5. 构建 `GraphPath`（主体→关系→客体三元组列表）用于前端展示

### 2.4 图谱扩展召回

```python
extra = get_chunks_by_ids(g_chunk_ids[:10])  # 最多取 10 个
```

从 ChromaDB 按 chunk ID 直接获取，跳过向量相似度计算。追加到向量召回结果后，**不重复**。追加的 chunk 会被标记进 `graph_chunk_ids` 集合，用于前端来源标注。

### 2.5 来源 Badge 标注

`done` 事件携带 `graph_chunk_ids` 列表，前端 `SourcePanel` 对比每个来源的 `chunk_id`，图谱扩展召回的来源显示紫色「图谱」badge。

---

## 三、问答增强

### 3.1 上下文构建

所有召回 chunk（向量 + 图谱扩展）按序号编号传入 LLM：

```
[1]
<chunk 内容>

---

[2]
<chunk 内容>
```

### 3.2 引用格式约束

System Prompt 明确要求：
- 使用 `[1]`、`[2]` 格式引用，紧跟句末同一行，不另起段落
- 使用 `##`/`###` 标题分节，并列内容用无序列表
- 超过 300 字的段落必须拆分

### 3.3 前端 Markdown 渲染

- `react-markdown + remark-gfm` 渲染段落/标题/列表/表格/代码块
- `prepareContent()` 预处理：补全标题后空行、合并软换行、压缩列表项间空行
- `[N]` 引用标记转为可点击上标，点击后滚动定位到对应来源条目

### 3.4 图谱实体标注

回答气泡顶部显示"图谱命中：实体A · 实体B"，点击实体名弹出 `GraphEntityModal` 展示该实体的 2-hop 关系子图。

气泡底部可展开图谱推理路径（折叠面板），展示"主体 —关系→ 客体"三元组链路。

---

## 四、图谱可视化展示

### 4.1 页面布局

知识图谱 Tab 分左右两栏：

- **左侧面板**：实体搜索框 / 文档列表 / 实体类型筛选 / 实体列表（按类型分组）
- **右侧内容区**：顶部总览 banner + 子图画布（Cytoscape.js）

### 4.2 总览 Banner

调用 `GET /graph/overview` 返回：

| 指标 | 说明 |
|---|---|
| 实体节点数 | 全图节点总数 |
| 关系边数 | 全图边总数 |
| 语义关系数 | relation ≠ "co-occurs" 的边数 |
| 覆盖文档数 | 有节点关联的文档数 |
| 实体类型进度条 | 各类型节点占比 |
| 高频语义关系 | Top-5 非共现关系及出现次数 |

### 4.3 按文档过滤

选择文档后调用 `GET /graph/document/{doc_id}`，后端过滤 `document_ids` 包含该文档的节点，返回该文档专属子图数据，前端渲染实体列表。

### 4.4 实体搜索

输入关键词后调用 `GET /graph/search?q=...`：
- NER 路识别实体，验证其在图谱中存在（不存在则过滤）
- 关键词匹配路返回 `(label, matched_by)` 对

点击搜索结果触发 `GraphEntityModal`。

### 4.5 实体分类面板

调用 `GET /graph/entity-categories` 按来源（NER vs LLM）分组展示：
- NER 节点：按类型分组，可展开查看完整实体列表（含度数、来源文档）
- LLM 节点：统一为 ENTITY 类型，按度数降序分页展示（每页 50 条，渐进加载）
- 点击实体弹出关系子图弹窗

### 4.6 实体关系弹窗（GraphEntityModal）

- 三档尺寸：标准（100vw-48px）/ 全屏 / 小窗（680×520）
- 焦点实体：深红色节点 + 白色粗边框 + 大尺寸，与邻居明显区分
- 节点点击：支持跳转（压入历史栈），ESC/← 键回退
- 操作提示：滚轮缩放 / 拖拽移动

---

## 五、检索调试页面

### 5.1 流式 SSE 协议

调用 `GET /query/debug/stream?question=...`，三阶段 SSE：

**阶段一（立即）**：检索完成后推送 `retrieval` 事件：

```json
{
  "type": "retrieval",
  "ner_entities": ["AI工作台"],
  "fuzzy_entities": ["本次咨询服务"],
  "matched_graph_nodes": [{"label": "...", "type": "ORG", "degree": 37, "match_reason": "ner", "matched_by": "AI工作台"}],
  "graph_paths": [{"entities": ["A", "B"], "relations": ["开发了"]}],
  "vector_hits": [...],
  "graph_hits": [...]
}
```

**阶段二（并发流式）**：两个 LLM 调用同时启动，token 事件交替推送：

```json
{"type": "token", "label": "with_graph", "token": "根据"}
{"type": "token", "label": "without_graph", "token": "文档中"}
```

**阶段三（结束）**：

```json
{"type": "done"}
```

### 5.2 前端展示

- **上半部分（三列）**：图谱检索过程 | 向量召回 | 图谱扩展召回
  - NER 实体：蓝色 pill + spaCy 标签
  - 关键词匹配：黄色 pill + "关键词「X」→ 节点 Y" 溯源说明
  - 命中节点：类型色块 / 度数 / 匹配原因
- **下半部分（两列对比）**：开启图谱增强 vs 不开启，实时流式渲染 Markdown

---

## 六、图谱优化方向（已记录）

| 优先级 | 方向 | 状态 |
|---|---|---|
| 1 | 确认 LLM 关系抽取正常运行（已完成） | ✅ 已完成 |
| 2 | 换 `zh_core_web_trf` 模型（BERT-based，NER 准确率更高） | 待测试 |
| 3 | LLM 一体化实体+关系抽取（替代 spaCy） | 待开发 |
| 4 | 引入 LightRAG / GraphRAG 方案 | 长期规划 |
