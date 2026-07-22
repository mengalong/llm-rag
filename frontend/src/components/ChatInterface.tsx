import { useEffect, useRef, useState, useCallback, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSSEQuery } from '../hooks/useSSE'
import SourcePanel from './SourcePanel'
import SessionList from './SessionList'
import GraphEntityModal from './GraphEntityModal'
import { useSidebar } from '../context/SidebarContext'
import { type ChatSession, type GraphPath, generateSessionTitle } from '../api/sessions'
import styles from './ChatInterface.module.css'

function SessionListSidebar({ sessions, activeId, onSelect, onNew, onDelete }: {
  sessions: ChatSession[]; activeId: string
  onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void
}) {
  return <SessionList sessions={sessions} activeId={activeId} onSelect={onSelect} onNew={onNew} onDelete={onDelete} />
}


interface Props {
  session: ChatSession
  onSessionUpdate: (s: ChatSession) => void
  onSessionTitleUpdate: (id: string, title: string) => void
  sessions: ChatSession[]
  activeSessionId: string
  onSessionSelect: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
}

/** Robot avatar for AI messages */
function BotAvatar() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <circle cx="16" cy="16" r="16" fill="#6366f1"/>
      {/* antenna */}
      <line x1="16" y1="4" x2="16" y2="9" stroke="#c7d2fe" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="16" cy="3.5" r="1.5" fill="#c7d2fe"/>
      {/* head box */}
      <rect x="8" y="10" width="16" height="13" rx="3" fill="#fff" fillOpacity="0.15" stroke="#c7d2fe" strokeWidth="1.2"/>
      {/* eyes */}
      <circle cx="12.5" cy="15.5" r="2" fill="#c7d2fe"/>
      <circle cx="19.5" cy="15.5" r="2" fill="#c7d2fe"/>
      <circle cx="12.5" cy="15.5" r="0.8" fill="#6366f1"/>
      <circle cx="19.5" cy="15.5" r="0.8" fill="#6366f1"/>
      {/* mouth */}
      <path d="M13 19.5 Q16 21.5 19 19.5" stroke="#c7d2fe" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      {/* ears */}
      <rect x="5.5" y="14" width="2.5" height="5" rx="1.2" fill="#c7d2fe"/>
      <rect x="24" y="14" width="2.5" height="5" rx="1.2" fill="#c7d2fe"/>
    </svg>
  )
}

/** User avatar — cheerful orange fox character */
function UserAvatar() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <circle cx="16" cy="16" r="16" fill="#f97316"/>
      {/* ears */}
      <polygon points="7,14 11,7 13,14" fill="#fb923c"/>
      <polygon points="19,14 21,7 25,14" fill="#fb923c"/>
      <polygon points="8.5,13.5 11,8.5 12.5,13.5" fill="#fde68a"/>
      <polygon points="19.5,13.5 21,8.5 23.5,13.5" fill="#fde68a"/>
      {/* face */}
      <circle cx="16" cy="17" r="7" fill="#fdba74"/>
      {/* muzzle */}
      <ellipse cx="16" cy="20" rx="3.5" ry="2.5" fill="#fed7aa"/>
      {/* eyes */}
      <circle cx="13" cy="15.5" r="1.8" fill="#1c1917"/>
      <circle cx="19" cy="15.5" r="1.8" fill="#1c1917"/>
      <circle cx="13.6" cy="14.9" r="0.6" fill="#fff"/>
      <circle cx="19.6" cy="14.9" r="0.6" fill="#fff"/>
      {/* nose */}
      <ellipse cx="16" cy="19" rx="1" ry="0.7" fill="#9a3412"/>
      {/* smile */}
      <path d="M14 20.8 Q16 22.2 18 20.8" stroke="#9a3412" strokeWidth="0.8" strokeLinecap="round" fill="none"/>
      {/* cheeks */}
      <circle cx="11.5" cy="18" r="1.5" fill="#fb923c" fillOpacity="0.5"/>
      <circle cx="20.5" cy="18" r="1.5" fill="#fb923c" fillOpacity="0.5"/>
    </svg>
  )
}

/** Normalize model output before feeding to ReactMarkdown:
 *  1. Strip newlines that appear immediately before a [N] citation so they stay inline
 *  2. Collapse multiple blank lines inside list blocks to prevent loose-list wrapping
 *  3. Convert [N] to markdown link syntax for the custom `a` renderer
 */
function prepareContent(text: string): string {
  // 0. Ensure a blank line after every heading line (model sometimes omits it)
  let out = text.replace(/(^#{1,6} .+)\n(?!\n)/gm, '$1\n\n')

  // 1. Merge soft line-breaks: a single \n (not a blank line) not followed by
  //    a heading, list marker, fence, blockquote → join to previous line with a space.
  out = out.replace(/([^\n])\n(?!\n|[ \t]*[-*>]|[ \t]*\d+\.|[ \t]*#+|[ \t]*```)/g, '$1 ')

  // 2. Collapse double-blank-lines between list items → single \n
  out = out.replace(/(^[ \t]*[-*\d].*)\n{2,}(?=[ \t]*[-*\d])/gm, '$1\n')

  // 3. Citation [N] → markdown link
  out = out.replace(/\[(\d+)\]/g, '[$1](#cite-$1)')

  return out
}

interface MarkdownWithCitationsProps {
  content: string
  onCite: (n: number) => void
  raw: boolean
}

function MarkdownWithCitations({ content, onCite, raw }: MarkdownWithCitationsProps) {
  if (raw) {
    return <pre className={styles.rawContent}>{content}</pre>
  }

  const prepared = prepareContent(content)

  return (
    <div className={styles.mdContent}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const m = href?.match(/^#cite-(\d+)$/)
            if (m) {
              const n = Number(m[1])
              return (
                <sup>
                  <a
                    href={`#source-${n}`}
                    className={styles.citation}
                    onClick={(e) => { e.preventDefault(); onCite(n) }}
                  >[{n}]</a>
                </sup>
              )
            }
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>
          },
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  )
}

export default function ChatInterface({
  session, onSessionUpdate, onSessionTitleUpdate,
  sessions, activeSessionId, onSessionSelect, onNewSession, onDeleteSession,
}: Props) {
  const { setSidebarContent } = useSidebar()

  useEffect(() => {
    setSidebarContent(
      <SessionListSidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={onSessionSelect}
        onNew={onNewSession}
        onDelete={onDeleteSession}
      />
    )
    return () => setSidebarContent(null)
  }, [sessions, activeSessionId, onSessionSelect, onNewSession, onDeleteSession])
  const [input, setInput] = useState('')
  const [useGraph, setUseGraph] = useState(true)
  const [rawMsgIds, setRawMsgIds] = useState<Set<number>>(new Set())
  const [expandedPaths, setExpandedPaths] = useState<Set<number>>(new Set())
  const [entityModal, setEntityModal] = useState<string | null>(null)
  const { answer, graphEntities, graphPaths, loading, error, ask, stop } = useSSEQuery()
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sourcePanelRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const scrollToSource = useCallback((n: number, msgIdx: number) => {
    const key = `${msgIdx}-${n}`
    sourcePanelRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const toggleRaw = useCallback((idx: number) => {
    setRawMsgIds((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }, [])

  const togglePaths = useCallback((idx: number) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }, [])

  const prevSessionId = useRef(session.id)

  // Jump instantly when switching sessions; smooth-scroll only for new streaming content
  useEffect(() => {
    const switching = prevSessionId.current !== session.id
    prevSessionId.current = session.id
    bottomRef.current?.scrollIntoView({ behavior: switching ? 'instant' : 'smooth' })
  }, [answer, session.messages.length, session.id])

  // Auto-resize textarea
  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const submit = () => {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const userMsg = { role: 'user' as const, content: q }
    const isFirstMessage = session.messages.length === 0
    const updated = { ...session, messages: [...session.messages, userMsg] }
    onSessionUpdate(updated)

    ask(q, useGraph, async (finalAnswer, finalSources, finalEntities, finalPaths, finalGraphChunkIds) => {
      const assistantMsg = {
        role: 'assistant' as const,
        content: finalAnswer,
        sources: finalSources,
        graphEntities: finalEntities,
        graphPaths: finalPaths,
        graphChunkIds: finalGraphChunkIds,
      }
      const withAssistant = { ...updated, messages: [...updated.messages, assistantMsg] }

      // Write messages immediately — no waiting for title
      onSessionUpdate(withAssistant)

      // Generate title in background, update only title field (no messages re-render)
      if (isFirstMessage) {
        generateSessionTitle(q, finalAnswer).then((title) => {
          onSessionTitleUpdate(session.id, title)
        })
      }
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const isEmpty = session.messages.length === 0 && !answer && !loading

  return (
    <div className={styles.container}>
      {isEmpty ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>有什么可以帮你？</div>
          <div className={styles.emptyHint}>上传文档后，向我提问文档中的内容</div>
        </div>
      ) : (
        <div className={styles.messages}>
          <div className={styles.messagesInner}>
          {session.messages.map((msg, i) => (
            <div key={i} className={`${styles.msgRow} ${msg.role === 'user' ? styles.user : ''}`}>
              {msg.role === 'assistant' && <BotAvatar />}
              <div className={`${styles.bubble} ${styles[msg.role]}`}>
                {msg.role === 'assistant' && msg.graphEntities && msg.graphEntities.length > 0 && (
                  <div className={styles.entities}>
                    <span className={styles.entitiesLabel}>图谱命中：</span>
                    {msg.graphEntities.map((e, ei) => (
                      <button
                        key={ei}
                        className={styles.entityTag}
                        onClick={() => setEntityModal(e)}
                        title={`查看「${e}」的关系图`}
                      >{e}</button>
                    ))}
                  </div>
                )}
                {msg.role === 'assistant' ? (
                  <>
                    <MarkdownWithCitations
                      content={msg.content}
                      onCite={(n) => scrollToSource(n, i)}
                      raw={rawMsgIds.has(i)}
                    />
                    <div className={styles.bubbleActions}>
                      {msg.graphPaths && msg.graphPaths.length > 0 && (
                        <button
                          className={styles.rawToggle}
                          onClick={() => togglePaths(i)}
                        >
                          {expandedPaths.has(i) ? '▲ 收起图谱路径' : `▼ 图谱路径 (${msg.graphPaths.length})`}
                        </button>
                      )}
                      <button
                        className={styles.rawToggle}
                        onClick={() => toggleRaw(i)}
                      >
                        {rawMsgIds.has(i) ? '渲染' : '原文'}
                      </button>
                    </div>
                    {msg.graphPaths && expandedPaths.has(i) && (
                      <div className={styles.graphPaths}>
                        {msg.graphPaths.map((p, pi) => (
                          <div key={pi} className={styles.graphPath}>
                            {p.entities.map((ent, ei) => (
                              <span key={ei}>
                                <button
                                  className={styles.pathEntity}
                                  onClick={() => setEntityModal(ent)}
                                >{ent}</button>
                                {ei < p.relations.length && (
                                  <span className={styles.pathRelation}> —{p.relations[ei]}→ </span>
                                )}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : msg.content}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <SourcePanel
                    sources={msg.sources}
                    msgIdx={i}
                    panelRefs={sourcePanelRefs.current}
                    graphChunkIds={msg.graphChunkIds}
                  />
                )}
              </div>
              {msg.role === 'user' && <UserAvatar />}
            </div>
          ))}

          {/* Streaming assistant reply */}
          {(loading || answer) && (
            <div className={styles.msgRow}>
              <BotAvatar />
              <div className={`${styles.bubble} ${styles.assistant}`}>
                {loading && !answer && (
                  <div className={styles.thinking}>
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                  </div>
                )}
                {answer && (
                  <>
                    {graphEntities.length > 0 && (
                      <div className={styles.entities}>
                        <span className={styles.entitiesLabel}>图谱命中：</span>
                        {graphEntities.map((e, ei) => (
                          <span key={ei} className={styles.entityTagStatic}>{e}</span>
                        ))}
                      </div>
                    )}
                    <MarkdownWithCitations content={answer} onCite={() => {}} raw={false} />
                  </>
                )}
              </div>
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}
          <div ref={bottomRef} />
          </div>
        </div>
      )}

      {entityModal && (
        <GraphEntityModal entity={entityModal} onClose={() => setEntityModal(null)} />
      )}

      <div className={styles.inputArea}>
        <div className={styles.inputBox}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            rows={1}
            value={input}
            onChange={(e) => { setInput(e.target.value); handleInput() }}
            onKeyDown={onKeyDown}
            placeholder="发送消息（Shift+Enter 换行）"
            disabled={loading}
          />
          <div className={styles.controls}>
            <label className={styles.toggle}>
              <input type="checkbox" checked={useGraph} onChange={(e) => setUseGraph(e.target.checked)} />
              图谱
            </label>
            {loading ? (
              <button className={styles.stopBtn} onClick={stop} title="停止">■</button>
            ) : (
              <button className={styles.sendBtn} onClick={submit} disabled={!input.trim()} title="发送">↑</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
