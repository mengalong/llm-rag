import os
from datetime import datetime
import aiosqlite
from ..models.document import Document


CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    indexed_at TEXT,
    chunk_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    progress_step TEXT DEFAULT '',
    error TEXT,
    chunk_size INTEGER DEFAULT 2000,
    chunk_overlap INTEGER DEFAULT 256,
    chunk_strategy TEXT DEFAULT 'recursive'
)
"""

MIGRATE_STMTS = [
    "ALTER TABLE documents ADD COLUMN progress INTEGER DEFAULT 0",
    "ALTER TABLE documents ADD COLUMN progress_step TEXT DEFAULT ''",
    "ALTER TABLE documents ADD COLUMN indexed_at TEXT",
    "ALTER TABLE documents ADD COLUMN chunk_size INTEGER DEFAULT 2000",
    "ALTER TABLE documents ADD COLUMN chunk_overlap INTEGER DEFAULT 256",
    "ALTER TABLE documents ADD COLUMN chunk_strategy TEXT DEFAULT 'recursive'",
]


class FileStore:
    def __init__(self, db_path: str):
        self.db_path = db_path

    async def init(self) -> None:
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(CREATE_TABLE)
            for stmt in MIGRATE_STMTS:
                try:
                    await db.execute(stmt)
                except Exception:
                    pass
            await db.commit()

    async def create(self, doc: Document) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """INSERT INTO documents
                   (id,filename,mime_type,file_path,created_at,indexed_at,chunk_count,
                    status,progress,progress_step,error,chunk_size,chunk_overlap,chunk_strategy)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (doc.id, doc.filename, doc.mime_type, doc.file_path,
                 doc.created_at.isoformat(),
                 doc.indexed_at.isoformat() if doc.indexed_at else None,
                 doc.chunk_count, doc.status, doc.progress, doc.progress_step, doc.error,
                 doc.chunk_size, doc.chunk_overlap, doc.chunk_strategy),
            )
            await db.commit()

    async def update_status(
        self,
        doc_id: str,
        status: str,
        chunk_count: int = 0,
        progress: int = 0,
        progress_step: str = "",
        error: str | None = None,
        indexed_at: datetime | None = None,
    ) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """UPDATE documents SET
                   status=?, chunk_count=?, progress=?, progress_step=?, error=?, indexed_at=?
                   WHERE id=?""",
                (status, chunk_count, progress, progress_step, error,
                 indexed_at.isoformat() if indexed_at else None,
                 doc_id),
            )
            await db.commit()

    async def get(self, doc_id: str) -> Document | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM documents WHERE id=?", (doc_id,)) as cur:
                row = await cur.fetchone()
                return _row_to_doc(row) if row else None

    async def list_all(self) -> list[Document]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM documents ORDER BY created_at DESC") as cur:
                rows = await cur.fetchall()
                return [_row_to_doc(r) for r in rows]

    async def delete(self, doc_id: str) -> bool:
        async with aiosqlite.connect(self.db_path) as db:
            cur = await db.execute("DELETE FROM documents WHERE id=?", (doc_id,))
            await db.commit()
            return cur.rowcount > 0


def _get(row: aiosqlite.Row, key: str, default=None):
    try:
        return row[key] if row[key] is not None else default
    except Exception:
        return default


def _row_to_doc(row: aiosqlite.Row) -> Document:
    raw_indexed = _get(row, "indexed_at")
    return Document(
        id=row["id"],
        filename=row["filename"],
        mime_type=row["mime_type"],
        file_path=row["file_path"],
        created_at=datetime.fromisoformat(row["created_at"]),
        indexed_at=datetime.fromisoformat(raw_indexed) if raw_indexed else None,
        chunk_count=row["chunk_count"],
        status=row["status"],
        progress=_get(row, "progress", 0),
        progress_step=_get(row, "progress_step", ""),
        error=_get(row, "error"),
        chunk_size=_get(row, "chunk_size", 2000),
        chunk_overlap=_get(row, "chunk_overlap", 256),
        chunk_strategy=_get(row, "chunk_strategy", "recursive"),
    )
