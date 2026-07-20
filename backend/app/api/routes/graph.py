from fastapi import APIRouter, HTTPException, Query

from ...core.graph_store import get_graph, to_graph_data, get_subgraph
from ...models.graph import GraphData, GraphStats

router = APIRouter()


@router.get("/", response_model=GraphData)
async def get_full_graph():
    return to_graph_data()


@router.get("/stats", response_model=GraphStats)
async def graph_stats():
    data = to_graph_data()
    return data.stats


@router.get("/subgraph", response_model=GraphData)
async def subgraph(entity: str = Query(...), depth: int = Query(2, ge=1, le=5)):
    sub = get_subgraph(entity, depth)
    if sub.number_of_nodes() == 0:
        raise HTTPException(status_code=404, detail=f"Entity '{entity}' not found in graph")
    return to_graph_data(sub)


@router.get("/node/{node_id}")
async def node_detail(node_id: str):
    g = get_graph()
    if not g.has_node(node_id):
        raise HTTPException(status_code=404, detail="Node not found")
    data = dict(g.nodes[node_id])
    neighbors = list(g.neighbors(node_id))
    return {
        "id": node_id,
        **data,
        "neighbors": neighbors,
        "degree": g.degree(node_id),
    }
