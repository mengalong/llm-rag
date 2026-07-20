import { useEffect, useRef, useState, useCallback, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSSEQuery } from '../hooks/useSSE'
import SourcePanel from './SourcePanel'
import { type ChatSession, generateSessionTitle } from '../api/sessions'
import styles from './ChatInterface.module.css'

interface Props {
  session: ChatSession
  onSessionUpdate: (s: ChatSession) => void
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

export default function ChatInterface({ session, onSessionUpdate }: Props) {
  const [input, setInput] = useState('')
  const [useGraph, setUseGraph] = useState(true)
  const [rawMsgIds, setRawMsgIds] = useState<Set<number>>(new Set())
  const { answer, graphEntities, loading, error, ask, stop } = useSSEQuery()
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

    ask(q, useGraph, async (finalAnswer, finalSources, finalEntities) => {
      const assistantMsg = {
        role: 'assistant' as const,
        content: finalAnswer,
        sources: finalSources,
        graphEntities: finalEntities,
      }
      const withAssistant = { ...updated, messages: [...updated.messages, assistantMsg] }

      // Auto-generate title from first Q&A
      if (isFirstMessage) {
        const title = await generateSessionTitle(q, finalAnswer)
        onSessionUpdate({ ...withAssistant, title })
      } else {
        onSessionUpdate(withAssistant)
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
          {session.messages.map((msg, i) => (
            <div key={i} className={`${styles.msgRow} ${msg.role === 'user' ? styles.user : ''}`}>
              <div className={`${styles.bubble} ${styles[msg.role]}`}>
                {msg.role === 'assistant' && msg.graphEntities && msg.graphEntities.length > 0 && (
                  <div className={styles.entities}>图谱：{msg.graphEntities.join(' · ')}</div>
                )}
                {msg.role === 'assistant' ? (
                  <>
                    <MarkdownWithCitations
                      content={msg.content}
                      onCite={(n) => scrollToSource(n, i)}
                      raw={rawMsgIds.has(i)}
                    />
                    <button
                      className={styles.rawToggle}
                      onClick={() => toggleRaw(i)}
                      title={rawMsgIds.has(i) ? '切换为渲染视图' : '切换为原始文本'}
                    >
                      {rawMsgIds.has(i) ? '渲染' : '原文'}
                    </button>
                  </>
                ) : msg.content}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <SourcePanel
                    sources={msg.sources}
                    msgIdx={i}
                    panelRefs={sourcePanelRefs.current}
                  />
                )}
              </div>
            </div>
          ))}

          {/* Streaming assistant reply — only show while streaming, disappears once saved to session */}
          {(loading || answer) && (
            <div className={styles.msgRow}>
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
                      <div className={styles.entities}>图谱：{graphEntities.join(' · ')}</div>
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
