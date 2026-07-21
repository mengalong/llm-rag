from __future__ import annotations
import json
import re

from ..config import settings
from ..models.query import QueryResponse, Source, GraphPath
from .graph_store import get_graph
from .graph_builder import _node_id, _get_nlp

# Stop words to skip when doing fuzzy keyword matching
_STOP_WORDS = {
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
    '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
    '看', '好', '自己', '这', '那', '里', '来', '下', '什么', '怎么', '哪些',
    '如何', '为什么', '可以', '能', '吗', '呢', '啊', '吧', '了', '过', '把',
    '被', '让', '给', '从', '向', '跟', '与', '及', '或', '而', '但', '虽然',
    '因为', '所以', '如果', '虽', '但是', '然后', '之后', '之前', '当', '请',
    '告诉', '介绍', '描述', '说明', '列出', '总结', '分析', '比较',
}


def _extract_entities_from_question(question: str) -> list[str]:
    nlp = _get_nlp()
    doc = nlp(question)
    return [ent.text.strip() for ent in doc.ents if ent.text.strip()]


def _fuzzy_match_entities(question: str, max_results: int = 5) -> list[tuple[str, str]]:
    """Match question keywords against graph node labels.

    Returns list of (matched_label, keyword_that_matched) tuples.
    """
    g = get_graph()
    if g.number_of_nodes() == 0:
        return []

    raw = re.findall(r'[一-鿿a-zA-Z0-9]{2,}', question)
    candidates: list[str] = []
    for w in raw:
        if w in _STOP_WORDS or w.isdigit():
            continue
        candidates.append(w)
        for start in range(len(w)):
            for end in range(start + 2, min(start + 7, len(w) + 1)):
                sub = w[start:end]
                if sub not in _STOP_WORDS and sub not in candidates:
                    candidates.append(sub)
    if not candidates:
        return []

    # Score each graph node, also track the best matching keyword
    scored: list[tuple[int, int, str, str]] = []  # (match_count, label_len, label, best_kw)
    for _, data in g.nodes(data=True):
        label = data.get("label", "")
        if not label or len(label) < 2:
            continue
        matching_kws = [kw for kw in candidates if kw in label]
        if not matching_kws:
            continue
        # Pick the longest matching keyword as representative
        best_kw = max(matching_kws, key=len)
        scored.append((len(matching_kws), len(label), label, best_kw))

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [(label, best_kw) for _, _, label, best_kw in scored[:max_results]]


def _get_graph_chunks(entities: list[str], depth: int = 1) -> tuple[list[str], list[str], list[GraphPath]]:
    """Return (chunk_ids, entity_labels, graph_paths) from graph neighborhood."""
    g = get_graph()
    found_nodes: list[str] = []
    entity_labels: list[str] = []
    graph_paths: list[GraphPath] = []

    for ent in entities:
        nid = _node_id(ent)
        # Also try partial match by label
        if not g.has_node(nid):
            for node_id, data in g.nodes(data=True):
                if ent.lower() in data.get("label", "").lower():
                    nid = node_id
                    break
            else:
                continue

        entity_labels.append(g.nodes[nid].get("label", ent))
        found_nodes.append(nid)

        neighbors = list(g.neighbors(nid))
        for nb in neighbors[:5]:  # limit fan-out
            edge_data = g.get_edge_data(nid, nb, {})
            relation = edge_data.get("relation", "co-occurs")
            nb_label = g.nodes[nb].get("label", nb)
            graph_paths.append(GraphPath(
                entities=[g.nodes[nid].get("label", nid), nb_label],
                relations=[relation],
            ))
            found_nodes.append(nb)

    chunk_ids: list[str] = []
    for nid in set(found_nodes):
        if g.has_node(nid):
            cids = json.loads(g.nodes[nid].get("chunk_ids", "[]"))
            chunk_ids.extend(cids)

    return list(set(chunk_ids)), entity_labels, graph_paths
    """Return (chunk_ids, entity_labels, graph_paths) from graph neighborhood."""
    g = get_graph()
    found_nodes: list[str] = []
    entity_labels: list[str] = []
    graph_paths: list[GraphPath] = []

    for ent in entities:
        nid = _node_id(ent)
        # Also try partial match by label
        if not g.has_node(nid):
            for node_id, data in g.nodes(data=True):
                if ent.lower() in data.get("label", "").lower():
                    nid = node_id
                    break
            else:
                continue

        entity_labels.append(g.nodes[nid].get("label", ent))
        found_nodes.append(nid)

        neighbors = list(g.neighbors(nid))
        for nb in neighbors[:5]:  # limit fan-out
            edge_data = g.get_edge_data(nid, nb, {})
            relation = edge_data.get("relation", "co-occurs")
            nb_label = g.nodes[nb].get("label", nb)
            graph_paths.append(GraphPath(
                entities=[g.nodes[nid].get("label", nid), nb_label],
                relations=[relation],
            ))
            found_nodes.append(nb)

    chunk_ids: list[str] = []
    for nid in set(found_nodes):
        if g.has_node(nid):
            cids = json.loads(g.nodes[nid].get("chunk_ids", "[]"))
            chunk_ids.extend(cids)

    return list(set(chunk_ids)), entity_labels, graph_paths


def build_sources_from_hits(hits: list[dict]) -> list[Source]:
    return [
        Source(
            chunk_id=h["chunk_id"],
            document_id=h["metadata"]["document_id"],
            filename=h["metadata"]["filename"],
            page=h["metadata"]["page"] or None,
            char_start=h["metadata"]["char_start"],
            char_end=h["metadata"]["char_end"],
            relevance_score=h["score"],
            excerpt=h["content"],
        )
        for h in hits
    ]
