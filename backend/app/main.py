from contextlib import asynccontextmanager
import logging
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .api import api_router
from .config import settings
from .db.file_store import FileStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("rag")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up — upload_dir=%s chroma_dir=%s", settings.upload_dir, settings.chroma_dir)
    logger.info("LLM model=%s base_url=%s", settings.llm_model, settings.llm_base_url)
    logger.info("Embedding backend=%s model=%s", settings.embedding_backend, settings.embedding_model)
    store = FileStore(settings.db_path)
    await store.init()
    from .db.debug_store import DebugRecordStore
    debug_store = DebugRecordStore(settings.db_path)
    await debug_store.init()
    logger.info("Database initialized at %s", settings.db_path)
    from .core.graph_watcher import start_watcher, stop_watcher
    start_watcher()
    yield
    stop_watcher()
    logger.info("Shutting down")


app = FastAPI(title="Local RAG System", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    elapsed = (time.time() - start) * 1000
    logger.info("%s %s → %d  (%.0fms)", request.method, request.url.path, response.status_code, elapsed)
    return response


app.include_router(api_router, prefix="/api/v1")
