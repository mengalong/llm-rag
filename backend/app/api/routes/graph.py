from fastapi import APIRouter, HTTPException, Query
import json
from collections import Counter

from ...core.graph_store import get_graph, to_graph_data, get_subgraph, get_subgraph_by_document
from ...models.graph import GraphData, GraphStats, GraphOverview, EntityTypeStat, RelationStat

router = APIRouter()

TYPE_LABEL = {
    'PERSON': '人物', 'ORG': '组织', 'GPE': '地点',
    'PRODUCT': '产品', 'LOC': '位置', 'ENTITY': '实体',
    'WORK_OF_ART': '作品', 'EVENT': '事件', 'FAC': '设施', 'NORP': '群体',
}
TYPE_COLOR = {
    'PERSON': '#a78bfa', 'ORG': '#60a5fa', 'GPE': '#34d399',
    'PRODUCT': '#fb923c', 'LOC': '#f472b6', 'ENTITY': '#94a3b8',
    'WORK_OF_ART': '#f9a8d4', 'EVENT': '#fbbf24', 'FAC': '#6ee7b7', 'NORP': '#93c5fd',
}


@router.get("/overview", response_model=GraphOverview)
async def graph_overview():
    g = get_graph()
    type_counter: Counter = Counter()
    doc_ids: set = set()
    for _, data in g.nodes(data=True):
        t = data.get("type", "ENTITY")
        type_counter[t] += 1
        for did in json.loads(data.get("document_ids", "[]")):
            doc_ids.add(did)

    relation_counter: Counter = Counter()
    semantic = 0
    cooccur = 0
    for _, _, data in g.edges(data=True):
        rel = data.get("relation", "co-occurs")
        relation_counter[rel] += 1
        if rel == "co-occurs":
            cooccur += 1
        else:
            semantic += 1

    top_nodes = sorted(g.nodes(), key=lambda n: g.degree(n), reverse=True)[:10]
    top_labels = [g.nodes[n].get("label", n) for n in top_nodes]

    entity_type_stats = [
        EntityTypeStat(
            type=t,
            label=TYPE_LABEL.get(t, t),
            count=c,
            color=TYPE_COLOR.get(t, '#94a3b8'),
        )
        for t, c in type_counter.most_common()
    ]

    top_relations = [
        RelationStat(relation=rel, count=cnt)
        for rel, cnt in relation_counter.most_common(10)
        if rel != "co-occurs"
    ]

    return GraphOverview(
        node_count=g.number_of_nodes(),
        edge_count=g.number_of_edges(),
        document_count=len(doc_ids),
        semantic_edge_count=semantic,
        cooccur_edge_count=cooccur,
        top_entities=top_labels,
        entity_type_stats=entity_type_stats,
        top_relations=top_relations,
    )


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


@router.get("/document/{document_id}", response_model=GraphData)
async def graph_by_document(document_id: str):
    sub = get_subgraph_by_document(document_id)
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
