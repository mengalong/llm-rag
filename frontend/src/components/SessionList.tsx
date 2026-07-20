import { type ChatSession } from '../api/sessions'
import styles from './SessionList.module.css'

interface Props {
  sessions: ChatSession[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export default function SessionList({ sessions, activeId, onSelect, onNew, onDelete, theme, onToggleTheme }: Props) {
  return (
    <div className={styles.sidebar}>
      <button className={styles.newBtn} onClick={onNew}>＋ 新建对话</button>
      <div className={styles.label}>历史对话</div>
      <div className={styles.list}>
        {sessions.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>暂无历史</div>}
        {[...sessions].reverse().map((s) => (
          <div
            key={s.id}
            className={`${styles.item} ${s.id === activeId ? styles.active : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className={styles.title} title={s.title}>{s.title}</span>
            <button
              className={styles.del}
              onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
              title="删除"
            >×</button>
          </div>
        ))}
      </div>
      <div className={styles.bottom}>
        <button className={styles.themeBtn} onClick={onToggleTheme}>
          {theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
        </button>
      </div>
    </div>
  )
}
