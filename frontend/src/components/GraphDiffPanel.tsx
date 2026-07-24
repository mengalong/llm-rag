/**
 * GraphDiffPanel — diff result display (added / removed / unchanged)
 */
import { useState, useMemo } from 'react'
import { type GraphDiff, type GraphDiffNode } from '../api/client'
import styles from './GraphViewer.module.css'

const TYPE_COLOR: Record<string, string> = {
  PERSON: '#a78bfa', ORG: '#60a5fa', GPE: '#34d399',
  PRODUCT: '#fb923c', LOC: '#f472b6', ENTITY: '#94a3b8',
}

interface Props {
  diffResult: GraphDiff
  onEntityClick: (label: string, version?: string) => void
  v1?: string  // older version — removed nodes exist here
  v2?: string  // newer version — added nodes exist here
}

export default function GraphDiffPanel({ diffResult, onEntityClick, v1, v2 }: Props) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const f = (nodes: GraphDiffNode[]) => !q ? nodes : nodes.filter(n => n.label.toLowerCase().includes(q))
    return {
      added: f(diffResult.added_nodes),
      removed: f(diffResult.removed_nodes),
      unchanged: f(diffResult.unchanged_nodes ?? []),
    }
  }, [diffResult, search])

  return (
    <div className={styles.diffPanel}>
      <div className={styles.diffHeader}>
        <span className={styles.diffTitle}>{diffResult.v1} → {diffResult.v2} 对比</span>
        <span className={styles.diffStat}>
          <span className={styles.diffAdded}>+{diffResult.added_count} 新增</span>
          <span className={styles.diffRemoved}>-{diffResult.removed_count} 删除</span>
          <span className={styles.diffUnchanged}>{diffResult.unchanged_count} 不变</span>
        </span>
        <input
          className={styles.diffSearch}
          placeholder="搜索实体..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className={styles.diffBody}>
        <div className={styles.diffCol}>
          <div className={styles.diffColHeader}>
            新增实体 <span className={`${styles.diffColCount} ${styles.diffColCountAdded}`}>{filtered.added.length}</span>
          </div>
          <div className={styles.diffColScroll}>
            {filtered.added.map((n, i) => (
              <div key={i} className={`${styles.diffNode} ${styles.diffNodeAdded}`} onClick={() => onEntityClick(n.label)}>
                <div className={styles.nodeTypeDot} style={{ background: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY }} />
                <span className={styles.diffNodeLabel}>{n.label}</span>
                <span className={styles.diffNodeType}>{n.type}</span>
              </div>
            ))}
            {filtered.added.length === 0 && <div className={styles.empty}>无结果</div>}
          </div>
        </div>
        <div className={styles.diffColDivider} />
        <div className={styles.diffCol}>
          <div className={styles.diffColHeader}>
            删除实体 <span className={`${styles.diffColCount} ${styles.diffColCountRemoved}`}>{filtered.removed.length}</span>
          </div>
          <div className={styles.diffColScroll}>
            {filtered.removed.map((n, i) => (
              <div key={i} className={`${styles.diffNode} ${styles.diffNodeRemoved} ${styles.diffNodeClickable}`}
                onClick={() => onEntityClick(n.label, v1)}>
                <div className={styles.nodeTypeDot} style={{ background: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY }} />
                <span className={styles.diffNodeLabel}>{n.label}</span>
                <span className={styles.diffNodeType}>{n.type}</span>
              </div>
            ))}
            {filtered.removed.length === 0 && <div className={styles.empty}>无结果</div>}
          </div>
        </div>
        <div className={styles.diffColDivider} />
        <div className={styles.diffCol}>
          <div className={styles.diffColHeader}>
            不变实体 <span className={styles.diffColCountUnchanged}>{filtered.unchanged.length}</span>
          </div>
          <div className={styles.diffColScroll}>
            {filtered.unchanged.map((n, i) => (
              <div key={i} className={`${styles.diffNode} ${styles.diffNodeUnchanged}`} onClick={() => onEntityClick(n.label)}>
                <div className={styles.nodeTypeDot} style={{ background: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY }} />
                <span className={styles.diffNodeLabel}>{n.label}</span>
                <span className={styles.diffNodeType}>{n.type}</span>
              </div>
            ))}
            {filtered.unchanged.length === 0 && <div className={styles.empty}>无结果</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
