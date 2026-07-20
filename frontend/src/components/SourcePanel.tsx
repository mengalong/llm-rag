import { useState } from 'react'
import { type Source } from '../api/client'
import styles from './SourcePanel.module.css'

interface Props {
  sources: Source[]
  msgIdx?: number
  panelRefs?: Record<string, HTMLDivElement | null>
  graphChunkIds?: string[]
}

export default function SourcePanel({ sources, msgIdx = 0, panelRefs, graphChunkIds = [] }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const graphSet = new Set(graphChunkIds)

  return (
    <div className={styles.panel}>
      <div className={styles.title}>来源 ({sources.length})</div>
      {sources.map((s, i) => {
        const n = i + 1
        const key = `${msgIdx}-${n}`
        const fromGraph = graphSet.has(s.chunk_id)
        return (
          <div
            key={s.chunk_id}
            id={`source-${n}`}
            className={styles.source}
            ref={(el) => { if (panelRefs) panelRefs[key] = el }}
          >
            <button className={styles.header} onClick={() => setExpanded(expanded === s.chunk_id ? null : s.chunk_id)}>
              <span className={styles.index}>{n}</span>
              {fromGraph && <span className={styles.graphBadge}>图谱</span>}
              <span className={styles.filename}>{s.filename}</span>
              {s.page != null && <span className={styles.page}>第 {s.page} 页</span>}
              <span className={styles.score}>{(s.relevance_score * 100).toFixed(0)}%</span>
            </button>
            {expanded === s.chunk_id && (
              <div className={styles.excerpt}>{s.excerpt}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
