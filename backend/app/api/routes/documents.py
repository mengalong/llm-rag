import os
import shutil
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Literal

from ...config import settings
from ...db.file_store import FileStore
from ...models.document import Document
from ...processors.registry import get_processor
from ...core.chunker import chunk_document

router = APIRouter()
logger = logging.getLogger("rag.documents")


class ChunkSettings(BaseModel):
    chunk_strategy: Literal["recursive", "sentence", "fixed"] = "recursive"
    chunk_size: int = 2000
    chunk_overlap: int = 256


async def _set_progress(store: FileStore, doc_id: str, progress: int, step: str, chunk_count: int = 0) -> None:
    await store.update_status(doc_id, "processing", chunk_count=chunk_count,
                              progress=progress, progress_step=step)


async def _index_document(
    doc_id: str, file_path: str, filename: str, mime_type: str,
    chunk_size: int, chunk_overlap: int, chunk_strategy: str,
) -> None:
    store = FileStore(settings.db_path)
    logger.info("[%s] indexing started  file=%s mime=%s strategy=%s size=%d overlap=%d",
                doc_id[:8], filename, mime_type, chunk_strategy, chunk_size, chunk_overlap)
    try:
        await _set_progress(store, doc_id, 5, "解析文件...")

        processor = get_processor(filename, mime_type)
        logger.info("[%s] using processor %s", doc_id[:8], type(processor).__name__)
        pages = processor.extract_text(file_path)
        logger.info("[%s] extracted %d page-segments", doc_id[:8], len(pages))

        await _set_progress(store, doc_id, 20, "文本切片...")

        chunks = chunk_document(
            document_id=doc_id,
            filename=filename,
            pages=pages,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        logger.info("[%s] chunked into %d chunks", doc_id[:8], len(chunks))

        await _set_progress(store, doc_id, 40, f"向量化 {len(chunks)} 个片段...", chunk_count=len(chunks))

        from ...core.embedder import get_embedder
        from ...core.vector_store import add_chunks as vs_add_chunks

        embedder = get_embedder()
        embeddings = embedder.embed([c.content for c in chunks])
        logger.info("[%s] embedding done, dim=%d", doc_id[:8], len(embeddings[0]) if embeddings else 0)
        vs_add_chunks(chunks, embeddings)
        logger.info("[%s] stored in ChromaDB", doc_id[:8])

        await _set_progress(store, doc_id, 70, "构建知识图谱...", chunk_count=len(chunks))

        from ...core.graph_builders import get_graph_builder
        builder = get_graph_builder()
        await _set_progress(store, doc_id, 75, f"图谱策略: {builder.__class__.__name__}...", chunk_count=len(chunks))
        await builder.build(chunks)
        logger.info("[%s] graph build done (%s)", doc_id[:8], builder.__class__.__name__)

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        await store.update_status(doc_id, "indexed", chunk_count=len(chunks),
                                  progress=100, progress_step="索引完成",
                                  indexed_at=now)
        logger.info("[%s] indexed OK  chunks=%d", doc_id[:8], len(chunks))

        import json
        chunks_path = os.path.join(settings.graph_dir, f"{doc_id}.chunks.json")
        with open(chunks_path, "w", encoding="utf-8") as f:
            json.dump([c.model_dump() for c in chunks], f, ensure_ascii=False, default=str)

    except Exception as e:
        logger.exception("[%s] indexing FAILED: %s", doc_id[:8], e)
        await store.update_status(doc_id, "error", error=str(e))


@router.post("/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    chunk_strategy: str = "recursive",
    chunk_size: int = 2000,
    chunk_overlap: int = 256,
):
    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.graph_dir, exist_ok=True)

    doc_id = str(uuid.uuid4())
    filename = file.filename or "unknown"
    file_path = os.path.join(settings.upload_dir, f"{doc_id}_{filename}")

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    file_size = os.path.getsize(file_path)
    mime_type = file.content_type or "application/octet-stream"
    logger.info("upload received  filename=%s size=%d mime=%s strategy=%s doc_id=%s",
                filename, file_size, mime_type, chunk_strategy, doc_id[:8])

    doc = Document(
        id=doc_id,
        filename=filename,
        mime_type=mime_type,
        file_path=file_path,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        progress=0,
        progress_step="等待处理...",
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        chunk_strategy=chunk_strategy,
    )

    store = FileStore(settings.db_path)
    await store.init()
    await store.create(doc)

    background_tasks.add_task(
        _index_document, doc_id, file_path, filename, mime_type,
        chunk_size, chunk_overlap, chunk_strategy,
    )
    logger.info("indexing task queued for doc_id=%s", doc_id[:8])

    return {"id": doc_id, "filename": filename, "status": "pending"}


@router.get("/")
async def list_documents():
    store = FileStore(settings.db_path)
    await store.init()
    docs = await store.list_all()
    return [d.model_dump() for d in docs]


@router.get("/{doc_id}/chunks")
async def get_document_chunks(doc_id: str):
    """Return all chunks for a document from ChromaDB."""
    store = FileStore(settings.db_path)
    await store.init()
    doc = await store.get(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status != "indexed":
        return {"chunks": [], "total": 0}

    from ...core.vector_store import _get_collection
    col = _get_collection()
    results = col.get(
        where={"document_id": {"$eq": doc_id}},
        include=["documents", "metadatas"],
    )
    chunks = []
    for i, cid in enumerate(results["ids"]):
        meta = results["metadatas"][i]
        chunks.append({
            "id": cid,
            "content": results["documents"][i],
            "chunk_index": meta.get("chunk_index", i),
            "page": meta.get("page") or None,
            "char_start": meta.get("char_start", 0),
            "char_end": meta.get("char_end", 0),
            "heading": meta.get("heading") or None,
        })
    chunks.sort(key=lambda c: c["chunk_index"])
    return {"chunks": chunks, "total": len(chunks)}


@router.get("/{doc_id}")
async def get_document(doc_id: str):
    store = FileStore(settings.db_path)
    await store.init()
    doc = await store.get(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc.model_dump()


@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    store = FileStore(settings.db_path)
    await store.init()
    doc = await store.get(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    chunks_path = os.path.join(settings.graph_dir, f"{doc_id}.chunks.json")
    if os.path.exists(chunks_path):
        os.remove(chunks_path)

    from ...core.vector_store import delete_by_document
    delete_by_document(doc_id)

    from ...core.graph_builder import remove_document_from_graph
    remove_document_from_graph(doc_id)

    deleted = await store.delete(doc_id)
    logger.info("deleted doc_id=%s", doc_id[:8])
    return {"deleted": deleted}
