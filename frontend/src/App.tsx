import { useEffect, useState, useCallback } from 'react'
import ChatInterface from './components/ChatInterface'
import GraphViewer from './components/GraphViewer'
import SessionList from './components/SessionList'
import DocumentsPage from './components/DocumentsPage'
import DebugPage from './components/DebugPage'
import { useDocuments } from './hooks/useDocuments'
import { type ChunkSettings } from './api/client'
import {
  loadSessions, saveSessions, createSession,
  loadActiveSessionId, saveActiveSessionId,
  type ChatSession,
} from './api/sessions'
import './App.css'

type Tab = 'chat' | 'docs' | 'graph' | 'debug'
type Theme = 'dark' | 'light'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme') as Theme | null
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => t === 'dark' ? 'light' : 'dark'), [])
  return [theme, toggle]
}

export default function App() {
  const { docs, refresh, upload, uploading, uploadProgress, error: docError } = useDocuments()
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [theme, toggleTheme] = useTheme()

  // Sessions — restore last active session on load
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = loadSessions()
    return saved.length > 0 ? saved : [createSession()]
  })
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const saved = loadSessions()
    if (saved.length === 0) return createSession().id
    const lastId = loadActiveSessionId()
    // pick the most recent session by default, fall back to saved id if it still exists
    const mostRecent = saved[saved.length - 1].id
    return (lastId && saved.some((s) => s.id === lastId)) ? lastId : mostRecent
  })
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0]

  const persistSessions = useCallback((updated: ChatSession[]) => {
    setSessions(updated)
    saveSessions(updated)
  }, [])

  const handleSessionSelect = useCallback((id: string) => {
    setActiveSessionId(id)
    saveActiveSessionId(id)
  }, [])

  const handleSessionUpdate = useCallback((updated: ChatSession) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === updated.id ? updated : s)
      saveSessions(next)
      return next
    })
  }, [])

  const handleSessionTitleUpdate = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, title } : s)
      saveSessions(next)
      return next
    })
  }, [])

  const handleNewSession = useCallback(() => {
    const s = createSession()
    persistSessions([...sessions, s])
    handleSessionSelect(s.id)
  }, [sessions, persistSessions, handleSessionSelect])

  const handleDeleteSession = useCallback((id: string) => {
    const remaining = sessions.filter((s) => s.id !== id)
    if (remaining.length === 0) {
      const s = createSession()
      persistSessions([s])
      handleSessionSelect(s.id)
    } else {
      persistSessions(remaining)
      if (activeSessionId === id) {
        const next = remaining[remaining.length - 1].id
        handleSessionSelect(next)
      }
    }
  }, [sessions, activeSessionId, persistSessions, handleSessionSelect])

  useEffect(() => { refresh() }, [])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const showSessionSidebar = activeTab === 'chat'

  return (
    <div className="app">
      <div className={`sidebarWrap ${sidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
        {/* Collapse toggle button */}
        <button
          className="sidebarToggle"
          onClick={() => setSidebarCollapsed(v => !v)}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </button>

        {!sidebarCollapsed && (showSessionSidebar ? (
          <SessionList
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={handleSessionSelect}
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        ) : (
          <aside className="sidebar">
            <div className="sidebar-top">
              <div className="logo">Local RAG</div>
            </div>
            <div className="sidebar-docs" style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>导航</div>
              {(['chat', 'docs', 'graph', 'debug'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={activeTab === t ? 'tab active' : 'tab'}
                  style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 2, borderRadius: 6, padding: '7px 10px' }}
                >
                  {t === 'chat' ? '💬 对话' : t === 'docs' ? '📁 文件管理' : t === 'graph' ? '🕸 知识图谱' : '🔍 检索调试'}
                </button>
              ))}
            </div>
          </aside>
        ))}
      </div>

      <main className="main">
        <div className="topbar">
          <button className={activeTab === 'chat' ? 'tab active' : 'tab'} onClick={() => setActiveTab('chat')}>对话</button>
          <button className={activeTab === 'docs' ? 'tab active' : 'tab'} onClick={() => setActiveTab('docs')}>文件管理</button>
          <button className={activeTab === 'graph' ? 'tab active' : 'tab'} onClick={() => setActiveTab('graph')}>知识图谱</button>
          <button className={activeTab === 'debug' ? 'tab active' : 'tab'} onClick={() => setActiveTab('debug')}>检索调试</button>

          {docError && activeTab !== 'docs' && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--danger)' }}>{docError}</span>
          )}
        </div>

        <div className="content">
          <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <ChatInterface session={activeSession} onSessionUpdate={handleSessionUpdate} onSessionTitleUpdate={handleSessionTitleUpdate} />
          </div>
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
            <GraphViewer docs={docs} />
          )}
          {activeTab === 'debug' && (
            <DebugPage />
          )}
        </div>
      </main>
    </div>
  )
}
