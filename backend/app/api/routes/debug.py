from fastapi import APIRouter, HTTPException

from ...config import settings
from ...db.debug_store import DebugRecordStore

router = APIRouter()


def _store() -> DebugRecordStore:
    return DebugRecordStore(settings.db_path)


@router.get("/records")
async def list_debug_records(limit: int = 50):
    store = _store()
    await store.init()
    records = await store.list_all(limit=limit)
    # Return summary for list view (omit large context/answer fields)
    summaries = []
    for r in records:
        summaries.append({
            "id": r["id"],
            "created_at": r["created_at"],
            "question": r["question"],
            "top_k": r["top_k"],
            "graph_version": r["graph_version"],
            "graph_ner_model": r["graph_ner_model"],
            "graph_llm_model": r["graph_llm_model"],
            "graph_skip_llm": r["graph_skip_llm"],
            "graph_strategy": r["graph_strategy"],
            "qa_llm_model": r["qa_llm_model"],
            "vector_hit_count": len(r.get("vector_hits", [])),
            "graph_hit_count": len(r.get("graph_hits", [])),
        })
    return summaries


@router.get("/records/{record_id}")
async def get_debug_record(record_id: str):
    store = _store()
    await store.init()
    record = await store.get(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return record


@router.delete("/records/{record_id}")
async def delete_debug_record(record_id: str):
    store = _store()
    await store.init()
    deleted = await store.delete(record_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"deleted": record_id}
