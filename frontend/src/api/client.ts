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
export const getGraph = () => api.get<GraphData>('/graph/')
export const getSubgraph = (entity: string, depth = 2) =>
  api.get<GraphData>('/graph/subgraph', { params: { entity, depth } })
