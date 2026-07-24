import axios, { type AxiosError } from 'axios'

const api = axios.create({ baseURL: '/api/v1' })

// Request logging
api.interceptors.request.use((config) => {
  console.log(`[API] → ${config.method?.toUpperCase()} ${config.url}`, config.data ?? '')
  return config
})

// Response logging
api.interceptors.response.use(
  (res) => {
    console.log(`[API] ← ${res.status} ${res.config.url}`, res.data)
    return res
  },
  (err: AxiosError) => {
    console.error(`[API] ✗ ${err.config?.url}`, err.response?.status, err.response?.data)
    return Promise.reject(err)
  }
)

export interface Document {
  id: string
  filename: string
  mime_type: string
  created_at: string
  indexed_at: string | null
  chunk_count: number
  status: 'pending' | 'processing' | 'indexed' | 'error'
  progress: number
  progress_step: string
  chunk_size: number
  chunk_overlap: number
  chunk_strategy: string
  error?: string
}

export interface Source {
  chunk_id: string
  document_id: string
  filename: string
  page: number | null
  char_start: number
  char_end: number
  relevance_score: number
  excerpt: string
}

export interface GraphNode {
  id: string
  label: string
  type: string
  document_ids: string[]
  chunk_ids: string[]
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  relation: string
  weight: number
  chunk_ids: string[]
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: { node_count: number; edge_count: number; top_entities: string[] }
}

export interface ChunkItem {
  id: string
  content: string
  chunk_index: number
  page: number | null
  char_start: number
  char_end: number
  heading: string | null
}

export interface ChunkSettings {
  chunkStrategy: 'recursive' | 'sentence' | 'fixed'
  chunkSize: number
  chunkOverlap: number
}

export const uploadDocument = (file: File, chunkSettings?: ChunkSettings, onProgress?: (pct: number) => void) => {
  const form = new FormData()
  form.append('file', file)
  const params = new URLSearchParams()
  if (chunkSettings) {
    params.append('chunk_strategy', chunkSettings.chunkStrategy)
    params.append('chunk_size', String(chunkSettings.chunkSize))
    params.append('chunk_overlap', String(chunkSettings.chunkOverlap))
  }
  console.log(`[Upload] starting: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)
  return api.post<{ id: string; filename: string; status: string }>(
    `/documents/upload?${params}`,
    form,
    {
      onUploadProgress: (e) => {
        const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0
        onProgress?.(pct)
      },
    }
  )
}

export const listDocuments = () => api.get<Document[]>('/documents/')
export const getDocument = (id: string) => api.get<Document>(`/documents/${id}`)
export const getDocumentChunks = (id: string) =>
  api.get<{ chunks: ChunkItem[]; total: number }>(`/documents/${id}/chunks`)
export const deleteDocument = (id: string) => api.delete(`/documents/${id}`)
export interface EntityTypeStat {
  type: string
  label: string
  count: number
  color: string
}

export interface RelationStat {
  relation: string
  count: number
}

export interface GraphOverview {
  node_count: number
  edge_count: number
  document_count: number
  semantic_edge_count: number
  cooccur_edge_count: number
  top_entities: string[]
  entity_type_stats: EntityTypeStat[]
  top_relations: RelationStat[]
}

export interface DebugHit {
  chunk_id: string
  filename: string
  page: number | null
  chunk_index: number
  score: number
  source: 'vector' | 'graph'
  heading: string | null
  excerpt: string
}

export interface MatchedGraphNode {
  label: string
  type: string
  degree: number
  match_reason: 'ner' | 'fuzzy' | 'graph_neighbor'
  matched_by: string
}

export interface DebugResult {
  question: string
  ner_entities: string[]
  fuzzy_entities: string[]
  matched_graph_nodes: MatchedGraphNode[]
  graph_paths: import('../api/sessions').GraphPath[]
  vector_hits: DebugHit[]
  graph_hits: DebugHit[]
  final_hits: DebugHit[]
  answer_with_graph: string
  answer_without_graph: string
  context_with_graph: string
  context_without_graph: string
  system_prompt: string
}

export interface GraphSearchResult {
  ner_entities: string[]
  fuzzy_matches: Array<{ label: string; matched_by: string }>
}

export interface EntityCategoryStats {
  source: 'ner' | 'llm'
  type: string
  label: string
  color: string
  count: number
  examples: string[]
}

export interface GraphEntityCategories {
  ner_nodes: EntityCategoryStats[]
  llm_nodes: EntityCategoryStats[]
  ner_total: number
  llm_total: number
}

export interface EntityDetail {
  label: string
  type: string
  degree: number
  document_ids: string[]
  document_names: string[]
}

export interface EntityTypePageResult {
  total: number
  page: number
  page_size: number
  items: EntityDetail[]
}

export interface GraphSnapshot {
  version: string
  timestamp: string
  strategy: string
  ner_model: string
  llm_model: string | null
  skip_llm: boolean
  node_count: number
  edge_count: number
  semantic_edge_count: number
  cooccur_edge_count?: number
  document_count: number
  documents: string[]
  note: string
}

export interface GraphDiffNode {
  label: string
  type: string
}

export interface GraphDiff {
  v1: string
  v2: string
  added_count: number
  removed_count: number
  unchanged_count: number
  added_nodes: GraphDiffNode[]
  removed_nodes: GraphDiffNode[]
  unchanged_nodes: GraphDiffNode[]
}

export interface DebugRecordSummary {
  id: string
  created_at: string
  question: string
  top_k: number
  graph_version: string
  graph_ner_model: string
  graph_llm_model: string | null
  graph_skip_llm: boolean
  graph_strategy: string
  qa_llm_model: string
  vector_hit_count: number
  graph_hit_count: number
}

export interface DebugRecord extends DebugResult {
  id: string
  created_at: string
  graph_version: string
  graph_ner_model: string
  graph_llm_model: string | null
  graph_skip_llm: boolean
  graph_strategy: string
  qa_llm_model: string
  qa_llm_base_url: string
}

export const getDebugRecords = () =>
  api.get<DebugRecordSummary[]>('/debug/records')
export const getDebugRecord = (id: string) =>
  api.get<DebugRecord>(`/debug/records/${id}`)
export const deleteDebugRecord = (id: string) =>
  api.delete(`/debug/records/${id}`)

export const getGraph = () => api.get<GraphData>('/graph/')
export const getSubgraph = (entity: string, depth = 2) =>
  api.get<GraphData>('/graph/subgraph', { params: { entity, depth } })
export const getGraphByDocument = (docId: string) =>
  api.get<GraphData>(`/graph/document/${docId}`)
export const getGraphOverview = () =>
  api.get<GraphOverview>('/graph/overview')
export const getGraphEntityCategories = () =>
  api.get<GraphEntityCategories>('/graph/entity-categories')
export const getEntitiesByType = (type: string, page: number, pageSize = 50) =>
  api.get<EntityTypePageResult>(`/graph/entity-type/${type}`, { params: { page, page_size: pageSize } })
export const getGraphSnapshots = () =>
  api.get<GraphSnapshot[]>('/graph/snapshots')
export const deleteGraphSnapshot = (version: string) =>
  api.delete(`/graph/snapshots/${version}`)
export const getGraphDiff = (v1: string, v2: string) =>
  api.get<GraphDiff>('/graph/diff', { params: { v1, v2 } })
export const loadGraphSnapshot = (version: string) =>
  api.post(`/graph/load-snapshot/${version}`)
export const graphEventsUrl = () => `/api/v1/graph/events`
export const searchGraphEntities = (keyword: string) =>
  api.get<GraphSearchResult>('/graph/search', { params: { q: keyword } })
export const getSubgraphByVersion = (entity: string, version: string, depth = 2) =>
  api.get<GraphData>('/graph/subgraph-version', { params: { entity, version, depth } })
export const debugQueryStream = (question: string, topK: number) =>
  `/api/v1/query/debug/stream?question=${encodeURIComponent(question)}&top_k=${topK}`

export const debugQuery = (question: string, topK: number) =>
  api.post<DebugResult>('/query/debug', { question, top_k: topK })

// ── Chat session persistence ────────────────────────────────────────────────

export interface BackendSession {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count?: number
}

export interface BackendMessage {
  id: string
  session_id: string
  role: string
  content: string
  created_at: string
  sources: import('./client').Source[]
  graph_entities: string[]
  graph_paths: { entities: string[]; relations: string[] }[]
  graph_chunk_ids: string[]
  graph_version: string
}

export const chatListSessions = () =>
  api.get<BackendSession[]>('/chat/sessions')

export const chatCreateSession = (id: string, title: string, created_at: string) =>
  api.post<BackendSession>('/chat/sessions', { id, title, created_at })

export const chatUpdateTitle = (id: string, title: string) =>
  api.put(`/chat/sessions/${id}/title`, { title })

export const chatDeleteSession = (id: string) =>
  api.delete(`/chat/sessions/${id}`)

export const chatGetMessages = (sessionId: string) =>
  api.get<BackendMessage[]>(`/chat/sessions/${sessionId}/messages`)

export const chatAddMessage = (sessionId: string, msg: {
  role: string
  content: string
  created_at: string
  sources?: object[]
  graph_entities?: string[]
  graph_paths?: object[]
  graph_chunk_ids?: string[]
  graph_version?: string
}) => api.post<BackendMessage>(`/chat/sessions/${sessionId}/messages`, msg)
