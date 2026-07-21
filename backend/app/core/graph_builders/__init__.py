from __future__ import annotations
from ..graph_config import graph_cfg
from .base import GraphBuilderBase


def get_graph_builder() -> GraphBuilderBase:
    """Factory: return the configured graph builder strategy."""
    strategy = graph_cfg.builder_strategy
    if strategy == "ner_llm":
        from .ner_llm import NerLlmBuilder
        return NerLlmBuilder()
    if strategy == "llm_only":
        from .llm_only import LlmOnlyBuilder
        return LlmOnlyBuilder()
    if strategy == "lightrag":
        from .lightrag import LightRagBuilder
        return LightRagBuilder()
    if strategy == "graphrag":
        from .lightrag import GraphRagBuilder
        return GraphRagBuilder()
    raise ValueError(
        f"Unknown graph builder strategy: {strategy!r}. "
        "Valid options: ner_llm, llm_only, lightrag, graphrag"
    )


__all__ = ["get_graph_builder", "GraphBuilderBase"]
