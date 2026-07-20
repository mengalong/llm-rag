from typing import Literal
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Backend directory is the parent of this file's package
_BACKEND_DIR = Path(__file__).parent.parent.resolve()


class Settings(BaseSettings):
    # LLM
    llm_api_key: str = ""
    llm_base_url: str = "https://api.anthropic.com"
    llm_model: str = "claude-sonnet-4-6"
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.1

    # Embedding
    embedding_backend: Literal["local", "ollama", "api"] = "local"
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"
    embedding_api_key: str = ""
    embedding_base_url: str = ""
    embedding_dim: int = 384

    # Knowledge graph LLM (fallback to llm_* if empty)
    graph_llm_model: str = ""
    graph_llm_api_key: str = ""

    # Chunking
    chunk_size: int = 2000
    chunk_overlap: int = 256

    # RAG
    rag_top_k: int = 5

    # Data paths — always absolute, anchored to backend/
    upload_dir: str = str(_BACKEND_DIR / "data" / "uploads")
    chroma_dir: str = str(_BACKEND_DIR / "data" / "chroma")
    graph_dir: str = str(_BACKEND_DIR / "data" / "graphs")
    db_path: str = str(_BACKEND_DIR / "data" / "metadata.db")

    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def effective_graph_llm_model(self) -> str:
        return self.graph_llm_model or self.llm_model

    @property
    def effective_graph_llm_api_key(self) -> str:
        return self.graph_llm_api_key or self.llm_api_key


settings = Settings()
