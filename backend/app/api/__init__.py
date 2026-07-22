from fastapi import APIRouter
from .routes.documents import router as documents_router
from .routes.query import router as query_router
from .routes.graph import router as graph_router
from .routes.health import router as health_router
from .routes.debug import router as debug_router

api_router = APIRouter()
api_router.include_router(documents_router, prefix="/documents", tags=["documents"])
api_router.include_router(query_router, prefix="/query", tags=["query"])
api_router.include_router(graph_router, prefix="/graph", tags=["graph"])
api_router.include_router(debug_router, prefix="/debug", tags=["debug"])
api_router.include_router(health_router, tags=["health"])
