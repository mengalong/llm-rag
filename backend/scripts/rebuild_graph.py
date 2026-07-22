#!/usr/bin/env python3
"""Rebuild the knowledge graph from all indexed documents.

Usage:
    conda run -n llm-rag python -m scripts.rebuild_graph [--no-llm]

Options:
    --no-llm    Force ner_llm strategy and skip LLM relation extraction
                (overrides graph_config.yaml for this run only)
"""
import asyncio
import json
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("rebuild_graph")


async def main(skip_llm: bool = False):
    from app.config import settings
    from app.db.file_store import FileStore
    from app.core.graph_store import get_graph, save_graph
    from app.core.graph_builders import get_graph_builder
    from app.models.document import Chunk, ChunkMetadata

    # --no-llm: temporarily force ner_llm strategy without LLM extraction
    if skip_llm:
        import app.core.graph_config as _gc
        _orig_strategy = _gc._config_cache  # will be refreshed from file anyway
        # Monkey-patch for this run only
        from app.core.graph_builders.ner_llm import NerLlmBuilder
        class _NerOnlyBuilder(NerLlmBuilder):
            async def build(self, chunks):
                self._extract_entities(chunks)  # skip _extract_relations
        builder_factory = lambda: _NerOnlyBuilder()
    else:
        builder_factory = get_graph_builder

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
        builder = builder_factory()
        await builder.build(chunks)

    g = get_graph()
    logger.info("Rebuild complete — nodes: %d, edges: %d", g.number_of_nodes(), g.number_of_edges())
    save_graph()

    # Save a snapshot after successful rebuild
    from app.core.graph_store import save_snapshot
    from app.core.graph_config import graph_cfg
    doc_names = [d.filename for d in indexed]
    version = save_snapshot(
        skip_llm=skip_llm,
        documents=doc_names,
        ner_model=graph_cfg.ner_model,
    )
    logger.info("Snapshot saved: %s", version)


if __name__ == "__main__":
    skip_llm = "--no-llm" in sys.argv
    asyncio.run(main(skip_llm=skip_llm))
