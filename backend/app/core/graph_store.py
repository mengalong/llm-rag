from __future__ import annotations
import json
import os

import networkx as nx

from ..config import settings
from ..models.graph import GraphNode, GraphEdge, GraphData, GraphStats


_graph: nx.Graph | None = None


def _graph_path() -> str:
    os.makedirs(settings.graph_dir, exist_ok=True)
    return os.path.join(settings.graph_dir, "knowledge_graph.graphml")


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


def get_subgraph(entity_label: str, depth: int = 2) -> nx.Graph:
    g = get_graph()
    # Find node by label
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
