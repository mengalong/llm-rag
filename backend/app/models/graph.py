from pydantic import BaseModel


class GraphNode(BaseModel):
    id: str
    label: str
    type: str = "ENTITY"
    document_ids: list[str] = []
    chunk_ids: list[str] = []


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    relation: str = "co-occurs"
    weight: float = 1.0
    chunk_ids: list[str] = []


class GraphStats(BaseModel):
    node_count: int
    edge_count: int
    top_entities: list[str] = []


class GraphData(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: GraphStats
