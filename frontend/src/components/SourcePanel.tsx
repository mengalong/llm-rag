import { useState } from 'react'
import { type Source } from '../api/client'
import styles from './SourcePanel.module.css'

interface Props { sources: Source[] }

export default function SourcePanel({ sources }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className={styles.panel}>
      <div className={styles.title}>来源 ({sources.length})</div>
      {sources.map((s, i) => (
        <div key={s.chunk_id} className={styles.source}>
          <button className={styles.header} onClick={() => setExpanded(expanded === s.chunk_id ? null : s.chunk_id)}>
            <span className={styles.index}>{i + 1}</span>
            <span className={styles.filename}>{s.filename}</span>
            {s.page != null && <span className={styles.page}>第 {s.page} 页</span>}
            <span className={styles.score}>{(s.relevance_score * 100).toFixed(0)}%</span>
          </button>
          {expanded === s.chunk_id && (
            <div className={styles.excerpt}>{s.excerpt}</div>
          )}
        </div>
      ))}
    </div>
  )
}
