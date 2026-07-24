"""Graph watcher — monitors knowledge_graph.kuzu for changes and broadcasts events.

Usage: call start_watcher() once during app lifespan.
Subscribers can call subscribe() to get an asyncio.Queue that receives
GraphUpdateEvent dicts whenever the graph is reloaded.
"""
from __future__ import annotations
import asyncio
import logging
import os
from typing import Any

from ..config import settings

logger = logging.getLogger("rag.watcher")

_subscribers: list[asyncio.Queue] = []
_watcher_task: asyncio.Task | None = None
_last_mtime: float = 0.0
_internal_change: bool = False  # set True when load_snapshot/save_snapshot triggers the file change


def mark_internal_change() -> None:
    """Call before any operation that intentionally changes knowledge_graph.kuzu,
    so the watcher doesn't treat it as an external rebuild."""
    global _internal_change
    _internal_change = True


def subscribe() -> asyncio.Queue:
    """Return a new queue that will receive graph update events."""
    q: asyncio.Queue = asyncio.Queue(maxsize=10)
    _subscribers.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _subscribers.remove(q)
    except ValueError:
        pass


async def _broadcast(event: dict[str, Any]) -> None:
    dead = []
    for q in _subscribers:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        unsubscribe(q)


async def _watch_loop() -> None:
    global _last_mtime, _internal_change
    kuzu_file = os.path.join(settings.graph_dir, "knowledge_graph.kuzu")

    while True:
        await asyncio.sleep(_POLL_INTERVAL)
        try:
            if not os.path.exists(kuzu_file):
                continue
            mtime = os.path.getmtime(kuzu_file)
            if mtime != _last_mtime and _last_mtime != 0.0:
                if _internal_change:
                    _internal_change = False
                else:
                    from app.core.kuzu_store import _reset_conn, get_current_version_from_graph
                    import app.core.kuzu_store as _ks
                    _reset_conn()
                    _ks._current_version = None
                    version = get_current_version_from_graph()
                    logger.info("Kuzu graph file changed externally — version=%s", version)
                    await _broadcast({"type": "graph_updated", "version": version})
            _last_mtime = mtime
        except Exception as e:
            logger.warning("Graph watcher error: %s", e)


def start_watcher() -> None:
    global _watcher_task, _last_mtime
    kuzu_file = os.path.join(settings.graph_dir, "knowledge_graph.kuzu")
    if os.path.exists(kuzu_file):
        _last_mtime = os.path.getmtime(kuzu_file)
    _watcher_task = asyncio.create_task(_watch_loop())
    logger.info("Graph file watcher started (poll every %ds)", _POLL_INTERVAL)


def stop_watcher() -> None:
    global _watcher_task
    if _watcher_task:
        _watcher_task.cancel()
        _watcher_task = None
