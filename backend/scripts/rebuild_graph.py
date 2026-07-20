#!/usr/bin/env python3
"""Rebuild the knowledge graph from all indexed documents.

Usage:
    conda run -n llm-rag python -m scripts.rebuild_graph [--no-llm]

Options:
    --no-llm    Skip LLM relation extraction (NER only, much faster)
"""
import asyncio
import json
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("rebuild_graph")


async def main(skip_llm: bool = False):
    # Import after path is set up
    from app.config import settings
    from app.db.file_store import FileStore
    from app.core.graph_store import get_graph, save_graph
    from app.core.graph_builder import extract_and_add_entities, extract_relations_with_llm
    from app.models.document import Chunk, ChunkMetadata

    # Clear the existing graph
    import networkx as nx
    import app.core.graph_store as gs
    gs._graph = nx.Graph()
    logger.info("Cleared existing graph")

    store = FileStore(settings.db_path)
    await store.init()
    docs = await store.list_all()
    indexed = [d for d in docs if d.status == "indexed"]
    logger.info("Found %d indexed documents", len(indexed))

    for doc in indexed:
        chunks_path = os.path.join(settings.graph_dir, f"{doc.id}.chunks.json")
        if not os.path.exists(chunks_path):
            logger.warning("No chunk file for doc %s (%s), skipping", doc.id[:8], doc.filename)
            continue

        with open(chunks_path, encoding="utf-8") as f:
            raw = json.load(f)

        chunks = []
        for item in raw:
            meta = item.get("metadata", {})
            chunks.append(Chunk(
                id=item["id"],
                document_id=meta.get("document_id", doc.id),
                content=item["content"],
                metadata=ChunkMetadata(
                    document_id=meta.get("document_id", doc.id),
                    filename=meta.get("filename", doc.filename),
                    chunk_index=meta.get("chunk_index", 0),
                    page=meta.get("page"),
                    char_start=meta.get("char_start", 0),
                    char_end=meta.get("char_end", 0),
                    heading=meta.get("heading"),
                ),
            ))

        logger.info("Processing %s: %d chunks", doc.filename, len(chunks))
        extract_and_add_entities(chunks)

        if not skip_llm:
            await extract_relations_with_llm(chunks)

    g = get_graph()
    logger.info("Rebuild complete — nodes: %d, edges: %d", g.number_of_nodes(), g.number_of_edges())
    save_graph()


if __name__ == "__main__":
    skip_llm = "--no-llm" in sys.argv
    asyncio.run(main(skip_llm=skip_llm))
