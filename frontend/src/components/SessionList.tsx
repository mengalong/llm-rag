import { type ChatSession } from '../api/sessions'
import styles from './SessionList.module.css'

interface Props {
  sessions: ChatSession[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

function fmtSessionTs(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export default function SessionList({ sessions, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className={styles.sessionContent}>
      <button className={styles.newBtn} onClick={onNew}>＋ 新建对话</button>
      <div className={styles.label}>历史对话</div>
      <div className={styles.list}>
        {sessions.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>暂无历史</div>}
        {[...sessions].sort((a, b) => {
          const ta = (a.messages.at(-1)?.createdAt ?? a.createdAt)
          const tb = (b.messages.at(-1)?.createdAt ?? b.createdAt)
          return tb - ta
        }).map((s) => {
          const lastMsg = s.messages.length > 0 ? s.messages[s.messages.length - 1] : null
          const ts = lastMsg?.createdAt ?? s.createdAt
          return (
            <div
              key={s.id}
              className={`${styles.item} ${s.id === activeId ? styles.active : ''}`}
              onClick={() => onSelect(s.id)}
            >
              <div className={styles.itemMain}>
                <span className={styles.title} title={s.title}>{s.title}</span>
                <span className={styles.ts}>{fmtSessionTs(ts)}</span>
              </div>
              <button
                className={styles.del}
                onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
                title="删除"
              >×</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
