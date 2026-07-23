"""Kuzu-backed graph store — replaces graph_store.py (NetworkX + GraphML).

Public surface mirrors graph_store.py so callers need minimal changes:
  get_conn()                        → kuzu.Connection for the live graph
  get_graph()                       → nx.Graph (for builders that still write in-memory)
  save_graph(g)                     → persist nx.Graph into Kuzu
  save_snapshot(*, ...)             → copy kuzu dir + write meta.json
  list_snapshots()                  → list[dict] sorted newest-first
  load_snapshot_meta(version)       → dict | None
  load_snapshot_as_current(version) → dict  (meta)
  delete_snapshot(version)          → bool
  diff_snapshots(v1, v2)            → GraphDiff
  to_graph_data(conn?)              → GraphData
  get_subgraph(entity, depth, conn?) → nx.Graph
  get_subgraph_by_document(doc_id, conn?) → nx.Graph
  get_subgraph_by_version(entity, depth, version) → nx.Graph  [NEW]
  get_current_version_from_graph()  → str
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import kuzu
import networkx as nx

from ..config import settings
from ..models.graph import GraphData

logger = logging.getLogger("rag.kuzu_store")

# ── Paths ──────────────────────────────────────────────────────────────────────

def _live_db_path() -> Path:
    """Path to the live Kuzu database FILE (kuzu uses a single file, not a dir)."""
    p = Path(settings.graph_dir)
    p.mkdir(parents=True, exist_ok=True)
    db_file = p / "knowledge_graph.kuzu"
    # Remove any stale directory that may have been created erroneously
    if db_file.exists() and db_file.is_dir():
        import shutil
        shutil.rmtree(str(db_file))
    return db_file

def _snapshots_dir() -> Path:
    p = Path(settings.graph_dir) / "snapshots"
    p.mkdir(parents=True, exist_ok=True)
    return p

# ── Singleton connection ───────────────────────────────────────────────────────

_db: kuzu.Database | None = None
_conn: kuzu.Connection | None = None


def _ensure_schema(conn: kuzu.Connection) -> None:
    """Create node/rel tables if they don't exist yet."""
    try:
        conn.execute(
            "CREATE NODE TABLE IF NOT EXISTS Entity("
            "id STRING PRIMARY KEY, "
            "label STRING, "
            "type STRING, "
            "document_ids STRING, "
            "chunk_ids STRING"
            ")"
        )
    except Exception:
        pass  # table already exists in some kuzu versions
    try:
        conn.execute(
            "CREATE REL TABLE IF NOT EXISTS Relation("
            "FROM Entity TO Entity, "
            "rel_id STRING, "
            "relation STRING, "
            "weight DOUBLE, "
            "chunk_ids STRING"
            ")"
        )
    except Exception:
        pass


def get_conn() -> kuzu.Connection:
    global _db, _conn
    if _conn is None:
        db_path = str(_live_db_path())
        _db = kuzu.Database(db_path)
        _conn = kuzu.Connection(_db)
        _ensure_schema(_conn)
    return _conn


def _reset_conn() -> None:
    global _db, _conn
    _conn = None
    _db = None


def _open_snapshot_conn(kuzu_path: str) -> kuzu.Connection:
    # kuzu_path is a file path (Kuzu uses single files)
    db = kuzu.Database(kuzu_path, read_only=True)
    conn = kuzu.Connection(db)
    return conn

# ── Schema helpers ─────────────────────────────────────────────────────────────

def _init_db(kuzu_path: str) -> kuzu.Connection:
    """Open (or create) a Kuzu DB file at path and ensure schema exists."""
    db = kuzu.Database(kuzu_path)
    conn = kuzu.Connection(db)
    _ensure_schema(conn)
    return conn

# ── nx.Graph ↔ Kuzu conversion ─────────────────────────────────────────────────

def _nx_to_kuzu(g: nx.Graph, conn: kuzu.Connection) -> None:
    """Write a NetworkX graph into an already-initialised Kuzu connection (full replace)."""
    # Clear existing data
    try:
        conn.execute("MATCH (e:Entity) DETACH DELETE e")
    except Exception:
        pass

    if g.number_of_nodes() == 0:
        return

    for nid, data in g.nodes(data=True):
        conn.execute(
            "CREATE (:Entity {id: $id, label: $label, type: $type, "
            "document_ids: $di, chunk_ids: $ci})",
            {
                "id": str(nid),
                "label": str(data.get("label", nid)),
                "type": str(data.get("type", "ENTITY")),
                "di": str(data.get("document_ids", "[]")),
                "ci": str(data.get("chunk_ids", "[]")),
            },
        )

    if g.number_of_edges() == 0:
        return

    for u, v, data in g.edges(data=True):
        conn.execute(
            "MATCH (a:Entity {id: $u}), (b:Entity {id: $v}) "
            "CREATE (a)-[:Relation {rel_id: $rid, relation: $rel, "
            "weight: $w, chunk_ids: $ci}]->(b)",
            {
                "u": str(u), "v": str(v),
                "rid": str(data.get("id", f"{u}_{v}")),
                "rel": str(data.get("relation", "co-occurs")),
                "w": float(data.get("weight", 1.0)),
                "ci": str(data.get("chunk_ids", "[]")),
            },
        )


def _kuzu_to_nx(conn: kuzu.Connection) -> nx.Graph:
    """Read all nodes and edges from a Kuzu connection into a NetworkX graph."""
    g = nx.Graph()

    res = conn.execute("MATCH (e:Entity) RETURN e.id, e.label, e.type, e.document_ids, e.chunk_ids")
    while res.has_next():
        row = res.get_next()
        nid, label, typ, doc_ids, chunk_ids = row
        g.add_node(str(nid), label=label, type=typ,
                   document_ids=doc_ids, chunk_ids=chunk_ids)

    res = conn.execute(
        "MATCH (a:Entity)-[r:Relation]->(b:Entity) "
        "RETURN a.id, b.id, r.rel_id, r.relation, r.weight, r.chunk_ids"
    )
    while res.has_next():
        row = res.get_next()
        u, v, rid, relation, weight, chunk_ids = row
        g.add_edge(str(u), str(v), id=rid, relation=relation,
                   weight=float(weight or 1.0), chunk_ids=chunk_ids)

    return g

# ── Public API ─────────────────────────────────────────────────────────────────

def get_graph() -> nx.Graph:
    """Return a NetworkX copy of the live graph (for builders)."""
    return _kuzu_to_nx(get_conn())


def save_graph(g: nx.Graph) -> None:
    """Persist a NetworkX graph into the live Kuzu DB."""
    _nx_to_kuzu(g, get_conn())
    logger.info("kuzu_store: saved graph (%d nodes, %d edges)",
                g.number_of_nodes(), g.number_of_edges())


# ── Snapshot management ────────────────────────────────────────────────────────

def _next_version() -> str:
    d = _snapshots_dir()
    nums = []
    for f in d.iterdir():
        m = re.match(r"^v(\d+)_", f.name)
        if m:
            nums.append(int(m.group(1)))
    return f"v{max(nums) + 1 if nums else 1}"


def save_snapshot(
    *,
    strategy: str = "",
    skip_llm: bool = False,
    documents: list[str],
    note: str = "",
    ner_model: str = "",
) -> str:
    conn = get_conn()
    version = _next_version()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    stem = f"{version}_{ts}"
    d = _snapshots_dir()
    snap_kuzu = d / f"{stem}.kuzu"

    # Copy live DB file to snapshot (Kuzu uses a single file, not a directory)
    live_path = str(_live_db_path())
    _reset_conn()  # close live connection before copying
    shutil.copy2(live_path, str(snap_kuzu))
    # Re-open live connection
    conn = get_conn()

    # Count from snapshot
    snap_conn = _open_snapshot_conn(str(snap_kuzu))
    res = snap_conn.execute("MATCH (e:Entity) RETURN count(e)")
    node_count = res.get_next()[0] if res.has_next() else 0
    res2 = snap_conn.execute("MATCH ()-[r:Relation]->() RETURN count(r)")
    edge_count = res2.get_next()[0] if res2.has_next() else 0
    res3 = snap_conn.execute(
        "MATCH ()-[r:Relation]->() WHERE r.relation <> 'co-occurs' RETURN count(r)"
    )
    semantic_count = res3.get_next()[0] if res3.has_next() else 0

    meta: dict[str, Any] = {
        "version": version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "strategy": strategy or ("ner_llm(no-llm)" if skip_llm else "ner_llm"),
        "ner_model": ner_model,
        "llm_model": settings.effective_graph_llm_model if not skip_llm else None,
        "llm_base_url": settings.llm_base_url if not skip_llm else None,
        "skip_llm": skip_llm,
        "node_count": node_count,
        "edge_count": edge_count,
        "semantic_edge_count": semantic_count,
        "cooccur_edge_count": edge_count - semantic_count,
        "document_count": len(documents),
        "documents": documents,
        "note": note,
    }
    with open(d / f"{stem}.meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    logger.info("kuzu_store: snapshot saved as %s", version)
    return version


def list_snapshots() -> list[dict[str, Any]]:
    d = _snapshots_dir()
    result = []
    for meta_file in sorted(d.glob("*.meta.json"), reverse=True):
        with open(meta_file, encoding="utf-8") as f:
            result.append(json.load(f))
    return result


def load_snapshot_meta(version: str) -> dict[str, Any] | None:
    d = _snapshots_dir()
    for meta_file in d.glob(f"{version}_*.meta.json"):
        with open(meta_file, encoding="utf-8") as f:
            return json.load(f)
    return None


def load_snapshot_as_current(version: str) -> dict[str, Any]:
    meta = load_snapshot_meta(version)
    if meta is None:
        raise FileNotFoundError(f"Snapshot '{version}' not found")

    d = _snapshots_dir()
    snap_kuzu = next(d.glob(f"{version}_*.kuzu"), None)
    if snap_kuzu is None:
        raise FileNotFoundError(f"Snapshot kuzu dir for '{version}' not found")

    live_path = _live_db_path()
    _reset_conn()
    if live_path.exists():
        live_path.unlink()  # Kuzu is a single file
    shutil.copy2(str(snap_kuzu), str(live_path))
    get_conn()  # re-init connection
    logger.info("kuzu_store: loaded snapshot %s as current", version)
    return meta


def delete_snapshot(version: str) -> bool:
    d = _snapshots_dir()
    deleted = False
    for f in list(d.glob(f"{version}_*")):
        if f.is_dir():
            shutil.rmtree(str(f))
        else:
            f.unlink()
        deleted = True
    return deleted


# ── Graph data queries ─────────────────────────────────────────────────────────

def _conn_to_graph_data(conn: kuzu.Connection) -> GraphData:
    from ..models.graph import GraphNode, GraphEdge, GraphData as GD

    nodes = []
    res = conn.execute("MATCH (e:Entity) RETURN e.id, e.label, e.type, e.document_ids, e.chunk_ids")
    while res.has_next():
        nid, label, typ, doc_ids, chunk_ids = res.get_next()
        try:
            doc_list = json.loads(doc_ids or "[]")
        except Exception:
            doc_list = []
        try:
            chunk_list = json.loads(chunk_ids or "[]")
        except Exception:
            chunk_list = []
        nodes.append(GraphNode(id=str(nid), label=label, type=typ,
                               document_ids=doc_list, chunk_ids=chunk_list))

    edges = []
    res = conn.execute(
        "MATCH (a:Entity)-[r:Relation]->(b:Entity) "
        "RETURN r.rel_id, a.id, b.id, r.relation, r.weight, r.chunk_ids"
    )
    while res.has_next():
        rid, src, tgt, rel, weight, chunk_ids = res.get_next()
        try:
            chunk_list = json.loads(chunk_ids or "[]")
        except Exception:
            chunk_list = []
        edges.append(GraphEdge(id=str(rid), source=str(src), target=str(tgt),
                                relation=rel, weight=float(weight or 1.0),
                                chunk_ids=chunk_list))

    from ..models.graph import GraphStats
    stats = GraphStats(node_count=len(nodes), edge_count=len(edges))
    return GD(nodes=nodes, edges=edges, stats=stats)


def to_graph_data(conn: kuzu.Connection | None = None) -> GraphData:
    return _conn_to_graph_data(conn or get_conn())


def get_subgraph(
    entity_label: str,
    depth: int = 2,
    conn: kuzu.Connection | None = None,
) -> nx.Graph:
    c = conn or get_conn()
    depth = max(1, min(depth, 5))

    # Find matching node ID (exact first, then case-insensitive)
    res = c.execute(
        "MATCH (e:Entity) WHERE e.label = $label RETURN e.id LIMIT 1",
        {"label": entity_label},
    )
    node_id = res.get_next()[0] if res.has_next() else None

    if node_id is None:
        res = c.execute(
            "MATCH (e:Entity) WHERE lower(e.label) = lower($label) RETURN e.id LIMIT 1",
            {"label": entity_label},
        )
        node_id = res.get_next()[0] if res.has_next() else None

    if node_id is None:
        return nx.Graph()

    # Collect all nodes within `depth` hops
    collected_ids: set[str] = {str(node_id)}
    frontier: set[str] = {str(node_id)}
    for _ in range(depth):
        if not frontier:
            break
        placeholders = ", ".join(f"$id{i}" for i in range(len(frontier)))
        params = {f"id{i}": fid for i, fid in enumerate(frontier)}
        res = c.execute(
            f"MATCH (a:Entity)-[r:Relation]-(b:Entity) "
            f"WHERE a.id IN [{placeholders}] RETURN b.id",
            params,
        )
        next_frontier: set[str] = set()
        while res.has_next():
            bid = str(res.get_next()[0])
            if bid not in collected_ids:
                collected_ids.add(bid)
                next_frontier.add(bid)
        frontier = next_frontier

    return _subgraph_from_ids(c, collected_ids)


def get_subgraph_by_document(
    document_id: str,
    conn: kuzu.Connection | None = None,
) -> nx.Graph:
    c = conn or get_conn()
    res = c.execute(
        "MATCH (e:Entity) WHERE e.document_ids CONTAINS $doc_id RETURN e.id",
        {"doc_id": document_id},
    )
    node_ids: set[str] = set()
    while res.has_next():
        node_ids.add(str(res.get_next()[0]))
    if not node_ids:
        return nx.Graph()
    return _subgraph_from_ids(c, node_ids)


def get_subgraph_by_version(
    entity_label: str,
    depth: int,
    version: str,
) -> nx.Graph:
    """Query subgraph from a historical snapshot (read-only)."""
    d = _snapshots_dir()
    snap_kuzu = next(d.glob(f"{version}_*.kuzu"), None)
    if snap_kuzu is None:
        raise FileNotFoundError(f"Snapshot '{version}' not found")
    conn = _open_snapshot_conn(str(snap_kuzu))
    return get_subgraph(entity_label, depth, conn)


def _subgraph_from_ids(conn: kuzu.Connection, node_ids: set[str]) -> nx.Graph:
    """Build nx.Graph for a set of node IDs from a Kuzu connection."""
    g = nx.Graph()
    if not node_ids:
        return g

    placeholders = ", ".join(f"$id{i}" for i in range(len(node_ids)))
    params = {f"id{i}": nid for i, nid in enumerate(node_ids)}

    res = conn.execute(
        f"MATCH (e:Entity) WHERE e.id IN [{placeholders}] "
        "RETURN e.id, e.label, e.type, e.document_ids, e.chunk_ids",
        params,
    )
    while res.has_next():
        nid, label, typ, doc_ids, chunk_ids = res.get_next()
        g.add_node(str(nid), label=label, type=typ,
                   document_ids=doc_ids, chunk_ids=chunk_ids)

    res = conn.execute(
        f"MATCH (a:Entity)-[r:Relation]->(b:Entity) "
        f"WHERE a.id IN [{placeholders}] AND b.id IN [{placeholders}] "
        "RETURN r.rel_id, a.id, b.id, r.relation, r.weight, r.chunk_ids",
        params,
    )
    while res.has_next():
        rid, src, tgt, rel, weight, chunk_ids = res.get_next()
        g.add_edge(str(src), str(tgt), id=rid, relation=rel,
                   weight=float(weight or 1.0), chunk_ids=chunk_ids)

    return g


# ── Version tag ────────────────────────────────────────────────────────────────

def get_current_version_from_graph() -> str:
    """Return the version of the most recent snapshot that matches the live graph."""
    snaps = list_snapshots()
    return snaps[0]["version"] if snaps else "unknown"


def diff_snapshots(v1: str, v2: str) -> dict:
    """Compare two snapshot versions using Kuzu. Returns added/removed/unchanged node lists."""
    from typing import Any

    d = _snapshots_dir()

    def _find_kuzu(version: str):
        return next(d.glob(f"{version}_*.kuzu"), None)

    p1, p2 = _find_kuzu(v1), _find_kuzu(v2)
    if p1 is None or p2 is None:
        missing = v1 if p1 is None else v2
        raise FileNotFoundError(f"Snapshot not found: {missing}")

    c1 = _open_snapshot_conn(str(p1))
    c2 = _open_snapshot_conn(str(p2))

    def _get_nodes(conn: kuzu.Connection) -> dict[str, tuple[str, str]]:
        res = conn.execute("MATCH (e:Entity) RETURN e.label, e.type")
        nodes: dict[str, tuple[str, str]] = {}
        while res.has_next():
            label, typ = res.get_next()
            nodes[label.strip().lower()] = (label, typ)
        return nodes

    nodes1 = _get_nodes(c1)
    nodes2 = _get_nodes(c2)

    labels1, labels2 = set(nodes1), set(nodes2)
    added_labels   = labels2 - labels1
    removed_labels = labels1 - labels2

    return {
        "v1": v1, "v2": v2,
        "added_count":     len(added_labels),
        "removed_count":   len(removed_labels),
        "unchanged_count": len(labels1 & labels2),
        "added_nodes":     [{"label": nodes2[l][0], "type": nodes2[l][1]} for l in sorted(added_labels)],
        "removed_nodes":   [{"label": nodes1[l][0], "type": nodes1[l][1]} for l in sorted(removed_labels)],
        "unchanged_nodes": [{"label": nodes1[l][0], "type": nodes1[l][1]} for l in sorted(labels1 & labels2)],
    }
