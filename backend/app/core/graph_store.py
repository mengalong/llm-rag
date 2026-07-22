from __future__ import annotations
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import networkx as nx

from ..config import settings
from ..models.graph import GraphNode, GraphEdge, GraphData, GraphStats


_graph: nx.Graph | None = None


def _graph_path() -> str:
    os.makedirs(settings.graph_dir, exist_ok=True)
    return os.path.join(settings.graph_dir, "knowledge_graph.graphml")


def _snapshots_dir() -> Path:
    p = Path(settings.graph_dir) / "snapshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_graph() -> nx.Graph:
    global _graph
    if _graph is None:
        path = _graph_path()
        if os.path.exists(path):
            _graph = nx.read_graphml(path)
        else:
            _graph = nx.Graph()
    return _graph


def save_graph() -> None:
    global _graph
    if _graph is not None:
        nx.write_graphml(_graph, _graph_path())


def _set_graph_version(g: nx.Graph, version: str) -> None:
    """Embed version tag into graph-level attributes."""
    g.graph["current_version"] = version
    g.graph["version_updated_at"] = datetime.now(timezone.utc).isoformat()


def get_current_version_from_graph() -> str:
    """Read the version tag embedded in the in-memory graph."""
    return get_graph().graph.get("current_version", "unknown")


def load_snapshot_as_current(version: str) -> dict[str, Any]:
    """Replace knowledge_graph.graphml with the given snapshot and reload memory."""
    global _graph
    d = _snapshots_dir()
    snap_files = list(d.glob(f"{version}_*.graphml"))
    if not snap_files:
        raise FileNotFoundError(f"Snapshot graphml not found for version: {version}")

    snap_path = snap_files[0]
    g = nx.read_graphml(str(snap_path))
    _set_graph_version(g, version)
    _graph = g
    nx.write_graphml(_graph, _graph_path())
    return load_snapshot_meta(version) or {}


# ── Snapshot helpers ────────────────────────────────────────────────────────

def _next_version() -> str:
    """Return the next vN version string by scanning existing snapshots."""
    d = _snapshots_dir()
    existing = [int(m.group(1)) for f in d.iterdir()
                if (m := re.match(r'^v(\d+)_', f.name))]
    return f"v{max(existing) + 1 if existing else 1}"


def save_snapshot(
    *,
    skip_llm: bool,
    documents: list[str],
    note: str = "",
    ner_model: str = "zh_core_web_sm",
) -> str:
    """Copy current graph + write .meta.json. Returns the version string."""
    g = get_graph()
    version = _next_version()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    stem = f"{version}_{ts}"
    d = _snapshots_dir()

    graphml_src = _graph_path()
    graphml_dst = d / f"{stem}.graphml"
    if os.path.exists(graphml_src):
        shutil.copy2(graphml_src, graphml_dst)

    # Embed version tag into both the snapshot graphml and the live graphml
    _set_graph_version(g, version)
    nx.write_graphml(g, graphml_dst)   # snapshot with version tag
    nx.write_graphml(g, graphml_src)   # live file updated too

    # count semantic edges
    semantic = sum(
        1 for _, _, data in g.edges(data=True)
        if data.get("relation", "co-occurs") != "co-occurs"
    )
    cooccur = g.number_of_edges() - semantic

    meta: dict[str, Any] = {
        "version": version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ner_model": ner_model,
        "llm_model": settings.effective_graph_llm_model if not skip_llm else None,
        "llm_base_url": settings.llm_base_url if not skip_llm else None,
        "skip_llm": skip_llm,
        "node_count": g.number_of_nodes(),
        "edge_count": g.number_of_edges(),
        "semantic_edge_count": semantic,
        "cooccur_edge_count": cooccur,
        "document_count": len(documents),
        "documents": documents,
        "note": note,
    }
    with open(d / f"{stem}.meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return version


def list_snapshots() -> list[dict[str, Any]]:
    """Return all snapshot meta objects sorted newest-first."""
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


def _extract_nodes_from_graphml(path: Path) -> dict[str, str]:
    """Fast XML parse: returns {label_lower: original_label} for diff comparison."""
    import xml.etree.ElementTree as ET
    if not path.exists():
        return {}
    tree = ET.parse(path)
    root = tree.getroot()
    ns = root.tag.split("}")[0].lstrip("{") if "}" in root.tag else ""
    prefix = f"{{{ns}}}" if ns else ""

    label_key = type_key = None
    for key in root.iter(f"{prefix}key"):
        if key.attrib.get("attr.name") == "label":
            label_key = key.attrib.get("id")
        if key.attrib.get("attr.name") == "type":
            type_key = key.attrib.get("id")

    # {label_lower: (original_label, type)}
    nodes: dict[str, tuple[str, str]] = {}
    for node in root.iter(f"{prefix}node"):
        orig_label = entity_type = ""
        for data in node.iter(f"{prefix}data"):
            k = data.attrib.get("key", "")
            if k == label_key:
                orig_label = (data.text or "").strip()
            elif k == type_key:
                entity_type = (data.text or "").strip()
        if orig_label:
            nodes[orig_label.lower()] = (orig_label, entity_type)
    return nodes


def diff_snapshots(v1: str, v2: str) -> dict[str, Any]:
    """Compare two snapshot versions. Returns added/removed node lists."""
    d = _snapshots_dir()

    def _find_graphml(version: str) -> Path | None:
        for f in d.glob(f"{version}_*.graphml"):
            return f
        return None

    p1, p2 = _find_graphml(v1), _find_graphml(v2)
    if p1 is None or p2 is None:
        missing = v1 if p1 is None else v2
        raise FileNotFoundError(f"Snapshot not found: {missing}")

    nodes1 = _extract_nodes_from_graphml(p1)
    nodes2 = _extract_nodes_from_graphml(p2)

    labels1, labels2 = set(nodes1), set(nodes2)
    added_labels   = labels2 - labels1
    removed_labels = labels1 - labels2

    return {
        "v1": v1,
        "v2": v2,
        "added_count": len(added_labels),
        "removed_count": len(removed_labels),
        "unchanged_count": len(labels1 & labels2),
        "added_nodes":     [{"label": nodes2[l][0], "type": nodes2[l][1]} for l in sorted(added_labels)],
        "removed_nodes":   [{"label": nodes1[l][0], "type": nodes1[l][1]} for l in sorted(removed_labels)],
        "unchanged_nodes": [{"label": nodes1[l][0], "type": nodes1[l][1]} for l in sorted(labels1 & labels2)],
    }


def delete_snapshot(version: str) -> bool:
    d = _snapshots_dir()
    deleted = False
    for f in list(d.glob(f"{version}_*")):
        f.unlink()
        deleted = True
    return deleted



def to_graph_data(subgraph: nx.Graph | None = None) -> GraphData:
    g = subgraph or get_graph()
    nodes = []
    for node_id, data in g.nodes(data=True):
        nodes.append(GraphNode(
            id=node_id,
            label=data.get("label", node_id),
            type=data.get("type", "ENTITY"),
            document_ids=json.loads(data.get("document_ids", "[]")),
            chunk_ids=json.loads(data.get("chunk_ids", "[]")),
        ))

    edges = []
    for u, v, data in g.edges(data=True):
        edges.append(GraphEdge(
            id=data.get("id", f"{u}_{v}"),
            source=u,
            target=v,
            relation=data.get("relation", "co-occurs"),
            weight=float(data.get("weight", 1.0)),
            chunk_ids=json.loads(data.get("chunk_ids", "[]")),
        ))

    top_entities = sorted(
        g.nodes(), key=lambda n: g.degree(n), reverse=True
    )[:10]
    top_labels = [g.nodes[n].get("label", n) for n in top_entities]

    return GraphData(
        nodes=nodes,
        edges=edges,
        stats=GraphStats(
            node_count=g.number_of_nodes(),
            edge_count=g.number_of_edges(),
            top_entities=top_labels,
        ),
    )


def get_subgraph_by_document(document_id: str) -> nx.Graph:
    g = get_graph()
    matching = [
        nid for nid, data in g.nodes(data=True)
        if document_id in json.loads(data.get("document_ids", "[]"))
    ]
    return g.subgraph(matching).copy()


def get_subgraph(entity_label: str, depth: int = 2) -> nx.Graph:
    g = get_graph()
    target_node = None
    for node_id, data in g.nodes(data=True):
        if data.get("label", node_id).lower() == entity_label.lower():
            target_node = node_id
            break
    if target_node is None:
        return nx.Graph()

    nodes = {target_node}
    frontier = {target_node}
    for _ in range(depth):
        next_frontier = set()
        for n in frontier:
            next_frontier.update(g.neighbors(n))
        nodes.update(next_frontier)
        frontier = next_frontier

    return g.subgraph(nodes).copy()

