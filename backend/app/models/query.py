from pydantic import BaseModel


class QueryRequest(BaseModel):
    question: str
    top_k: int = 5
    use_graph: bool = True
    stream: bool = True


class Source(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    page: int | None = None
    char_start: int
    char_end: int
    relevance_score: float
    excerpt: str


class GraphPath(BaseModel):
    entities: list[str]
    relations: list[str]


class QueryResponse(BaseModel):
    answer: str
    sources: list[Source] = []
    graph_entities: list[str] = []
    graph_paths: list[GraphPath] = []


class DebugHit(BaseModel):
    chunk_id: str
    filename: str
    page: int | None
    chunk_index: int
    score: float
    source: str          # "vector" | "graph"
    heading: str | None
    excerpt: str


class MatchedGraphNode(BaseModel):
    label: str
    type: str
    degree: int
    match_reason: str    # "ner" | "fuzzy" | "graph_neighbor"
    matched_by: str = ""  # which keyword/entity triggered this match


class DebugResult(BaseModel):
    question: str
    ner_entities: list[str]
    fuzzy_entities: list[str]
    matched_graph_nodes: list[MatchedGraphNode]
    graph_paths: list[GraphPath]
    vector_hits: list[DebugHit]
    graph_hits: list[DebugHit]
    final_hits: list[DebugHit]
    answer_with_graph: str
    answer_without_graph: str
    context_with_graph: str = ""
    context_without_graph: str = ""
    system_prompt: str = ""
