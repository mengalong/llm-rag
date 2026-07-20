from __future__ import annotations
import logging
from abc import ABC, abstractmethod

import httpx

from ..config import settings

logger = logging.getLogger("rag.embedder")


class BaseEmbedder(ABC):
    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]: ...

    @abstractmethod
    def embed_one(self, text: str) -> list[float]: ...

    @property
    @abstractmethod
    def dim(self) -> int: ...


class LocalEmbedder(BaseEmbedder):
    def __init__(self, model_name: str, dim: int):
        from sentence_transformers import SentenceTransformer
        logger.info("loading local model: %s", model_name)
        self._model = SentenceTransformer(model_name)
        self._dim = dim
        logger.info("local model loaded")

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, convert_to_numpy=True).tolist()

    def embed_one(self, text: str) -> list[float]:
        return self._model.encode([text], convert_to_numpy=True)[0].tolist()

    @property
    def dim(self) -> int:
        return self._dim


class OllamaEmbedder(BaseEmbedder):
    def __init__(self, base_url: str, model_name: str):
        base = base_url.rstrip("/")
        if base.endswith("/api/embeddings"):
            self._url = base
        else:
            self._url = f"{base}/api/embeddings"
        self._model = model_name
        self._dim: int | None = None
        logger.info("OllamaEmbedder url=%s model=%s", self._url, self._model)

    def _call(self, text: str) -> list[float]:
        resp = httpx.post(
            self._url,
            json={"model": self._model, "prompt": text},
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]

    def embed_one(self, text: str) -> list[float]:
        vec = self._call(text)
        if self._dim is None:
            self._dim = len(vec)
            logger.info("Ollama embedding dim detected: %d", self._dim)
        return vec

    def embed(self, texts: list[str]) -> list[list[float]]:
        logger.info("Ollama embed: %d texts", len(texts))
        results = [self.embed_one(t) for t in texts]
        logger.info("Ollama embed: done")
        return results

    @property
    def dim(self) -> int:
        if self._dim is None:
            self.embed_one("warmup")
        return self._dim  # type: ignore[return-value]


_embedder: BaseEmbedder | None = None


def get_embedder() -> BaseEmbedder:
    global _embedder
    if _embedder is None:
        logger.info("initializing embedder backend=%s", settings.embedding_backend)
        if settings.embedding_backend == "local":
            _embedder = LocalEmbedder(settings.embedding_model, settings.embedding_dim)
        elif settings.embedding_backend == "ollama":
            if not settings.embedding_base_url:
                raise ValueError("EMBEDDING_BASE_URL must be set when EMBEDDING_BACKEND=ollama")
            _embedder = OllamaEmbedder(settings.embedding_base_url, settings.embedding_model)
        else:
            raise NotImplementedError(f"Unsupported embedding backend: {settings.embedding_backend}")
    return _embedder
