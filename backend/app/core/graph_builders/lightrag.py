from __future__ import annotations
from ...models.document import Chunk
from .base import GraphBuilderBase


class LightRagBuilder(GraphBuilderBase):
    """Strategy 3: LightRAG — requires pip install lightrag-hku."""

    async def build(self, chunks: list[Chunk]) -> None:
        raise NotImplementedError(
            "LightRagBuilder is not yet implemented. "
            "Install lightrag-hku and implement this class to use LightRAG."
        )


class GraphRagBuilder(GraphBuilderBase):
    """Strategy 4: Microsoft GraphRAG — requires pip install graphrag."""

    async def build(self, chunks: list[Chunk]) -> None:
        raise NotImplementedError(
            "GraphRagBuilder is not yet implemented. "
            "Install graphrag and implement this class to use Microsoft GraphRAG."
        )
