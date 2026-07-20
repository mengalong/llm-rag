import { useEffect, useState, useCallback } from 'react'
import ChatInterface from './components/ChatInterface'
import GraphViewer from './components/GraphViewer'
import SessionList from './components/SessionList'
import DocumentsPage from './components/DocumentsPage'
import { useDocuments } from './hooks/useDocuments'
import { getGraph, getSubgraph, type GraphData, type ChunkSettings } from './api/client'
import {
  loadSessions, saveSessions, createSession,
  type ChatSession,
} from './api/sessions'
import './App.css'

type Tab = 'chat' | 'docs' | 'graph'

export default function App() {
  const { docs, refresh, upload, uploading, uploadProgress, error: docError } = useDocuments()
  const [activeTab, setActiveTab] = useState<Tab>('chat')

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = loadSessions()
    return saved.length > 0 ? saved : [createSession()]
  })
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0].id)
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0]

  const persistSessions = useCallback((updated: ChatSession[]) => {
    setSessions(updated)
    saveSessions(updated)
  }, [])

  const handleSessionUpdate = useCallback((updated: ChatSession) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === updated.id ? updated : s)
      saveSessions(next)
      return next
    })
  }, [])

  const handleNewSession = useCallback(() => {
    const s = createSession()
    persistSessions([...sessions, s])
    setActiveSessionId(s.id)
  }, [sessions, persistSessions])

  const handleDeleteSession = useCallback((id: string) => {
    const remaining = sessions.filter((s) => s.id !== id)
    if (remaining.length === 0) {
      const s = createSession()
      persistSessions([s])
      setActiveSessionId(s.id)
    } else {
      persistSessions(remaining)
      if (activeSessionId === id) setActiveSessionId(remaining[remaining.length - 1].id)
    }
  }, [sessions, activeSessionId, persistSessions])

  // Graph
  const [fullGraphData, setFullGraphData] = useState<GraphData | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    if (activeTab === 'graph') {
      getGraph().then((r) => { setFullGraphData(r.data); setGraphData(r.data) }).catch(console.error)
    }
  }, [activeTab])

  const handleNodeClick = async (_nodeId: string, label: string) => {
    try {
      const res = await getSubgraph(label, 2)
      setGraphData(res.data)
    } catch { /* node not in graph */ }
  }

  const showSessionSidebar = activeTab === 'chat'

  return (
    <div className="app">
      {showSessionSidebar ? (
        <SessionList
          sessions={sessions}
          activeId={activeSessionId}
          onSelect={setActiveSessionId}
          onNew={handleNewSession}
          onDelete={handleDeleteSession}
        />
      ) : (
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="logo">Local RAG</div>
          </div>
          <div className="sidebar-docs" style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>导航</div>
            {(['chat', 'docs', 'graph'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={activeTab === t ? 'tab active' : 'tab'}
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 2, borderRadius: 6, padding: '7px 10px' }}
              >
                {t === 'chat' ? '💬 对话' : t === 'docs' ? '📁 文件管理' : '🕸 知识图谱'}
              </button>
            ))}
          </div>
        </aside>
      )}

      <main className="main">
        <div className="topbar">
          <button className={activeTab === 'chat' ? 'tab active' : 'tab'} onClick={() => setActiveTab('chat')}>对话</button>
          <button className={activeTab === 'docs' ? 'tab active' : 'tab'} onClick={() => setActiveTab('docs')}>文件管理</button>
          <button className={activeTab === 'graph' ? 'tab active' : 'tab'} onClick={() => setActiveTab('graph')}>知识图谱</button>

          {docError && activeTab !== 'docs' && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--danger)' }}>{docError}</span>
          )}
        </div>

        <div className="content">
          {activeTab === 'chat' && (
            <ChatInterface session={activeSession} onSessionUpdate={handleSessionUpdate} />
          )}
          {activeTab === 'docs' && (
            <DocumentsPage
              docs={docs}
              uploading={uploading}
              uploadProgress={uploadProgress}
              onUpload={(f: File, settings?: ChunkSettings) => { upload(f, settings) }}
              onRefresh={refresh}
            />
          )}
          {activeTab === 'graph' && (
            <GraphViewer
              data={graphData}
              fullData={fullGraphData}
              onNodeClick={handleNodeClick}
              onReset={() => setGraphData(fullGraphData)}
            />
          )}
        </div>
      </main>
    </div>
  )
}
