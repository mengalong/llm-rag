import { useEffect, useState, useCallback, useRef } from 'react'
import ChatInterface from './components/ChatInterface'
import GraphViewer from './components/GraphViewer'
import SessionList from './components/SessionList'
import DocumentsPage from './components/DocumentsPage'
import DebugPage from './components/DebugPage'
import GraphEntityModal from './components/GraphEntityModal'
import { SidebarProvider, useSidebar } from './context/SidebarContext'
import { useDocuments } from './hooks/useDocuments'
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
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  const toggle = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])
  return [theme, toggle]
}

// ── Inner app (needs SidebarContext) ────────────────────────────────────────
function AppInner() {
  const { docs, refresh, upload, uploading, uploadProgress, error: docError } = useDocuments()
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [theme, toggleTheme] = useTheme()
  const { sidebarContent } = useSidebar()

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = loadSessions()
    return saved.length > 0 ? saved : [createSession()]
  })
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const saved = loadSessions()
    if (saved.length === 0) return createSession().id
    const lastId = loadActiveSessionId()
    const mostRecent = saved[saved.length - 1].id
    return (lastId && saved.some(s => s.id === lastId)) ? lastId : mostRecent
  })
  const activeSession = sessions.find(s => s.id === activeSessionId) ?? sessions[0]

  const persistSessions = useCallback((updated: ChatSession[]) => {
    setSessions(updated); saveSessions(updated)
  }, [])
  const handleSessionSelect = useCallback((id: string) => {
    setActiveSessionId(id); saveActiveSessionId(id)
  }, [])
  const handleSessionUpdate = useCallback((updated: ChatSession) => {
    setSessions(prev => { const next = prev.map(s => s.id === updated.id ? updated : s); saveSessions(next); return next })
  }, [])
  const handleSessionTitleUpdate = useCallback((id: string, title: string) => {
    setSessions(prev => { const next = prev.map(s => s.id === id ? { ...s, title } : s); saveSessions(next); return next })
  }, [])
  const handleNewSession = useCallback(() => {
    const s = createSession(); persistSessions([...sessions, s]); handleSessionSelect(s.id)
  }, [sessions, persistSessions, handleSessionSelect])
  const handleDeleteSession = useCallback((id: string) => {
    const remaining = sessions.filter(s => s.id !== id)
    if (remaining.length === 0) {
      const s = createSession(); persistSessions([s]); handleSessionSelect(s.id)
    } else {
      persistSessions(remaining)
      if (activeSessionId === id) handleSessionSelect(remaining[remaining.length - 1].id)
    }
  }, [sessions, activeSessionId, persistSessions, handleSessionSelect])

  useEffect(() => { refresh() }, [])

  const [sidebarWidth, setSidebarWidth] = useState(286)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const isResizing = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    startX.current = e.clientX
    startW.current = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const delta = ev.clientX - startX.current
      const newW = Math.max(160, Math.min(400, startW.current + delta))
      setSidebarWidth(newW)
    }
    const onUp = () => { isResizing.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  return (
    <div className="app">
      {/* Global sidebar */}
      <aside
        className={`globalSidebar${sidebarCollapsed ? ' collapsed' : ''}`}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        {!sidebarCollapsed && (
          <>
            <div className="globalSidebarHeader">
              <span className="globalSidebarLogo">LLM-RAG</span>
              <button className="themeIconBtn" onClick={toggleTheme} title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}>
                {theme === 'dark' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                )}
              </button>
            </div>
            <div className="globalSidebarCtx">
              {sidebarContent}
            </div>
            {/* Drag resize handle */}
            <div className="sidebarResizeHandle" onMouseDown={onResizeMouseDown} />
          </>
        )}
      </aside>

      {/* Collapse/expand toggle — outside sidebar */}
      <button
        className="sidebarCollapseBtn"
        style={{ left: sidebarCollapsed ? 0 : sidebarWidth - 1 }}
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
      >
        {sidebarCollapsed ? '›' : '‹'}
      </button>

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
          {/* Chat — always mounted for scroll position preservation */}
          <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <ChatInterface
              session={activeSession}
              onSessionUpdate={handleSessionUpdate}
              onSessionTitleUpdate={handleSessionTitleUpdate}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSessionSelect={handleSessionSelect}
              onNewSession={handleNewSession}
              onDeleteSession={handleDeleteSession}
              isActive={activeTab === 'chat'}
            />
          </div>
          {activeTab === 'docs' && (
            <DocumentsPage
              docs={docs}
              uploading={uploading}
              uploadProgress={uploadProgress}
              onUpload={(f, settings) => upload(f, settings)}
              onRefresh={refresh}
            />
          )}
          {activeTab === 'graph' && <GraphViewer docs={docs} />}
          {activeTab === 'debug' && <DebugPage />}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <SidebarProvider>
      <AppInner />
    </SidebarProvider>
  )
}
