from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

from ...config import settings
from ...models.query import QueryRequest, QueryResponse, Source

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



@router.post("/", response_model=QueryResponse)
async def query(req: QueryRequest):
    from ...core.embedder import get_embedder
    from ...core.vector_store import search
    from ...core.rag_engine import (
        _extract_entities_from_question,
        _get_graph_chunks,
        build_sources_from_hits,
    )

    embedder = get_embedder()
    q_emb = embedder.embed_one(req.question)
    hits = search(q_emb, top_k=req.top_k)

    graph_entities: list[str] = []
    graph_paths = []

    if req.use_graph:
        entities = _extract_entities_from_question(req.question)
        if entities:
            graph_chunk_ids, graph_entities, graph_paths = _get_graph_chunks(entities)
            if graph_chunk_ids:
                extra_hits = search(q_emb, top_k=req.top_k, where={"$or": [
                    {"document_id": {"$ne": ""}}  # fetch all, we filter by chunk_id below
                ]}) if False else []
                # Simpler: fetch by chunk IDs directly from ChromaDB
                from ...core.vector_store import get_chunks_by_ids
                extra = get_chunks_by_ids(graph_chunk_ids[:10])
                existing_ids = {h["chunk_id"] for h in hits}
                for e in extra:
                    if e["chunk_id"] not in existing_ids:
                        hits.append(e)
                        existing_ids.add(e["chunk_id"])

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
    from ...core.vector_store import search, get_chunks_by_ids
    from ...core.rag_engine import (
        _extract_entities_from_question,
        _get_graph_chunks,
        build_sources_from_hits,
    )

    embedder = get_embedder()
    q_emb = embedder.embed_one(question)
    hits = search(q_emb, top_k=top_k)

    graph_entities: list[str] = []
    graph_paths = []

    if use_graph:
        entities = _extract_entities_from_question(question)
        if entities:
            graph_chunk_ids, graph_entities, graph_paths = _get_graph_chunks(entities)
            if graph_chunk_ids:
                extra = get_chunks_by_ids(graph_chunk_ids[:10])
                existing_ids = {h["chunk_id"] for h in hits}
                for e in extra:
                    if e["chunk_id"] not in existing_ids:
                        hits.append(e)

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
        })
        yield f"data: {done_data}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _build_context(sources: list[Source]) -> str:
    return "\n\n---\n\n".join(
        f"[Source: {s.chunk_id}]\n{s.excerpt}" for s in sources
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
        "You are a helpful assistant that answers questions based on the provided context. "
        "When you use information from a specific source, cite it using the format [Source: <chunk_id>]. "
        "Answer in the same language as the question. "
        "If the context does not contain enough information to answer the question, say so honestly."
    )
