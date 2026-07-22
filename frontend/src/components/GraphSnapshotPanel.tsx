/**
 * GraphSnapshotPanel — left panel snapshot list, diff controls, entity search
 */
import { useState } from 'react'
import {
  type GraphSnapshot, type GraphDiff,
  deleteGraphSnapshot, loadGraphSnapshot,
  getGraphDiff, getGraphSnapshots, searchGraphEntities,
  type GraphSearchResult,
} from '../api/client'
import styles from './GraphViewer.module.css'

interface Props {
  snapshots: GraphSnapshot[]
  activeVersion: string | null
  diffV1: string | null
  diffV2: string | null
  diffLoading: boolean
  diffResult: GraphDiff | null
  searchResult: GraphSearchResult | null
  searching: boolean
  onSnapshotsChange: (s: GraphSnapshot[]) => void
  onActiveVersionChange: (v: string) => void
  onToggleDiffVersion: (v: string) => void
  onRunDiff: () => void
  onClearDiff: () => void
  onEntityClick: (label: string) => void
  onSearchResultChange: (r: GraphSearchResult | null) => void
  onSearchingChange: (v: boolean) => void
}

export default function GraphSnapshotPanel({
  snapshots, activeVersion, diffV1, diffV2, diffLoading, diffResult,
  searchResult, searching,
  onSnapshotsChange, onActiveVersionChange, onToggleDiffVersion, onRunDiff, onClearDiff,
  onEntityClick, onSearchResultChange, onSearchingChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const handleLoad = async (version: string) => {
    if (version === activeVersion) return
    if (!confirm(`切换到 ${version}？当前检索将使用新版本图谱。`)) return
    setLoadingVersion(version)
    try {
      await loadGraphSnapshot(version)
      onActiveVersionChange(version)
      const r = await getGraphSnapshots()
      onSnapshotsChange(r.data)
    } catch (e) { console.error(e) }
    finally { setLoadingVersion(null) }
  }

  const handleDelete = async (version: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteGraphSnapshot(version).catch(console.error)
    onSnapshotsChange(snapshots.filter(s => s.version !== version))
    if (diffV1 === version || diffV2 === version) onClearDiff()
  }

  const vn = (v: string) => parseInt(v.replace(/\D/g, ''), 10) || 0

  const diffBtnLabel = (() => {
    if (!diffV1 || !diffV2) return '选择两个版本后对比'
    const [lo, hi] = vn(diffV1) <= vn(diffV2) ? [diffV1, diffV2] : [diffV2, diffV1]
    return `对比 ${lo} → ${hi}`
  })()

  const runSearch = () => {
    const q = searchQuery.trim()
    if (!q) return
    onSearchingChange(true)
    searchGraphEntities(q)
      .then(r => onSearchResultChange(r.data))
      .catch(console.error)
      .finally(() => onSearchingChange(false))
  }

  return (
    <>
      {snapshots.length > 0 && (
        <div className={styles.snapshotSection}>
          <div className={styles.snapshotHeader} onClick={() => setOpen(v => !v)}>
            <span className={styles.snapshotTitle}>
              版本快照 <span className={styles.panelCount}>{snapshots.length}</span>
            </span>
            <span className={styles.snapshotToggle}>{open ? '▲' : '▼'}</span>
          </div>
          {open && (
            <div className={styles.snapshotList}>
              {snapshots.map(s => {
                const isV1 = diffV1 === s.version
                const isV2 = diffV2 === s.version
                const isActive = activeVersion === s.version
                const ts = new Date(s.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                const nerShort = (s.ner_model ?? 'sm').replace('zh_core_web_', '')
                const strategyLabel = s.skip_llm ? 'NER' : 'NER+LLM'
                const modelLine = s.skip_llm
                  ? `spaCy ${nerShort}`
                  : `spaCy ${nerShort} + ${(s.llm_model ?? '').split(/[\s/]/).pop() ?? 'LLM'}`
                return (
                  <div
                    key={s.version}
                    className={[
                      styles.snapshotItem,
                      isV1 ? styles.snapshotItemV1 : '',
                      isV2 ? styles.snapshotItemV2 : '',
                      isActive && !isV1 && !isV2 ? styles.snapshotItemActive : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => onToggleDiffVersion(s.version)}
                  >
                    <div className={styles.snapshotMain}>
                      <span className={styles.snapshotVer}>{s.version}</span>
                      {isActive && <span className={styles.snapshotActiveBadge}>使用中</span>}
                      <span className={styles.snapshotTs}>{ts}</span>
                      <span className={styles.snapshotNodes}>{s.node_count.toLocaleString()}节点</span>
                      {(isV1 || isV2) && (
                        <span className={`${styles.snapshotBadge} ${isV1 ? styles.snapshotBadgeV1 : styles.snapshotBadgeV2}`}>
                          {isV1 ? 'A' : 'B'}
                        </span>
                      )}
                      <button
                        className={styles.snapshotLoadBtn}
                        disabled={isActive || loadingVersion === s.version}
                        onClick={e => { e.stopPropagation(); handleLoad(s.version) }}
                        title={isActive ? '当前使用中' : `切换到 ${s.version}`}
                      >
                        {loadingVersion === s.version ? '切换中' : isActive ? '✓' : '切换'}
                      </button>
                      <button className={styles.snapshotDel} onClick={e => handleDelete(s.version, e)} title="删除">×</button>
                    </div>
                    <div className={styles.snapshotMeta}>
                      <span className={styles.snapshotStrategy}>{strategyLabel}</span>
                      <span className={styles.snapshotModel}>{modelLine}</span>
                    </div>
                  </div>
                )
              })}
              <div className={styles.snapshotDiffBtnRow}>
                <button
                  className={styles.snapshotDiffBtn}
                  disabled={!diffV1 || !diffV2 || diffLoading}
                  onClick={onRunDiff}
                >
                  {diffLoading ? '对比中...' : diffBtnLabel}
                </button>
                {diffResult && (
                  <button className={styles.snapshotCancelBtn} onClick={onClearDiff}>
                    ✕ 关闭对比
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className={styles.searchSection}>
        <div className={styles.searchBox}>
          <input
            className={styles.searchInput}
            placeholder="搜索实体关键词..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); if (!e.target.value) onSearchResultChange(null) }}
            onKeyDown={e => e.key === 'Enter' && runSearch()}
          />
          <button className={styles.searchBtn} onClick={runSearch} disabled={searching || !searchQuery.trim()}>
            {searching ? '…' : '查询'}
          </button>
        </div>
        {searchResult && (
          <div className={styles.searchResults}>
            {searchResult.ner_entities.length > 0 && (
              <div className={styles.searchGroup}>
                <div className={styles.searchGroupLabel}>NER 实体</div>
                {searchResult.ner_entities.map(e => (
                  <div key={e} className={styles.searchResultItem} onClick={() => onEntityClick(e)}>
                    <span className={styles.searchResultLabel}>{e}</span>
                    <span className={styles.searchResultTag} style={{ color: 'var(--accent)' }}>spaCy</span>
                  </div>
                ))}
              </div>
            )}
            {searchResult.fuzzy_matches.length > 0 && (
              <div className={styles.searchGroup}>
                <div className={styles.searchGroupLabel}>关键词匹配</div>
                {searchResult.fuzzy_matches.map((m, i) => (
                  <div key={i} className={styles.searchResultItem} onClick={() => onEntityClick(m.label)}>
                    <div className={styles.searchResultMain}>
                      <span className={styles.searchResultLabel}>{m.label}</span>
                      <span className={styles.searchResultTag} style={{ color: '#f59e0b' }}>关键词</span>
                    </div>
                    <div className={styles.searchResultHint}>关键词「{m.matched_by}」→ {m.label}</div>
                  </div>
                ))}
              </div>
            )}
            {searchResult.ner_entities.length === 0 && searchResult.fuzzy_matches.length === 0 && (
              <div className={styles.searchEmpty}>未找到匹配实体</div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
