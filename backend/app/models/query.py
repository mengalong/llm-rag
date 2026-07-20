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
