from __future__ import annotations
import json
import hashlib
import logging

import spacy

from ...models.document import Chunk
from ...config import settings
from ..graph_store import get_graph, save_graph
from ..graph_config import graph_cfg
from .base import GraphBuilderBase

logger = logging.getLogger("rag.graph.ner_llm")

_nlp_cache: dict[str, object] = {}


def _get_nlp(model_name: str):
    if model_name not in _nlp_cache:
        logger.info("loading spaCy model %s ...", model_name)
        _nlp_cache[model_name] = spacy.load(model_name)
        logger.info("spaCy model %s loaded", model_name)
    return _nlp_cache[model_name]


def _node_id(label: str) -> str:
    return hashlib.md5(label.strip().lower().encode()).hexdigest()[:16]


def _normalize_entity_text(text: str) -> str:
    """Strip unmatched book-title brackets and surrounding whitespace."""
    t = text.strip()
    if t.startswith('《') and not t.endswith('》'):
        t = t[1:].strip()
    elif t.endswith('》') and not t.startswith('《'):
        t = t[:-1].strip()
    return t
    return hashlib.md5(label.strip().lower().encode()).hexdigest()[:16]


class NerLlmBuilder(GraphBuilderBase):
    """Strategy 1: spaCy NER for entities + LLM for relation triples.

    NER model is configurable via graph_config.yaml `extraction.ner_model`.
    LLM relation extraction is skipped if llm_api_key is not set.
    """

    async def build(self, chunks: list[Chunk]) -> None:
        self._extract_entities(chunks)
        await self._extract_relations(chunks)

    def _extract_entities(self, chunks: list[Chunk]) -> None:
        ner_model = graph_cfg.ner_model
        g = get_graph()
        nlp = _get_nlp(ner_model)
        total = 0

        for chunk in chunks:
            from ..text_cleaner import clean_for_ner
            clean_content = clean_for_ner(chunk.content)
            doc = nlp(clean_content)
            entities = [
                (_normalize_entity_text(ent.text.strip()), ent.label_)
                for ent in doc.ents
                if ent.text.strip() and graph_cfg.is_valid_entity(_normalize_entity_text(ent.text.strip()), ent.label_)
            ]
            if not entities:
                continue
            total += len(entities)

            entity_node_ids: list[str] = []
            for ent_text, ent_type in entities:
                nid = _node_id(ent_text)
                if g.has_node(nid):
                    existing_docs = json.loads(g.nodes[nid].get("document_ids", "[]"))
                    existing_chunks = json.loads(g.nodes[nid].get("chunk_ids", "[]"))
                    if chunk.metadata.document_id not in existing_docs:
                        existing_docs.append(chunk.metadata.document_id)
                    if chunk.id not in existing_chunks:
                        existing_chunks.append(chunk.id)
                    g.nodes[nid]["document_ids"] = json.dumps(existing_docs)
                    g.nodes[nid]["chunk_ids"] = json.dumps(existing_chunks)
                else:
                    g.add_node(nid, label=ent_text, type=ent_type,
                               document_ids=json.dumps([chunk.metadata.document_id]),
                               chunk_ids=json.dumps([chunk.id]))
                entity_node_ids.append(nid)

            for i in range(len(entity_node_ids)):
                for j in range(i + 1, len(entity_node_ids)):
                    u, v = entity_node_ids[i], entity_node_ids[j]
                    if g.has_edge(u, v):
                        g[u][v]["weight"] = g[u][v].get("weight", 1.0) + 1.0
                        existing_chunks = json.loads(g[u][v].get("chunk_ids", "[]"))
                        if chunk.id not in existing_chunks:
                            existing_chunks.append(chunk.id)
                        g[u][v]["chunk_ids"] = json.dumps(existing_chunks)
                    else:
                        g.add_edge(u, v, id=f"{u}_{v}", relation="co-occurs",
                                   weight=1.0, chunk_ids=json.dumps([chunk.id]))

        logger.info("NER (%s): %d chunks → %d entities, graph %d nodes / %d edges",
                    ner_model, len(chunks), total, g.number_of_nodes(), g.number_of_edges())
        save_graph()

    async def _extract_relations(self, chunks: list[Chunk]) -> None:
        import anthropic
        import json as _json

        llm_key = graph_cfg.graph_llm_api_key or settings.effective_graph_llm_api_key
        if not llm_key:
            logger.info("LLM relation extraction skipped (no API key)")
            return

        base_url = graph_cfg.graph_llm_base_url or settings.llm_base_url
        model = settings.effective_graph_llm_model
        logger.info("LLM relation extraction: %d chunks, model=%s", len(chunks), model)

        client = anthropic.Anthropic(api_key=llm_key, base_url=base_url)
        g = get_graph()
        triple_count = 0

        system_prompt = (
            "You are an information extraction system. "
            "Extract relation triples from the text and return ONLY a JSON array. "
            'Each element: {"subject": "...", "relation": "...", "object": "..."}. '
            "Use concise noun phrases (2-20 characters). "
            "If a subject or object is an enumeration separated by 、or ，, split it into separate triples. "
            "Do NOT use entire lists or code identifiers as entities. "
            "Return [] if no clear relations found."
        )

        for i, chunk in enumerate(chunks):
            if len(chunk.content) < 20:
                continue
            try:
                msg = client.messages.create(
                    model=model, max_tokens=512, system=system_prompt,
                    messages=[{"role": "user", "content": chunk.content[:1500]}],
                )
                raw = msg.content[0].text.strip()
                start, end = raw.find("["), raw.rfind("]") + 1
                if start == -1 or end == 0:
                    continue
                triples = _json.loads(raw[start:end])

                for triple in triples:
                    subj = str(triple.get("subject", "")).strip()
                    rel = str(triple.get("relation", "")).strip()
                    obj = str(triple.get("object", "")).strip()
                    if not (subj and rel and obj):
                        continue

                    subj_labels = [s for s in graph_cfg.split_llm_entity(subj) if graph_cfg.is_valid_llm_entity(s)]
                    obj_labels  = [o for o in graph_cfg.split_llm_entity(obj)  if graph_cfg.is_valid_llm_entity(o)]
                    if not subj_labels or not obj_labels:
                        continue

                    triple_count += len(subj_labels) * len(obj_labels)
                    for s_label in subj_labels:
                        for o_label in obj_labels:
                            for label in (s_label, o_label):
                                nid = _node_id(label)
                                if not g.has_node(nid):
                                    g.add_node(nid, label=label, type="ENTITY",
                                               document_ids=_json.dumps([chunk.metadata.document_id]),
                                               chunk_ids=_json.dumps([chunk.id]))
                            u, v = _node_id(s_label), _node_id(o_label)
                            if not g.has_edge(u, v):
                                g.add_edge(u, v, id=f"{u}_{v}", relation=rel,
                                           weight=1.0, chunk_ids=_json.dumps([chunk.id]))
                            else:
                                g[u][v]["weight"] = g[u][v].get("weight", 1.0) + 1.0

            except Exception as e:
                logger.warning("LLM relation extraction failed for chunk %d: %s", i, e)

        logger.info("LLM relation extraction done: %d triples added", triple_count)
        save_graph()
