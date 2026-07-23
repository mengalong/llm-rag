from fastapi import APIRouter, HTTPException, Query, Request
import json
import asyncio
from collections import Counter

from ...core.kuzu_store import (
    get_graph, to_graph_data, get_subgraph, get_subgraph_by_document,
    list_snapshots, load_snapshot_meta, diff_snapshots, delete_snapshot,
    get_current_version_from_graph, load_snapshot_as_current,
    get_subgraph_by_version, get_conn,
)
from ...models.graph import GraphData, GraphStats, GraphOverview, EntityTypeStat, RelationStat, GraphEntityCategories, EntityDetail

router = APIRouter()

TYPE_LABEL = {
    'PERSON': '人物', 'ORG': '组织', 'GPE': '地点',
    'PRODUCT': '产品', 'LOC': '位置', 'ENTITY': '实体',
    'WORK_OF_ART': '作品', 'EVENT': '事件', 'FAC': '设施', 'NORP': '群体',
    'CONCEPT': '概念',
}
TYPE_COLOR = {
    'PERSON': '#a78bfa', 'ORG': '#60a5fa', 'GPE': '#34d399',
    'PRODUCT': '#fb923c', 'LOC': '#f472b6', 'ENTITY': '#94a3b8',
    'WORK_OF_ART': '#f9a8d4', 'EVENT': '#fbbf24', 'FAC': '#6ee7b7', 'NORP': '#93c5fd',
    'CONCEPT': '#67e8f9',
}


@router.get("/current-version")
async def current_graph_version():
    """Return current loaded graph version."""
    from ...core.graph_config import graph_cfg

    version = get_current_version_from_graph()
    meta = load_snapshot_meta(version) if version not in ("unknown", "v0") else {}
    conn = get_conn()
    res = conn.execute("MATCH (e:Entity) RETURN count(e)")
    node_count = meta.get("node_count", res.get_next()[0] if res.has_next() else 0)

    return {
        "version": version,
        "node_count": node_count,
        "graph_ner_model": meta.get("ner_model", ""),
        "graph_llm_model": meta.get("llm_model"),
        "graph_skip_llm": meta.get("skip_llm", True),
        "graph_strategy": graph_cfg.builder_strategy,
    }


@router.post("/load-snapshot/{version}")
async def load_snapshot(version: str):
    """Switch the active graph to the given snapshot version."""
    try:
        meta = load_snapshot_as_current(version)
        return {"loaded": version, "node_count": meta.get("node_count", 0)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/events")
async def graph_events(request: Request):
    """SSE endpoint — pushes graph_updated events when the graph file changes."""
    from fastapi.responses import StreamingResponse
    from ...core.graph_watcher import subscribe, unsubscribe

    queue = subscribe()

    async def event_stream():
        try:
            # Send initial ping so the client knows the connection is live
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat
                    yield f"data: {json.dumps({'type': 'ping'})}\n\n"
        finally:
            unsubscribe(queue)

    import asyncio
    from fastapi import Request as _Req
    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/overview", response_model=GraphOverview)
async def graph_overview():
    conn = get_conn()
    from collections import Counter
    import json as _json

    g = get_graph()
    type_counter: Counter = Counter()
    doc_ids: set = set()
    for _, data in g.nodes(data=True):
        t = data.get("type", "ENTITY")
        type_counter[t] += 1
        for did in _json.loads(data.get("document_ids", "[]")):
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


@router.get("/subgraph-version", response_model=GraphData)
async def subgraph_by_version(
    entity: str = Query(...),
    depth: int = Query(2, ge=1, le=5),
    version: str = Query(...),
):
    """Query subgraph from a historical snapshot version."""
    try:
        sub = get_subgraph_by_version(entity, depth, version)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if sub.number_of_nodes() == 0:
        raise HTTPException(status_code=404, detail=f"Entity '{entity}' not found in snapshot '{version}'")
    return to_graph_data(sub)


@router.get("/document/{document_id}", response_model=GraphData)
async def graph_by_document(document_id: str):
    sub = get_subgraph_by_document(document_id)
    return to_graph_data(sub)


@router.get("/entity-categories", response_model=GraphEntityCategories)
async def entity_categories():
    """Return entity nodes grouped by source (NER vs LLM) and type."""
    from ...models.graph import EntityCategoryStats

    g = get_graph()
    NER_TYPES = {'PERSON', 'ORG', 'GPE', 'PRODUCT', 'LOC', 'WORK_OF_ART', 'EVENT', 'FAC', 'NORP'}
    LLM_TYPES = {'ENTITY', 'CONCEPT'}

    ner_groups: dict[str, list[str]] = {}
    llm_labels: list[str] = []

    for _, data in g.nodes(data=True):
        t = data.get('type', 'ENTITY')
        label = data.get('label', '')
        if not label:
            continue
        if t in NER_TYPES:
            ner_groups.setdefault(t, []).append(label)
        else:
            # ENTITY, CONCEPT, and any unknown type → LLM bucket
            llm_labels.append(label)

    ner_nodes = [
        EntityCategoryStats(
            source='ner',
            type=t,
            label=TYPE_LABEL.get(t, t),
            color=TYPE_COLOR.get(t, '#94a3b8'),
            count=len(labels),
            examples=sorted(labels, key=len)[:5],
        )
        for t, labels in sorted(ner_groups.items(), key=lambda x: -len(x[1]))
    ]

    llm_nodes = [EntityCategoryStats(
        source='llm',
        type='ENTITY',
        label='LLM 抽取实体',
        color='#94a3b8',
        count=len(llm_labels),
        examples=llm_labels[:5],
    )] if llm_labels else []

    return GraphEntityCategories(
        ner_nodes=ner_nodes,
        llm_nodes=llm_nodes,
        ner_total=sum(len(v) for v in ner_groups.values()),
        llm_total=len(llm_labels),
    )


@router.get("/entity-type/{entity_type}")
async def entities_by_type(
    entity_type: str,
    page: int = 1,
    page_size: int = 50,
):
    """Return paginated entities of a given type with document info."""
    from ...config import settings
    from ...db.file_store import FileStore

    g = get_graph()
    NER_TYPES = {'PERSON', 'ORG', 'GPE', 'PRODUCT', 'LOC', 'WORK_OF_ART', 'EVENT', 'FAC', 'NORP'}
    LLM_TYPES = {'ENTITY', 'CONCEPT'}

    # "LLM" is a virtual bucket: match all non-NER types (ENTITY, CONCEPT, …)
    if entity_type.upper() == "LLM":
        nodes = [
            (nid, data) for nid, data in g.nodes(data=True)
            if data.get("type", "ENTITY") not in NER_TYPES
        ]
    else:
        target_type = entity_type.upper()
        nodes = [
            (nid, data) for nid, data in g.nodes(data=True)
            if data.get("type", "ENTITY") == target_type
        ]
    # sort by degree desc (most connected first)
    nodes.sort(key=lambda x: g.degree(x[0]), reverse=True)
    total = len(nodes)
    start = (page - 1) * page_size
    page_nodes = nodes[start: start + page_size]

    # build doc_id → filename map
    store = FileStore(settings.db_path)
    await store.init()
    all_docs = await store.list_all()
    doc_map = {d.id: d.filename for d in all_docs}

    items = []
    for nid, data in page_nodes:
        doc_ids = json.loads(data.get("document_ids", "[]"))
        items.append(EntityDetail(
            label=data.get("label", nid),
            type=data.get("type", "ENTITY"),
            degree=g.degree(nid),
            document_ids=doc_ids,
            document_names=[doc_map.get(did, did) for did in doc_ids],
        ))

    return {"total": total, "page": page, "page_size": page_size, "items": [i.model_dump() for i in items]}


# ── Snapshot endpoints ──────────────────────────────────────────────────────

@router.get("/snapshots")
async def get_snapshots():
    return list_snapshots()


@router.get("/snapshots/{version}")
async def get_snapshot(version: str):
    meta = load_snapshot_meta(version)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Snapshot '{version}' not found")
    return meta


@router.delete("/snapshots/{version}")
async def remove_snapshot(version: str):
    ok = delete_snapshot(version)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Snapshot '{version}' not found")
    return {"deleted": version}


@router.get("/diff")
async def graph_diff(v1: str = Query(...), v2: str = Query(...)):
    try:
        return diff_snapshots(v1, v2)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/search")
async def search_entities(q: str = Query(..., min_length=1)):
    """Search graph entities using NER + fuzzy keyword matching.
    Only returns entities that actually exist in the graph.
    """
    from ...core.rag_engine import _extract_entities_from_question, _fuzzy_match_entities
    from ...core.graph_builder import _node_id

    g = get_graph()

    def _exists(label: str) -> bool:
        """Check if label has a node in graph (exact or partial match)."""
        nid = _node_id(label)
        if g.has_node(nid):
            return True
        # partial match fallback (same logic as _get_graph_chunks)
        for _, data in g.nodes(data=True):
            if label.lower() in data.get("label", "").lower():
                return True
        return False

    ner_entities = [e for e in _extract_entities_from_question(q) if _exists(e)]
    fuzzy_pairs = _fuzzy_match_entities(q, max_results=10)
    ner_set = set(ner_entities)
    fuzzy_matches = [
        {"label": label, "matched_by": kw}
        for label, kw in fuzzy_pairs
        if label not in ner_set
    ]
    return {
        "ner_entities": ner_entities,
        "fuzzy_matches": fuzzy_matches,
    }


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
