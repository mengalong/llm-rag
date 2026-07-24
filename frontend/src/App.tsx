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
  msToIso,
  type ChatSession,
} from './api/sessions'
import {
  chatListSessions, chatCreateSession, chatUpdateTitle,
  chatDeleteSession, chatAddMessage, chatGetMessages,
} from './api/client'
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

  // Sessions — load from localStorage (legacy) + backend on mount
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

  // On mount: fetch backend sessions; migrate local-only sessions once if not done yet
  useEffect(() => {
    const MIGRATED_KEY = 'rag_local_migrated'
    const localSessions = loadSessions()
    const alreadyMigrated = !!localStorage.getItem(MIGRATED_KEY)

    chatListSessions().then(async r => {
      const backendSessions = r.data
      const backendIds = new Set(backendSessions.map(b => b.id))

      let finalData = backendSessions

      if (!alreadyMigrated) {
        // One-time migration: push local-only sessions to backend
        const localOnly = localSessions.filter(s => !backendIds.has(s.id))
        for (const s of localOnly) {
          try {
            await chatCreateSession(s.id, s.title, msToIso(s.createdAt))
            for (const msg of s.messages) {
              await chatAddMessage(s.id, {
                role: msg.role,
                content: msg.content,
                created_at: msToIso(msg.createdAt ?? s.createdAt),
                sources: (msg.sources ?? []) as object[],
                graph_entities: msg.graphEntities ?? [],
                graph_paths: (msg.graphPaths ?? []) as object[],
                graph_chunk_ids: msg.graphChunkIds ?? [],
                graph_version: msg.graphVersion ?? '',
              })
            }
          } catch { /* ignore individual failures */ }
        }
        if (localOnly.length > 0) {
          finalData = (await chatListSessions()).data
        }
        localStorage.setItem(MIGRATED_KEY, '1')
      }

      setSessions(prev => {
        const localMap = new Map(prev.map(s => [s.id, s]))
        const merged: ChatSession[] = []
        const finalIds = new Set(finalData.map(b => b.id))
        for (const b of finalData) {
          const local = localMap.get(b.id)
          merged.push({
            id: b.id,
            title: b.title,
            createdAt: new Date(b.created_at).getTime(),
            messages: local?.messages ?? [],
            backendSynced: true,
          })
        }
        for (const s of prev) {
          if (!finalIds.has(s.id)) merged.push(s)
        }
        merged.sort((a, b) => b.createdAt - a.createdAt)
        saveSessions(merged)
        return merged
      })
    }).catch(() => {/* backend unavailable, use localStorage */})
  }, [])

  // When active session changes, load its messages from backend if needed
  useEffect(() => {
    if (!activeSessionId) return
    setSessions(prev => {
      const s = prev.find(x => x.id === activeSessionId)
      if (!s?.backendSynced || s.messages.length > 0) return prev
      // Messages not yet loaded — fetch async
      chatGetMessages(activeSessionId).then(r => {
        const msgs = r.data.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          sources: m.sources ?? [],
          graphEntities: m.graph_entities ?? [],
          graphPaths: m.graph_paths ?? [],
          graphChunkIds: m.graph_chunk_ids ?? [],
          graphVersion: m.graph_version || undefined,
          createdAt: new Date(m.created_at).getTime(),
        }))
        setSessions(p => {
          const next = p.map(x => x.id === activeSessionId ? { ...x, messages: msgs } : x)
          saveSessions(next)
          return next
        })
      }).catch(() => {})
      return prev
    })
  }, [activeSessionId])

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
    chatUpdateTitle(id, title).catch(() => {})
  }, [])
  const handleNewSession = useCallback(() => {
    const s = createSession()
    // Add session to state first (without backendSynced)
    setSessions(prev => { const next = [...prev, s]; saveSessions(next); return next })
    handleSessionSelect(s.id)
    // Create in backend async; when done, mark synced via functional updater
    chatCreateSession(s.id, s.title, msToIso(s.createdAt))
      .then(() => {
        setSessions(prev => {
          const next = prev.map(x => x.id === s.id ? { ...x, backendSynced: true } : x)
          saveSessions(next)
          return next
        })
      })
      .catch(() => {})
  }, [handleSessionSelect])
  const handleDeleteSession = useCallback((id: string) => {
    chatDeleteSession(id).catch(() => {})
    const remaining = sessions.filter(s => s.id !== id)
    if (remaining.length === 0) {
      const s = createSession()
      chatCreateSession(s.id, s.title, msToIso(s.createdAt)).catch(() => {})
      persistSessions([s]); handleSessionSelect(s.id)
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
          {/* Other tabs — keep mounted, hidden when not active, to preserve sidebar state */}
          <div style={{ display: activeTab === 'docs' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <DocumentsPage
              docs={docs}
              uploading={uploading}
              uploadProgress={uploadProgress}
              onUpload={(f, settings) => upload(f, settings)}
              onRefresh={refresh}
              isActive={activeTab === 'docs'}
            />
          </div>
          <div style={{ display: activeTab === 'graph' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <GraphViewer docs={docs} isActive={activeTab === 'graph'} />
          </div>
          <div style={{ display: activeTab === 'debug' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <DebugPage isActive={activeTab === 'debug'} />
          </div>
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
