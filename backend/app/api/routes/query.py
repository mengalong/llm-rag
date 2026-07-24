from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio

from ...config import settings
from ...models.query import QueryRequest, QueryResponse, Source, DebugResult, DebugHit, MatchedGraphNode

router = APIRouter()


class TitleRequest(BaseModel):
    question: str
    answer: str


@router.post("/title")
async def generate_title(req: TitleRequest):
    """Generate a concise session title from the first Q&A."""
    import anthropic
    client = anthropic.Anthropic(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
    )
    prompt = (
        f"问题：{req.question[:200]}\n"
        f"回答摘要：{req.answer[:200]}\n\n"
        "请用不超过15个字为上面这段对话生成一个简洁的标题，只返回标题文字，不要标点符号和引号。"
    )
    try:
        msg = client.messages.create(
            model=settings.llm_model,
            max_tokens=32,
            messages=[{"role": "user", "content": prompt}],
        )
        title = msg.content[0].text.strip().strip('"\'「」《》')
        return {"title": title}
    except Exception:
        short = req.question[:20] + ('…' if len(req.question) > 20 else '')
        return {"title": short}


def _do_graph_retrieval(question: str, hits_raw: list, top_k: int):
    """Run NER + fuzzy (merged) graph retrieval."""
    from ...core.vector_store import get_chunks_by_ids
    from ...core.rag_engine import (
        _extract_entities_from_question,
        _fuzzy_match_entities,
        _get_graph_chunks,
    )

    ner_entities = _extract_entities_from_question(question)
    fuzzy_pairs = _fuzzy_match_entities(question)  # list of (label, keyword)
    fuzzy_entities = [label for label, _ in fuzzy_pairs]
    fuzzy_kw_map = {label: kw for label, kw in fuzzy_pairs}

    # Merge NER + fuzzy, NER first, no duplicates
    all_entities = list(dict.fromkeys(ner_entities + fuzzy_entities))

    graph_entities: list[str] = []
    graph_paths = []
    graph_chunk_ids: set[str] = set()
    extra_hits: list[dict] = []

    if all_entities:
        g_chunk_ids, graph_entities, graph_paths = _get_graph_chunks(all_entities)
        if g_chunk_ids:
            existing_ids = {h["chunk_id"] for h in hits_raw}
            from ...core.graph_config import graph_cfg as _gcfg
            extra = get_chunks_by_ids(g_chunk_ids[:_gcfg.graph_chunk_limit])
            for e in extra:
                if e["chunk_id"] not in existing_ids:
                    extra_hits.append(e)
                    graph_chunk_ids.add(e["chunk_id"])

    return ner_entities, fuzzy_entities, fuzzy_kw_map, graph_entities, graph_paths, graph_chunk_ids, extra_hits


@router.post("/", response_model=QueryResponse)
async def query(req: QueryRequest):
    from ...core.embedder import get_embedder
    from ...core.vector_store import search
    from ...core.rag_engine import build_sources_from_hits

    embedder = get_embedder()
    q_emb = embedder.embed_one(req.question)
    hits = search(q_emb, top_k=req.top_k)

    graph_entities: list[str] = []
    graph_paths = []

    if req.use_graph:
        _, _, _, graph_entities, graph_paths, _, extra_hits = _do_graph_retrieval(req.question, hits, req.top_k)
        hits.extend(extra_hits)

    sources = build_sources_from_hits(hits)
    context = _build_context(sources)
    answer = await _call_llm(req.question, context)
    return QueryResponse(
        answer=answer,
        sources=sources,
        graph_entities=graph_entities,
        graph_paths=graph_paths,
    )


@router.get("/stream")
async def query_stream(question: str, top_k: int = 5, use_graph: bool = True):
    from ...core.embedder import get_embedder
    from ...core.vector_store import search
    from ...core.rag_engine import build_sources_from_hits

    embedder = get_embedder()
    q_emb = embedder.embed_one(question)
    hits = search(q_emb, top_k=top_k)

    graph_entities: list[str] = []
    graph_paths = []
    graph_chunk_ids: set[str] = set()

    if use_graph:
        _, _, _, graph_entities, graph_paths, graph_chunk_ids, extra_hits = _do_graph_retrieval(question, hits, top_k)
        hits.extend(extra_hits)

    sources = build_sources_from_hits(hits)
    context = _build_context(sources)

    async def event_stream():
        async for token in _stream_llm(question, context):
            yield f"data: {json.dumps({'token': token})}\n\n"
        done_data = json.dumps({
            "done": True,
            "sources": [s.model_dump() for s in sources],
            "graph_entities": graph_entities,
            "graph_paths": [p.model_dump() for p in graph_paths],
            "graph_chunk_ids": list(graph_chunk_ids),
        })
        yield f"data: {done_data}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class DebugRequest(BaseModel):
    question: str
    top_k: int = 5


@router.get("/debug/stream")
async def debug_query_stream(question: str, top_k: int = 5):
    """SSE stream for debug: emits retrieval info first, then two LLM answers concurrently."""
    from ...core.embedder import get_embedder
    from ...core.vector_store import search
    from ...core.rag_engine import build_sources_from_hits
    from ...core.kuzu_store import get_graph
    from ...core.graph_builder import _node_id

    def _hit_to_debug(h: dict, source: str) -> DebugHit:
        meta = h["metadata"]
        return DebugHit(
            chunk_id=h["chunk_id"],
            filename=meta.get("filename", ""),
            page=meta.get("page") or None,
            chunk_index=meta.get("chunk_index", 0),
            score=round(h["score"], 4),
            source=source,
            heading=meta.get("heading") or None,
            excerpt=h["content"][:300],
        )

    async def event_stream():
        # Step 1: vector search + graph retrieval (fast, emit immediately)
        embedder = get_embedder()
        q_emb = embedder.embed_one(question)
        vector_hits_raw = search(q_emb, top_k=top_k)
        vector_hits = [_hit_to_debug(h, "vector") for h in vector_hits_raw]

        ner_entities, fuzzy_entities, fuzzy_kw_map, graph_entity_labels, graph_paths, _, graph_extra = \
            _do_graph_retrieval(question, vector_hits_raw, top_k)
        graph_hits = [_hit_to_debug(h, "graph") for h in graph_extra]

        g = get_graph()
        all_entities = list(dict.fromkeys(ner_entities + fuzzy_entities))
        matched_nodes: list[MatchedGraphNode] = []
        seen_nids: set[str] = set()
        for ent in all_entities:
            nid = _node_id(ent)
            if not g.has_node(nid):
                for node_id, data in g.nodes(data=True):
                    if ent.lower() in data.get("label", "").lower():
                        nid = node_id
                        break
                else:
                    continue
            if nid not in seen_nids:
                seen_nids.add(nid)
                reason = "ner" if ent in ner_entities else "fuzzy"
                node_label = g.nodes[nid].get("label", ent)
                if reason == "fuzzy":
                    kw = fuzzy_kw_map.get(ent, ent)
                    matched_by = f"{kw} → {node_label}" if kw != node_label else kw
                else:
                    matched_by = ent
                matched_nodes.append(MatchedGraphNode(
                    label=node_label,
                    type=g.nodes[nid].get("type", "ENTITY"),
                    degree=g.degree(nid),
                    match_reason=reason,
                    matched_by=matched_by,
                ))
            parent_label = g.nodes[nid].get("label", ent)
            for nb in list(g.neighbors(nid))[:5]:
                if nb not in seen_nids:
                    seen_nids.add(nb)
                    matched_nodes.append(MatchedGraphNode(
                        label=g.nodes[nb].get("label", nb),
                        type=g.nodes[nb].get("type", "ENTITY"),
                        degree=g.degree(nb),
                        match_reason="graph_neighbor",
                        matched_by=parent_label,
                    ))

        # Emit retrieval info immediately (include contexts for frontend display)
        hits_with = vector_hits_raw + graph_extra
        hits_without = vector_hits_raw
        sources_with = build_sources_from_hits(hits_with)
        sources_without = build_sources_from_hits(hits_without)
        ctx_with = _build_context(sources_with)
        ctx_without = _build_context(sources_without)
        sys_prompt = _build_system_prompt()

        retrieval_event = json.dumps({
            "type": "retrieval",
            "ner_entities": ner_entities,
            "fuzzy_entities": fuzzy_entities,
            "matched_graph_nodes": [n.model_dump() for n in matched_nodes],
            "graph_paths": [p.model_dump() for p in graph_paths],
            "vector_hits": [h.model_dump() for h in vector_hits],
            "graph_hits": [h.model_dump() for h in graph_hits],
            "context_with_graph": ctx_with,
            "context_without_graph": ctx_without,
            "system_prompt": sys_prompt,
        })
        yield f"data: {retrieval_event}\n\n"

        # Step 2: stream LLM answers — if no graph expansion, reuse one call
        same_context = not graph_extra
        import asyncio
        queue_with: asyncio.Queue = asyncio.Queue()
        queue_without: asyncio.Queue = asyncio.Queue()
        answer_with_acc = ""
        answer_without_acc = ""

        async def stream_to_queue(ctx: str, q: asyncio.Queue, label: str):
            async for token in _stream_llm(question, ctx):
                await q.put({"label": label, "token": token})
            await q.put({"label": label, "done": True})

        asyncio.create_task(stream_to_queue(ctx_with, queue_with, "with_graph"))
        if same_context:
            asyncio.create_task(_mirror_queue(queue_with, queue_without))
        else:
            asyncio.create_task(stream_to_queue(ctx_without, queue_without, "without_graph"))

        done_with = False
        done_without = False
        while not (done_with and done_without):
            for q, flag_attr in [(queue_with, "done_with"), (queue_without, "done_without")]:
                try:
                    item = q.get_nowait()
                    if item.get("done"):
                        if flag_attr == "done_with":
                            done_with = True
                        else:
                            done_without = True
                    else:
                        tok = item.get("token", "")
                        lbl = item.get("label", "")
                        if lbl == "with_graph":
                            answer_with_acc += tok
                        else:
                            answer_without_acc += tok
                        yield f"data: {json.dumps({'type': 'token', 'label': lbl, 'token': tok})}\n\n"
                except asyncio.QueueEmpty:
                    pass
            if not (done_with and done_without):
                await asyncio.sleep(0.01)

        # Collect full answers from queues (already drained above via mirror/stream)
        # Save record to DB
        from ...db.debug_store import DebugRecordStore
        from ...core.kuzu_store import list_snapshots
        import os as _os

        # Determine current graph version info
        try:
            from ...core.graph_config import graph_cfg as _gcfg
            from ...core.kuzu_store import get_current_version_from_graph, load_snapshot_meta
            _gversion = get_current_version_from_graph()
            _meta = load_snapshot_meta(_gversion) or {}
            _gner = _meta.get("ner_model", "")
            _gllm = _meta.get("llm_model")
            _gskip = bool(_meta.get("skip_llm", True))
            _gstrat = _gcfg.builder_strategy
        except Exception:
            _gversion, _gner, _gllm, _gskip, _gstrat = "unknown", "", None, True, "ner_llm"

        # Collect accumulated answers
        _ans_with = answer_with_acc
        _ans_without = answer_without_acc

        try:
            store = DebugRecordStore(settings.db_path)
            await store.init()
            record_id = await store.create({
                "question": question,
                "top_k": top_k,
                "graph_version": _gversion,
                "graph_ner_model": _gner,
                "graph_llm_model": _gllm or "",
                "graph_skip_llm": _gskip,
                "graph_strategy": _gstrat,
                "qa_llm_model": settings.llm_model,
                "qa_llm_base_url": settings.llm_base_url,
                "ner_entities": ner_entities,
                "fuzzy_entities": fuzzy_entities,
                "matched_graph_nodes": [n.model_dump() for n in matched_nodes],
                "graph_paths": [p.model_dump() for p in graph_paths],
                "vector_hits": [h.model_dump() for h in vector_hits],
                "graph_hits": [h.model_dump() for h in graph_hits],
                "answer_with_graph": _ans_with,
                "answer_without_graph": _ans_without,
                "context_with_graph": ctx_with,
                "context_without_graph": ctx_without,
                "system_prompt": sys_prompt,
            })
        except Exception:
            record_id = ""

        yield f"data: {json.dumps({'type': 'done', 'record_id': record_id, 'graph_version': _gversion, 'graph_ner_model': _gner, 'graph_llm_model': _gllm, 'graph_strategy': _gstrat, 'qa_llm_model': settings.llm_model})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


async def _mirror_queue(src: asyncio.Queue, dst: asyncio.Queue) -> None:
    """Copy items from src to dst, relabelling tokens to 'without_graph'."""
    while True:
        item = await src.get()
        if item.get("done"):
            await dst.put({"label": "without_graph", "done": True})
            break
        await dst.put({"label": "without_graph", "token": item.get("token", "")})


@router.post("/debug", response_model=DebugResult)
async def debug_query(req: DebugRequest):
    from ...core.embedder import get_embedder
    from ...core.vector_store import search
    from ...core.rag_engine import build_sources_from_hits
    from ...core.kuzu_store import get_graph
    from ...core.graph_builder import _node_id

    def _hit_to_debug(h: dict, source: str) -> DebugHit:
        meta = h["metadata"]
        return DebugHit(
            chunk_id=h["chunk_id"],
            filename=meta.get("filename", ""),
            page=meta.get("page") or None,
            chunk_index=meta.get("chunk_index", 0),
            score=round(h["score"], 4),
            source=source,
            heading=meta.get("heading") or None,
            excerpt=h["content"][:300],
        )

    embedder = get_embedder()
    q_emb = embedder.embed_one(req.question)
    vector_hits_raw = search(q_emb, top_k=req.top_k)
    vector_hits = [_hit_to_debug(h, "vector") for h in vector_hits_raw]

    # Graph retrieval (NER + fuzzy merged)
    ner_entities, fuzzy_entities, fuzzy_kw_map, graph_entity_labels, graph_paths, _, graph_extra = \
        _do_graph_retrieval(req.question, vector_hits_raw, req.top_k)
    graph_hits = [_hit_to_debug(h, "graph") for h in graph_extra]

    # Build matched node details for display
    g = get_graph()
    all_entities = list(dict.fromkeys(ner_entities + fuzzy_entities))
    matched_nodes: list[MatchedGraphNode] = []
    seen_nids: set[str] = set()
    for ent in all_entities:
        nid = _node_id(ent)
        if not g.has_node(nid):
            for node_id, data in g.nodes(data=True):
                if ent.lower() in data.get("label", "").lower():
                    nid = node_id
                    break
            else:
                continue
        if nid not in seen_nids:
            seen_nids.add(nid)
            reason = "ner" if ent in ner_entities else "fuzzy"
            node_label = g.nodes[nid].get("label", ent)
            # For fuzzy: show "keyword → node_label", for NER: show the entity itself
            if reason == "fuzzy":
                kw = fuzzy_kw_map.get(ent, ent)
                matched_by = f"{kw} → {node_label}" if kw != node_label else kw
            else:
                matched_by = ent
            matched_nodes.append(MatchedGraphNode(
                label=node_label,
                type=g.nodes[nid].get("type", "ENTITY"),
                degree=g.degree(nid),
                match_reason=reason,
                matched_by=matched_by,
            ))
        for nb in list(g.neighbors(nid))[:5]:
            if nb not in seen_nids:
                seen_nids.add(nb)
                matched_nodes.append(MatchedGraphNode(
                    label=g.nodes[nb].get("label", nb),
                    type=g.nodes[nb].get("type", "ENTITY"),
                    degree=g.degree(nb),
                    match_reason="graph_neighbor",
                    matched_by="",
                ))

    # Call LLM — if no graph expansion, reuse one call to avoid misleading diff
    hits_with_graph = vector_hits_raw + graph_extra
    hits_without_graph = vector_hits_raw

    sources_with = build_sources_from_hits(hits_with_graph)
    sources_without = build_sources_from_hits(hits_without_graph)
    ctx_with = _build_context(sources_with)
    ctx_without = _build_context(sources_without)
    sys_prompt = _build_system_prompt()

    if not graph_extra:
        # Context identical — one LLM call, reuse result for both columns
        answer_with = await _call_llm(req.question, ctx_with)
        answer_without = answer_with
    else:
        answer_with, answer_without = await asyncio.gather(
            _call_llm(req.question, ctx_with),
            _call_llm(req.question, ctx_without),
        )

    return DebugResult(
        question=req.question,
        ner_entities=ner_entities,
        fuzzy_entities=fuzzy_entities,
        matched_graph_nodes=matched_nodes,
        graph_paths=graph_paths,
        vector_hits=vector_hits,
        graph_hits=graph_hits,
        final_hits=vector_hits + graph_hits,
        answer_with_graph=answer_with,
        answer_without_graph=answer_without,
        context_with_graph=ctx_with,
        context_without_graph=ctx_without,
        system_prompt=sys_prompt,
    )


def _build_context(sources: list[Source]) -> str:
    return "\n\n---\n\n".join(
        f"[{i+1}]\n{s.excerpt}" for i, s in enumerate(sources)
    )


async def _call_llm(question: str, context: str) -> str:
    import anthropic
    client = anthropic.Anthropic(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
    )
    message = client.messages.create(
        model=settings.llm_model,
        max_tokens=settings.llm_max_tokens,
        system=_build_system_prompt(),
        messages=[{"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"}],
    )
    return message.content[0].text


async def _stream_llm(question: str, context: str):
    import anthropic
    client = anthropic.Anthropic(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
    )
    with client.messages.stream(
        model=settings.llm_model,
        max_tokens=settings.llm_max_tokens,
        system=_build_system_prompt(),
        messages=[{"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"}],
    ) as stream:
        for text in stream.text_stream:
            yield text


def _build_system_prompt() -> str:
    return (
        "You are a helpful assistant that answers questions based on the provided context.\n\n"
        "## Output format rules (strictly follow all of them)\n\n"
        "1. Use standard Markdown. Use ## or ### headings to divide content into sections. "
        "Never simulate headings with plain bold text like **Title** on its own line.\n"
        "2. Bold (**text**) is only for core conclusions, key definitions, or critical terms "
        "that appear inline within a sentence — not as standalone header replacements.\n"
        "3. Present parallel items using unordered lists (- item). "
        "Do not write list items as plain sentences separated only by line breaks.\n"
        "4. Any paragraph longer than 300 characters must be split into shorter focused paragraphs. "
        "One paragraph = one idea.\n"
        "5. Leave one blank line between different content sections (heading → content, list → next paragraph, etc.).\n"
        "6. Citation markers [1], [2], etc. must appear immediately after the relevant sentence "
        "on the same line — never on a separate line or at the start of a new paragraph.\n"
        "7. Answer in the same language as the question.\n"
        "8. If the context does not contain enough information, say so honestly.\n"
    )
