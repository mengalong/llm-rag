from __future__ import annotations
import json

from ..config import settings
from ..models.query import QueryResponse, Source, GraphPath
from .graph_store import get_graph
from .graph_builder import _node_id, _get_nlp


def _extract_entities_from_question(question: str) -> list[str]:
    nlp = _get_nlp()
    doc = nlp(question)
    return [ent.text.strip() for ent in doc.ents if ent.text.strip()]


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
