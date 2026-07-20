from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class ChunkMetadata(BaseModel):
    document_id: str
    filename: str
    page: int | None = None
    char_start: int = 0
    char_end: int = 0
    chunk_index: int = 0
    heading: str | None = None


class Chunk(BaseModel):
    id: str
    document_id: str
    content: str
    metadata: ChunkMetadata


class Document(BaseModel):
    id: str
    filename: str
    mime_type: str
    file_path: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    indexed_at: datetime | None = None
    chunk_count: int = 0
    status: Literal["pending", "processing", "indexed", "error"] = "pending"
    progress: int = 0
    progress_step: str = ""
    error: str | None = None
    chunk_size: int = 2000
    chunk_overlap: int = 256
    chunk_strategy: str = "recursive"
