from __future__ import annotations
from ...models.document import Chunk
from .base import GraphBuilderBase


class LlmOnlyBuilder(GraphBuilderBase):
    """Strategy 2: Single LLM call extracts both entities and relations per chunk."""

    async def build(self, chunks: list[Chunk]) -> None:
        raise NotImplementedError(
            "LlmOnlyBuilder is not yet implemented. "
            "Set extraction.strategy: ner_llm in graph_config.yaml to use the current strategy."
        )
