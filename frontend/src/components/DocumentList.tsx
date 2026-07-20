import { useEffect } from 'react'
import { type Document } from '../api/client'
import styles from './DocumentList.module.css'

interface Props {
  docs: Document[]
  onDelete: (id: string) => void
  onRefresh: () => void
}

const BADGE: Record<string, string> = {
  indexed:    styles['badge-indexed'],
  processing: styles['badge-processing'],
  pending:    styles['badge-pending'],
  error:      styles['badge-error'],
}

const LABEL: Record<string, string> = {
  indexed: '已索引', processing: '处理中', pending: '等待', error: '错误',
}

export default function DocumentList({ docs, onDelete, onRefresh }: Props) {
  useEffect(() => {
    const hasPending = docs.some((d) => d.status === 'pending' || d.status === 'processing')
    if (!hasPending) return
    const timer = setInterval(onRefresh, 1500)
    return () => clearInterval(timer)
  }, [docs, onRefresh])

  if (docs.length === 0) return <p className={styles.empty}>暂无文档</p>

  return (
    <>
      <div className={styles.sectionLabel}>文档库</div>
      <ul className={styles.list}>
        {docs.map((doc) => (
          <li key={doc.id} className={styles.item}>
            <div className={styles.info}>
              <span className={styles.name} title={doc.filename}>{doc.filename}</span>
              <div className={styles.statusRow}>
                <span className={`${styles.badge} ${BADGE[doc.status] ?? ''}`}>
                  {LABEL[doc.status] ?? doc.status}
                </span>
                {doc.status === 'indexed' && (
                  <span className={styles.chunks}>{doc.chunk_count} 片段</span>
                )}
                {(doc.status === 'processing' || doc.status === 'pending') && doc.progress_step && (
                  <span className={styles.step}>{doc.progress_step}</span>
                )}
              </div>
              {(doc.status === 'processing' || doc.status === 'pending') && (
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${doc.progress ?? 0}%` }} />
                </div>
              )}
              {doc.error && <div className={styles.error}>{doc.error}</div>}
            </div>
            <button className={styles.del} onClick={() => onDelete(doc.id)} title="删除">×</button>
          </li>
        ))}
      </ul>
    </>
  )
}
