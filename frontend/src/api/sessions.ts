export interface GraphPath {
  entities: string[]
  relations: string[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: import('./client').Source[]
  graphEntities?: string[]
  graphPaths?: GraphPath[]
  graphChunkIds?: string[]
  graphVersion?: string  // version of the graph used for retrieval
  createdAt?: number     // epoch ms
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  messages: ChatMessage[]
  backendSynced?: boolean  // true once session exists in backend
}

const STORAGE_KEY = 'rag_chat_sessions'
const ACTIVE_SESSION_KEY = 'rag_active_session'

export function loadSessions(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export function loadActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_KEY)
}

export function saveActiveSessionId(id: string): void {
  localStorage.setItem(ACTIVE_SESSION_KEY, id)
}

export function createSession(): ChatSession {
  return { id: crypto.randomUUID(), title: '新对话', createdAt: Date.now(), messages: [] }
}

/** Generate a concise session title from the first Q&A pair via the backend. */
export async function generateSessionTitle(question: string, answer: string): Promise<string> {
  try {
    const res = await fetch('/api/v1/query/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer }),
    })
    if (!res.ok) throw new Error('title api failed')
    const data = await res.json()
    return data.title ?? fallbackTitle(question)
  } catch {
    return fallbackTitle(question)
  }
}

/** Convert backend ISO timestamp to epoch ms */
export function isoToMs(iso: string): number {
  return new Date(iso).getTime()
}

/** Convert epoch ms to ISO string for backend */
export function msToIso(ms: number): string {
  return new Date(ms).toISOString()
}
