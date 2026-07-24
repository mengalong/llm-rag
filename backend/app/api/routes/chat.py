from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any

from ...config import settings
from ...db.chat_store import ChatStore

router = APIRouter()


def _store() -> ChatStore:
    return ChatStore(settings.db_path)


# ── Request models ──────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    id: str
    title: str = "新对话"
    created_at: str = ""


class UpdateTitleRequest(BaseModel):
    title: str


class AddMessageRequest(BaseModel):
    role: str
    content: str
    created_at: str
    sources: list = []
    graph_entities: list = []
    graph_paths: list = []
    graph_chunk_ids: list = []
    graph_version: str = ""


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions():
    return await _store().list_sessions()


@router.post("/sessions", status_code=201)
async def create_session(req: CreateSessionRequest):
    return await _store().create_session(req.id, req.title, req.created_at)


@router.put("/sessions/{session_id}/title")
async def update_title(session_id: str, req: UpdateTitleRequest):
    await _store().update_session_title(session_id, req.title)
    return {"ok": True}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    ok = await _store().delete_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": session_id}


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    return await _store().get_messages(session_id)


@router.post("/sessions/{session_id}/messages", status_code=201)
async def add_message(session_id: str, req: AddMessageRequest):
    return await _store().add_message(
        session_id=session_id,
        role=req.role,
        content=req.content,
        created_at=req.created_at,
        sources=req.sources,
        graph_entities=req.graph_entities,
        graph_paths=req.graph_paths,
        graph_chunk_ids=req.graph_chunk_ids,
        graph_version=req.graph_version,
    )
