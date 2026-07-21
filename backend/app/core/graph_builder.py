"""graph_builder.py — backward-compatible re-exports.

New code should use graph_builders package directly:
    from .graph_builders import get_graph_builder
    await get_graph_builder().build(chunks)
"""
from __future__ import annotations
import hashlib
import json
import logging

from ..models.document import Chunk
from .graph_store import get_graph, save_graph
from .graph_config import graph_cfg

logger = logging.getLogger("rag.graph")


def _normalize(text: str) -> str:
    return text.strip().lower()


def _node_id(label: str) -> str:
    return hashlib.md5(label.strip().lower().encode()).hexdigest()[:16]


# Kept for backward compatibility
VALID_ENTITY_TYPES = graph_cfg.valid_entity_types


def _is_valid_entity(text: str, label: str) -> bool:
    return graph_cfg.is_valid_entity(text, label)


def _get_nlp():
    """Return the configured spaCy model (lazy-loaded)."""
    from .graph_builders.ner_llm import _get_nlp as _builder_get_nlp
    return _builder_get_nlp(graph_cfg.ner_model)


def extract_and_add_entities(chunks: list[Chunk]) -> None:
    """Backward-compatible wrapper — delegates to NerLlmBuilder._extract_entities."""
    from .graph_builders.ner_llm import NerLlmBuilder
    NerLlmBuilder()._extract_entities(chunks)


async def extract_relations_with_llm(chunks: list[Chunk]) -> None:
    """Backward-compatible wrapper — delegates to NerLlmBuilder._extract_relations."""
    from .graph_builders.ner_llm import NerLlmBuilder
    await NerLlmBuilder()._extract_relations(chunks)


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
