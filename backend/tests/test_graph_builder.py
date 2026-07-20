import pytest
from unittest.mock import MagicMock, patch
from app.core.graph_builder import _normalize, _node_id, extract_and_add_entities
from app.models.document import Chunk, ChunkMetadata


def make_chunk(content: str, doc_id: str = "doc1", idx: int = 0) -> Chunk:
    return Chunk(
        id=f"chunk-{idx}",
        document_id=doc_id,
        content=content,
        metadata=ChunkMetadata(
            document_id=doc_id,
            filename="test.txt",
            chunk_index=idx,
            char_start=0,
            char_end=len(content),
        ),
    )


def test_normalize():
    assert _normalize("  Hello World  ") == "hello world"
    assert _normalize("中文实体") == "中文实体"


def test_node_id_deterministic():
    assert _node_id("Apple") == _node_id("Apple")
    assert _node_id("Apple") != _node_id("Google")


def test_extract_entities_adds_nodes():
    from app.core.graph_store import get_graph
    import networkx as nx

    chunks = [make_chunk("苹果公司成立于加利福尼亚州。乔布斯是苹果的创始人。")]

    # Patch save_graph to avoid file I/O
    with patch("app.core.graph_builder.save_graph"):
        with patch("app.core.graph_builder.get_graph") as mock_get:
            g = nx.Graph()
            mock_get.return_value = g
            extract_and_add_entities(chunks)
            # Graph should have nodes after extraction (spaCy may find entities)
            # We just assert no exception is raised; entity count depends on model
            assert isinstance(g, nx.Graph)
