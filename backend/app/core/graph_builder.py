from __future__ import annotations
import json
import hashlib
import logging

import spacy

from ..models.document import Chunk
from ..config import settings
from .graph_store import get_graph, save_graph

logger = logging.getLogger("rag.graph")

_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        logger.info("loading spaCy model zh_core_web_sm ...")
        _nlp = spacy.load("zh_core_web_sm")
        logger.info("spaCy model loaded")
    return _nlp


def _normalize(text: str) -> str:
    return text.strip().lower()


def _node_id(label: str) -> str:
    return hashlib.md5(label.strip().lower().encode()).hexdigest()[:16]


VALID_ENTITY_TYPES = {'PERSON', 'ORG', 'GPE', 'PRODUCT', 'LOC', 'WORK_OF_ART', 'EVENT', 'FAC', 'NORP'}


def _is_valid_entity(text: str, label: str) -> bool:
    if label not in VALID_ENTITY_TYPES:
        return False
    if len(text) < 2:
        return False
    if text.isdigit():
        return False
    # filter lone punctuation / numbers with punctuation e.g. "1." "（3）"
    import re
    if re.fullmatch(r'[\d\s\.\、\。\，\,\(\)\（\）\【\】]+', text):
        return False
    return True


def extract_and_add_entities(chunks: list[Chunk]) -> None:
    """Run spaCy NER on chunks and build/update the knowledge graph."""
    g = get_graph()
    nlp = _get_nlp()
    total_entities = 0

    for chunk in chunks:
        doc = nlp(chunk.content)
        entities = [
            (ent.text.strip(), ent.label_)
            for ent in doc.ents
            if ent.text.strip() and _is_valid_entity(ent.text.strip(), ent.label_)
        ]
        if not entities:
            continue
        total_entities += len(entities)

        entity_node_ids: list[str] = []
        for ent_text, ent_type in entities:
            nid = _node_id(ent_text)
            if g.has_node(nid):
                # Update existing node
                existing_docs = json.loads(g.nodes[nid].get("document_ids", "[]"))
                existing_chunks = json.loads(g.nodes[nid].get("chunk_ids", "[]"))
                if chunk.metadata.document_id not in existing_docs:
                    existing_docs.append(chunk.metadata.document_id)
                if chunk.id not in existing_chunks:
                    existing_chunks.append(chunk.id)
                g.nodes[nid]["document_ids"] = json.dumps(existing_docs)
                g.nodes[nid]["chunk_ids"] = json.dumps(existing_chunks)
            else:
                g.add_node(
                    nid,
                    label=ent_text,
                    type=ent_type,
                    document_ids=json.dumps([chunk.metadata.document_id]),
                    chunk_ids=json.dumps([chunk.id]),
                )
            entity_node_ids.append(nid)

        # Add co-occurrence edges between all entity pairs in this chunk
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
                    edge_id = f"{u}_{v}"
                    g.add_edge(u, v,
                               id=edge_id,
                               relation="co-occurs",
                               weight=1.0,
                               chunk_ids=json.dumps([chunk.id]))

    logger.info("NER done: %d chunks → %d entities, graph now has %d nodes / %d edges",
                len(chunks), total_entities, g.number_of_nodes(), g.number_of_edges())
    save_graph()


async def extract_relations_with_llm(chunks: list[Chunk]) -> None:
    """Use Claude to extract typed relation triples and add them to the graph."""
    import anthropic
    import json as _json

    if not settings.llm_api_key:
        logger.info("LLM relation extraction skipped (no LLM_API_KEY)")
        return

    logger.info("LLM relation extraction: %d chunks, model=%s", len(chunks), settings.effective_graph_llm_model)
    client = anthropic.Anthropic(
        api_key=settings.effective_graph_llm_api_key,
        base_url=settings.llm_base_url,
    )
    g = get_graph()
    triple_count = 0

    system_prompt = (
        "You are an information extraction system. "
        "Extract relation triples from the text and return ONLY a JSON array. "
        'Each element: {"subject": "...", "relation": "...", "object": "..."}. '
        "Use concise noun phrases. Return [] if no clear relations found."
    )

    for i, chunk in enumerate(chunks):
        if len(chunk.content) < 20:
            continue
        try:
            msg = client.messages.create(
                model=settings.effective_graph_llm_model,
                max_tokens=512,
                system=system_prompt,
                messages=[{"role": "user", "content": chunk.content[:1500]}],
            )
            raw = msg.content[0].text.strip()
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start == -1 or end == 0:
                continue
            triples = _json.loads(raw[start:end])

            for triple in triples:
                subj = str(triple.get("subject", "")).strip()
                rel = str(triple.get("relation", "")).strip()
                obj = str(triple.get("object", "")).strip()
                if not (subj and rel and obj):
                    continue
                triple_count += 1

                for label in (subj, obj):
                    nid = _node_id(label)
                    if not g.has_node(nid):
                        g.add_node(nid, label=label, type="ENTITY",
                                   document_ids=_json.dumps([chunk.metadata.document_id]),
                                   chunk_ids=_json.dumps([chunk.id]))

                u, v = _node_id(subj), _node_id(obj)
                if not g.has_edge(u, v):
                    g.add_edge(u, v, id=f"{u}_{v}", relation=rel,
                               weight=1.0, chunk_ids=_json.dumps([chunk.id]))
                else:
                    g[u][v]["weight"] = g[u][v].get("weight", 1.0) + 1.0

        except Exception as e:
            logger.warning("LLM relation extraction failed for chunk %d: %s", i, e)
            continue

    logger.info("LLM relation extraction done: %d triples added", triple_count)
    save_graph()


def remove_document_from_graph(document_id: str) -> None:
    g = get_graph()
    nodes_to_remove = []
    for node_id, data in g.nodes(data=True):
        doc_ids = json.loads(data.get("document_ids", "[]"))
        if document_id in doc_ids:
            doc_ids.remove(document_id)
            if not doc_ids:
                nodes_to_remove.append(node_id)
            else:
                g.nodes[node_id]["document_ids"] = json.dumps(doc_ids)

    g.remove_nodes_from(nodes_to_remove)
    save_graph()
