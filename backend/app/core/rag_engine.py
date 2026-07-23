from __future__ import annotations
import json
import re

from ..config import settings
from ..models.query import QueryResponse, Source, GraphPath
from .kuzu_store import get_graph
from .graph_builder import _node_id, _get_nlp
from .graph_config import graph_cfg


def _extract_entities_from_question(question: str) -> list[str]:
    nlp = _get_nlp()
    doc = nlp(question)
    return [ent.text.strip() for ent in doc.ents if ent.text.strip()]


def _fuzzy_match_entities(question: str, max_results: int | None = None) -> list[tuple[str, str]]:
    """Match question keywords against graph node labels.

    Returns list of (matched_label, keyword_that_matched) tuples.
    """
    limit = max_results if max_results is not None else graph_cfg.fuzzy_max_results
    stop_words = graph_cfg.stop_words
    g = get_graph()
    if g.number_of_nodes() == 0:
        return []

    raw = re.findall(r'[一-鿿a-zA-Z0-9]{2,}', question)
    candidates: list[str] = []
    for w in raw:
        if w in stop_words or w.isdigit():
            continue
        candidates.append(w)
        for start in range(len(w)):
            for end in range(start + 2, min(start + 7, len(w) + 1)):
                sub = w[start:end]
                if sub not in stop_words and sub not in candidates:
                    candidates.append(sub)
    if not candidates:
        return []

    scored: list[tuple[int, int, str, str]] = []
    for _, data in g.nodes(data=True):
        label = data.get("label", "")
        if not label or len(label) < 2:
            continue
        matching_kws = [kw for kw in candidates if kw in label]
        if not matching_kws:
            continue
        best_kw = max(matching_kws, key=len)
        scored.append((len(matching_kws), len(label), label, best_kw))

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [(label, best_kw) for _, _, label, best_kw in scored[:limit]]


def _get_graph_chunks(entities: list[str], depth: int = 1) -> tuple[list[str], list[str], list[GraphPath]]:
    """Return (chunk_ids, entity_labels, graph_paths) from graph neighborhood."""
    g = get_graph()
    neighbor_limit = graph_cfg.graph_neighbor_limit
    found_nodes: list[str] = []
    entity_labels: list[str] = []
    graph_paths: list[GraphPath] = []

    for ent in entities:
        nid = _node_id(ent)
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
        for nb in neighbors[:neighbor_limit]:
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
