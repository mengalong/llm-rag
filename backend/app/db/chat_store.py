"""Chat session and message persistence — SQLite via aiosqlite."""
from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from typing import Any

import aiosqlite

_CREATE_SESSIONS = """
CREATE TABLE IF NOT EXISTS chat_sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '新对话',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

_CREATE_MESSAGES = """
CREATE TABLE IF NOT EXISTS chat_messages (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    sources         TEXT NOT NULL DEFAULT '[]',
    graph_entities  TEXT NOT NULL DEFAULT '[]',
    graph_paths     TEXT NOT NULL DEFAULT '[]',
    graph_chunk_ids TEXT NOT NULL DEFAULT '[]',
    graph_version   TEXT NOT NULL DEFAULT ''
)
"""

_CREATE_IDX = "CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, created_at)"


class ChatStore:
    def __init__(self, db_path: str):
        self.db_path = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute("PRAGMA foreign_keys=ON")
            await db.execute(_CREATE_SESSIONS)
            await db.execute(_CREATE_MESSAGES)
            await db.execute(_CREATE_IDX)
            await db.commit()

    # ── Sessions ──────────────────────────────────────────────────────────────

    async def create_session(self, id: str, title: str, created_at: str) -> dict[str, Any]:
        now = created_at or datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys=ON")
            await db.execute(
                "INSERT OR IGNORE INTO chat_sessions(id, title, created_at, updated_at) VALUES (?,?,?,?)",
                (id, title, now, now),
            )
            await db.commit()
        return {"id": id, "title": title, "created_at": now, "updated_at": now}

    async def update_session_title(self, id: str, title: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE chat_sessions SET title=?, updated_at=? WHERE id=?",
                (title, now, id),
            )
            await db.commit()

    async def touch_session(self, id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE chat_sessions SET updated_at=? WHERE id=?",
                (now, id),
            )
            await db.commit()

    async def list_sessions(self) -> list[dict[str, Any]]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                """SELECT s.id, s.title, s.created_at, s.updated_at,
                          COUNT(m.id) as message_count
                   FROM chat_sessions s
                   LEFT JOIN chat_messages m ON m.session_id = s.id
                   GROUP BY s.id ORDER BY s.updated_at DESC"""
            )
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_session(self, id: str) -> dict[str, Any] | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("SELECT * FROM chat_sessions WHERE id=?", (id,))
            row = await cur.fetchone()
            if not row:
                return None
            session = dict(row)
            cur2 = await db.execute(
                "SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at",
                (id,),
            )
            msgs = await cur2.fetchall()
        session["messages"] = [_row_to_message(dict(m)) for m in msgs]
        return session

    async def delete_session(self, id: str) -> bool:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys=ON")
            cur = await db.execute("DELETE FROM chat_sessions WHERE id=?", (id,))
            await db.commit()
        return (cur.rowcount or 0) > 0

    # ── Messages ──────────────────────────────────────────────────────────────

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        created_at: str,
        sources: list = [],
        graph_entities: list = [],
        graph_paths: list = [],
        graph_chunk_ids: list = [],
        graph_version: str = "",
    ) -> dict[str, Any]:
        msg_id = str(uuid.uuid4())
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys=ON")
            await db.execute(
                """INSERT INTO chat_messages
                   (id, session_id, role, content, created_at,
                    sources, graph_entities, graph_paths, graph_chunk_ids, graph_version)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    msg_id, session_id, role, content, created_at,
                    json.dumps(sources, ensure_ascii=False),
                    json.dumps(graph_entities, ensure_ascii=False),
                    json.dumps(graph_paths, ensure_ascii=False),
                    json.dumps(graph_chunk_ids, ensure_ascii=False),
                    graph_version,
                ),
            )
            # Update session updated_at
            now = datetime.now(timezone.utc).isoformat()
            await db.execute(
                "UPDATE chat_sessions SET updated_at=? WHERE id=?", (now, session_id)
            )
            await db.commit()
        return {
            "id": msg_id, "session_id": session_id, "role": role,
            "content": content, "created_at": created_at,
        }

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at",
                (session_id,),
            )
            rows = await cur.fetchall()
        return [_row_to_message(dict(r)) for r in rows]


def _row_to_message(row: dict) -> dict:
    for key in ("sources", "graph_entities", "graph_paths", "graph_chunk_ids"):
        try:
            row[key] = json.loads(row.get(key) or "[]")
        except Exception:
            row[key] = []
    return row
