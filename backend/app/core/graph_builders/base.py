from __future__ import annotations
from ...models.document import Chunk


class GraphBuilderBase:
    """Abstract base class for all graph builder strategies."""

    async def build(self, chunks: list[Chunk]) -> None:
        """Extract entities/relations from chunks and write to graph_store."""
        raise NotImplementedError(f"{self.__class__.__name__}.build() is not implemented")
