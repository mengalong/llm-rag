"""Debug record store — persists query debug sessions to metadata.db."""
from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone

import aiosqlite

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS debug_records (
    id                    TEXT PRIMARY KEY,
    created_at            TEXT NOT NULL,
    question              TEXT NOT NULL,
    top_k                 INTEGER DEFAULT 5,
    graph_version         TEXT DEFAULT '',
    graph_ner_model       TEXT DEFAULT '',
    graph_llm_model       TEXT DEFAULT '',
    graph_skip_llm        INTEGER DEFAULT 0,
    graph_strategy        TEXT DEFAULT '',
    qa_llm_model          TEXT DEFAULT '',
    qa_llm_base_url       TEXT DEFAULT '',
    ner_entities          TEXT DEFAULT '[]',
    fuzzy_entities        TEXT DEFAULT '[]',
    matched_graph_nodes   TEXT DEFAULT '[]',
    graph_paths           TEXT DEFAULT '[]',
    vector_hits           TEXT DEFAULT '[]',
    graph_hits            TEXT DEFAULT '[]',
    answer_with_graph     TEXT DEFAULT '',
    answer_without_graph  TEXT DEFAULT '',
    context_with_graph    TEXT DEFAULT '',
    context_without_graph TEXT DEFAULT '',
    system_prompt         TEXT DEFAULT ''
)
"""

MIGRATE_STMTS: list[str] = []


class DebugRecordStore:
    def __init__(self, db_path: str):
        self._path = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute(CREATE_TABLE)
            for stmt in MIGRATE_STMTS:
                try:
                    await db.execute(stmt)
                except Exception:
                    pass
            await db.commit()

    async def create(self, data: dict) -> str:
        record_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                """INSERT INTO debug_records
                   (id, created_at, question, top_k,
                    graph_version, graph_ner_model, graph_llm_model, graph_skip_llm, graph_strategy,
                    qa_llm_model, qa_llm_base_url,
                    ner_entities, fuzzy_entities, matched_graph_nodes, graph_paths,
                    vector_hits, graph_hits,
                    answer_with_graph, answer_without_graph,
                    context_with_graph, context_without_graph, system_prompt)
                   VALUES (?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?, ?,?, ?,?, ?,?,?)""",
                (
                    record_id, created_at, data.get("question", ""), data.get("top_k", 5),
                    data.get("graph_version", ""), data.get("graph_ner_model", ""),
                    data.get("graph_llm_model", ""), 1 if data.get("graph_skip_llm") else 0,
                    data.get("graph_strategy", ""),
                    data.get("qa_llm_model", ""), data.get("qa_llm_base_url", ""),
                    json.dumps(data.get("ner_entities", []), ensure_ascii=False),
                    json.dumps(data.get("fuzzy_entities", []), ensure_ascii=False),
                    json.dumps(data.get("matched_graph_nodes", []), ensure_ascii=False),
                    json.dumps(data.get("graph_paths", []), ensure_ascii=False),
                    json.dumps(data.get("vector_hits", []), ensure_ascii=False),
                    json.dumps(data.get("graph_hits", []), ensure_ascii=False),
                    data.get("answer_with_graph", ""), data.get("answer_without_graph", ""),
                    data.get("context_with_graph", ""), data.get("context_without_graph", ""),
                    data.get("system_prompt", ""),
                )
            )
            await db.commit()
        return record_id

    async def list_all(self, limit: int = 50) -> list[dict]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM debug_records ORDER BY created_at DESC LIMIT ?", (limit,)
            )
            rows = await cursor.fetchall()
        return [_row_to_dict(dict(row)) for row in rows]

    async def get(self, record_id: str) -> dict | None:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM debug_records WHERE id = ?", (record_id,)
            )
            row = await cursor.fetchone()
        return _row_to_dict(dict(row)) if row else None

    async def delete(self, record_id: str) -> bool:
        async with aiosqlite.connect(self._path) as db:
            cursor = await db.execute(
                "DELETE FROM debug_records WHERE id = ?", (record_id,)
            )
            await db.commit()
            return cursor.rowcount > 0


def _row_to_dict(row: dict) -> dict:
    for key in ("ner_entities", "fuzzy_entities", "matched_graph_nodes",
                "graph_paths", "vector_hits", "graph_hits"):
        if key in row and isinstance(row[key], str):
            try:
                row[key] = json.loads(row[key])
            except Exception:
                row[key] = []
    row["graph_skip_llm"] = bool(row.get("graph_skip_llm", 0))
    return row
