from __future__ import annotations
import os
import chromadb
from chromadb.config import Settings as ChromaSettings

from ..config import settings
from ..models.document import Chunk


_client: chromadb.ClientAPI | None = None
_collection: chromadb.Collection | None = None
COLLECTION_NAME = "documents"


def _get_collection() -> chromadb.Collection:
    global _client, _collection
    if _client is None:
        os.makedirs(settings.chroma_dir, exist_ok=True)
        _client = chromadb.PersistentClient(
            path=settings.chroma_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
    if _collection is None:
        _collection = _client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def add_chunks(chunks: list[Chunk], embeddings: list[list[float]]) -> None:
    col = _get_collection()
    col.upsert(
        ids=[c.id for c in chunks],
        embeddings=embeddings,
        documents=[c.content for c in chunks],
        metadatas=[
            {
                "document_id": c.metadata.document_id,
                "filename": c.metadata.filename,
                "page": c.metadata.page or 0,
                "char_start": c.metadata.char_start,
                "char_end": c.metadata.char_end,
                "chunk_index": c.metadata.chunk_index,
                "heading": c.metadata.heading or "",
            }
            for c in chunks
        ],
    )


def search(
    query_embedding: list[float],
    top_k: int = 5,
    where: dict | None = None,
) -> list[dict]:
    col = _get_collection()
    kwargs: dict = dict(
        query_embeddings=[query_embedding],
        n_results=min(top_k, col.count() or 1),
        include=["documents", "metadatas", "distances"],
    )
    if where:
        kwargs["where"] = where
    results = col.query(**kwargs)
    if not results["ids"] or not results["ids"][0]:
        return []

    hits = []
    for i, chunk_id in enumerate(results["ids"][0]):
        meta = results["metadatas"][0][i]
        hits.append({
            "chunk_id": chunk_id,
            "content": results["documents"][0][i],
            "metadata": meta,
            "score": 1.0 - results["distances"][0][i],  # cosine distance → similarity
        })
    return hits


def get_chunks_by_ids(chunk_ids: list[str]) -> list[dict]:
    if not chunk_ids:
        return []
    col = _get_collection()
    results = col.get(
        ids=chunk_ids,
        include=["documents", "metadatas"],
    )
    hits = []
    for i, cid in enumerate(results["ids"]):
        meta = results["metadatas"][i]
        hits.append({
            "chunk_id": cid,
            "content": results["documents"][i],
            "metadata": meta,
            "score": 0.5,  # graph-retrieved, no cosine score
        })
    return hits


def delete_by_document(document_id: str) -> None:
    col = _get_collection()
    col.delete(where={"document_id": {"$eq": document_id}})
