from __future__ import annotations
import asyncio
import hashlib
import json
import logging

from ...models.document import Chunk
from ...config import settings
from ..kuzu_store import get_graph, save_graph
from ..graph_config import graph_cfg
from .base import GraphBuilderBase

logger = logging.getLogger("rag.graph.llm_only")

_SYSTEM_PROMPT = """\
你是一个信息抽取系统。从给定文本中抽取实体及其关系，返回 JSON 数组。

每个元素格式：
{"subject": "实体A", "relation": "关系描述", "object": "实体B", "subject_type": "类型", "object_type": "类型"}

类型取值（参考）：PERSON/ORG/GPE/LOC/PRODUCT/EVENT/WORK_OF_ART/CONCEPT

规则：
- 实体用简洁名词短语（2-40 字符），不得使用代码标识符、枚举列表、文件路径
- 若 subject 或 object 是 "A、B、C" 形式，拆成多个独立 triple
- camelCase / PascalCase 标识符、点链式调用（a.b.c）不作实体
- 无明确关系时返回 []
- 只返回 JSON 数组，不加任何说明文字\
"""


def _node_id(label: str) -> str:
    return hashlib.md5(label.strip().lower().encode()).hexdigest()[:16]


def _merge_node(g, nid: str, label: str, entity_type: str, doc_id: str, chunk_id: str) -> None:
    if g.has_node(nid):
        doc_ids = json.loads(g.nodes[nid].get("document_ids", "[]"))
        chunk_ids = json.loads(g.nodes[nid].get("chunk_ids", "[]"))
        if doc_id not in doc_ids:
            doc_ids.append(doc_id)
        if chunk_id not in chunk_ids:
            chunk_ids.append(chunk_id)
        g.nodes[nid]["document_ids"] = json.dumps(doc_ids)
        g.nodes[nid]["chunk_ids"] = json.dumps(chunk_ids)
    else:
        g.add_node(nid, label=label, type=entity_type,
                   document_ids=json.dumps([doc_id]),
                   chunk_ids=json.dumps([chunk_id]))


def _merge_edge(g, u: str, v: str, relation: str, chunk_id: str) -> None:
    if g.has_edge(u, v):
        g[u][v]["weight"] = g[u][v].get("weight", 1.0) + 1.0
        chunk_ids = json.loads(g[u][v].get("chunk_ids", "[]"))
        if chunk_id not in chunk_ids:
            chunk_ids.append(chunk_id)
        g[u][v]["chunk_ids"] = json.dumps(chunk_ids)
    else:
        g.add_edge(u, v, id=f"{u}_{v}", relation=relation,
                   weight=1.0, chunk_ids=json.dumps([chunk_id]))


def _apply_triples(triples: list[dict], chunk: Chunk) -> int:
    """Write validated triples from one LLM response into the graph. Returns count added."""
    g = get_graph()
    added = 0
    doc_id = chunk.metadata.document_id

    for triple in triples:
        subj_raw = str(triple.get("subject", "")).strip()
        rel = str(triple.get("relation", "")).strip()
        obj_raw = str(triple.get("object", "")).strip()
        subj_type = str(triple.get("subject_type", "ENTITY")).strip() or "ENTITY"
        obj_type = str(triple.get("object_type", "ENTITY")).strip() or "ENTITY"

        if not (subj_raw and rel and obj_raw):
            continue

        subj_labels = [s for s in graph_cfg.split_llm_entity(subj_raw)
                       if graph_cfg.is_valid_llm_entity(s)]
        obj_labels = [o for o in graph_cfg.split_llm_entity(obj_raw)
                      if graph_cfg.is_valid_llm_entity(o)]
        if not subj_labels or not obj_labels:
            continue

        for s_label in subj_labels:
            for o_label in obj_labels:
                _merge_node(g, _node_id(s_label), s_label, subj_type, doc_id, chunk.id)
                _merge_node(g, _node_id(o_label), o_label, obj_type, doc_id, chunk.id)
                _merge_edge(g, _node_id(s_label), _node_id(o_label), rel, chunk.id)
                added += 1

    return added


def _parse_response(raw: str) -> list[dict]:
    start, end = raw.find("["), raw.rfind("]") + 1
    if start == -1 or end == 0:
        return []
    return json.loads(raw[start:end])


class LlmOnlyBuilder(GraphBuilderBase):
    """Strategy: single LLM call per batch extracts both entities and relations.

    Reuses all filter rules from graph_config.yaml (is_valid_llm_entity,
    split_llm_entity, skip_dot_notation, skip_camel_case, max_length).
    batch_size and concurrency are read from graph_config.yaml under extraction.llm_only.
    """

    def _llm_cfg(self) -> dict:
        return graph_cfg._ex.get("llm_only", {})

    @property
    def batch_size(self) -> int:
        return int(self._llm_cfg().get("batch_size", 3))

    @property
    def concurrency(self) -> int:
        return int(self._llm_cfg().get("concurrency", 3))

    async def build(self, chunks: list[Chunk]) -> None:
        import anthropic

        llm_key = graph_cfg.graph_llm_api_key or settings.effective_graph_llm_api_key
        if not llm_key:
            logger.warning("LlmOnlyBuilder: no LLM API key configured, graph build skipped")
            return

        base_url = graph_cfg.graph_llm_base_url or settings.llm_base_url
        model = settings.effective_graph_llm_model

        client = anthropic.Anthropic(api_key=llm_key, base_url=base_url)

        # Filter out trivially short chunks
        valid_chunks = [c for c in chunks if len(c.content) >= 20]
        # Group into batches
        batches: list[list[Chunk]] = []
        for i in range(0, len(valid_chunks), self.batch_size):
            batches.append(valid_chunks[i: i + self.batch_size])

        logger.info(
            "LlmOnlyBuilder: %d chunks → %d batches (batch_size=%d, concurrency=%d), model=%s",
            len(valid_chunks), len(batches), self.batch_size, self.concurrency, model,
        )

        sem = asyncio.Semaphore(self.concurrency)
        total_triples = 0

        async def process_batch(batch_idx: int, batch: list[Chunk]) -> int:
            combined_text = "\n\n".join(
                f"[段落{i+1}]\n{c.content[:1200]}" for i, c in enumerate(batch)
            )
            async with sem:
                try:
                    msg = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: client.messages.create(
                            model=model,
                            max_tokens=1024,
                            system=_SYSTEM_PROMPT,
                            messages=[{"role": "user", "content": combined_text}],
                        ),
                    )
                    raw = msg.content[0].text.strip()
                    triples = _parse_response(raw)
                except Exception as e:
                    logger.warning("LlmOnlyBuilder batch %d failed: %s", batch_idx, e)
                    return 0

            count = 0
            # Attribute triples to the first chunk of the batch (best-effort)
            for triple in triples:
                count += _apply_triples([triple], batch[0])
            return count

        tasks = [process_batch(i, b) for i, b in enumerate(batches)]
        results = await asyncio.gather(*tasks)
        total_triples = sum(results)

        g = get_graph()
        save_graph()
        logger.info(
            "LlmOnlyBuilder done: %d triples → graph %d nodes / %d edges",
            total_triples, g.number_of_nodes(), g.number_of_edges(),
        )
