import { useRef, useState } from 'react'
import { type Source } from '../api/client'

interface SSEState {
  answer: string
  sources: Source[]
  graphEntities: string[]
  loading: boolean
  error: string | null
}

type DoneCallback = (answer: string, sources: Source[], entities: string[]) => void

export function useSSEQuery() {
  const [state, setState] = useState<SSEState>({
    answer: '',
    sources: [],
    graphEntities: [],
    loading: false,
    error: null,
  })
  const esRef = useRef<EventSource | null>(null)
  const answerRef = useRef('')

  const ask = (question: string, useGraph = true, onDone?: DoneCallback) => {
    if (esRef.current) esRef.current.close()
    answerRef.current = ''

    setState({ answer: '', sources: [], graphEntities: [], loading: true, error: null })
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
          console.log('[SSE] done, sources:', finalSources.length)
          es.close()
          // Write the persisted message first, then clear streaming state in the
          // same synchronous call so React batches them into one render — no flash.
          onDone?.(answerRef.current, finalSources, finalEntities)
          setState({ answer: '', sources: [], graphEntities: [], loading: false, error: null })
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
