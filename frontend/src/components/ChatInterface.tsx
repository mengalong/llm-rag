import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSSEQuery } from '../hooks/useSSE'
import SourcePanel from './SourcePanel'
import { type ChatSession, generateSessionTitle } from '../api/sessions'
import styles from './ChatInterface.module.css'

interface Props {
  session: ChatSession
  onSessionUpdate: (s: ChatSession) => void
}

export default function ChatInterface({ session, onSessionUpdate }: Props) {
  const [input, setInput] = useState('')
  const [useGraph, setUseGraph] = useState(true)
  const { answer, graphEntities, loading, error, ask, stop } = useSSEQuery()
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom when new content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [answer, session.messages.length])

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
                {msg.content}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <SourcePanel sources={msg.sources} />
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
                    {answer}
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
