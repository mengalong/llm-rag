import { useRef, useState } from 'react'
import { type Source } from '../api/client'
import { type GraphPath } from '../api/sessions'

interface SSEState {
  answer: string
  sources: Source[]
  graphEntities: string[]
  graphPaths: GraphPath[]
  loading: boolean
  error: string | null
}

type DoneCallback = (answer: string, sources: Source[], entities: string[], paths: GraphPath[], graphChunkIds: string[], graphVersion: string) => void

export function useSSEQuery() {
  const [state, setState] = useState<SSEState>({
    answer: '',
    sources: [],
    graphEntities: [],
    graphPaths: [],
    loading: false,
    error: null,
  })
  const esRef = useRef<EventSource | null>(null)
  const answerRef = useRef('')

  const ask = (question: string, useGraph = true, onDone?: DoneCallback) => {
    if (esRef.current) esRef.current.close()
    answerRef.current = ''

    setState({ answer: '', sources: [], graphEntities: [], graphPaths: [], loading: true, error: null })
    console.log('[SSE] asking:', question)

    const params = new URLSearchParams({ question, use_graph: String(useGraph) })
    const es = new EventSource(`/api/v1/query/stream?${params}`)
    esRef.current = es

    es.onopen = () => console.log('[SSE] connection opened')

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.done) {
          const finalSources = data.sources ?? []
          const finalEntities = data.graph_entities ?? []
          const finalPaths = data.graph_paths ?? []
          const finalGraphChunkIds = data.graph_chunk_ids ?? []
          const finalGraphVersion = data.graph_version ?? ''
          console.log('[SSE] done, sources:', finalSources.length)
          es.close()
          onDone?.(answerRef.current, finalSources, finalEntities, finalPaths, finalGraphChunkIds, finalGraphVersion)
          setState({ answer: '', sources: [], graphEntities: [], graphPaths: [], loading: false, error: null })
        } else if (data.token) {
          answerRef.current += data.token
          setState((prev) => ({ ...prev, answer: prev.answer + data.token }))
        }
      } catch (e) {
        console.error('[SSE] parse error:', e, 'raw:', event.data)
      }
    }

    es.onerror = (e) => {
      console.error('[SSE] error:', e)
      setState((prev) => ({ ...prev, loading: false, error: '连接错误，请检查后端服务' }))
      es.close()
    }
  }

  const stop = () => {
    esRef.current?.close()
    setState((prev) => ({ ...prev, loading: false }))
  }

  return { ...state, ask, stop }
}
