import { useEffect, useRef, useState, useMemo } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import {
  type GraphData, type GraphNode, type GraphOverview, type GraphSearchResult,
  type GraphEntityCategories, type EntityCategoryStats, type EntityDetail, type EntityTypePageResult,
  type GraphSnapshot, type GraphDiff, type GraphDiffNode, type Document,
  getSubgraph, getGraphByDocument, getGraphOverview, getGraphEntityCategories, getEntitiesByType,
  getGraphSnapshots, deleteGraphSnapshot, getGraphDiff, loadGraphSnapshot, graphEventsUrl, searchGraphEntities
} from '../api/client'
import GraphEntityModal from './GraphEntityModal'
import styles from './GraphViewer.module.css'

interface Props {
  docs: Document[]
}

const TYPE_COLOR: Record<string, string> = {
  PERSON:  '#a78bfa',
  ORG:     '#60a5fa',
  GPE:     '#34d399',
  PRODUCT: '#fb923c',
  LOC:     '#f472b6',
  ENTITY:  '#94a3b8',
}
const TYPE_LABEL: Record<string, string> = {
  PERSON: '人物', ORG: '组织', GPE: '地点', PRODUCT: '产品', LOC: '位置', ENTITY: '实体',
}
const ALL_TYPES = ['PERSON', 'ORG', 'GPE', 'PRODUCT', 'LOC', 'ENTITY']

function GraphCanvas({ data, onNodeClick }: { data: GraphData; onNodeClick: (label: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.nodes.length === 0) return
    const elements = [
      ...data.nodes.map((n) => ({
        data: { id: n.id, label: n.label, type: n.type, color: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY },
      })),
      ...data.edges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, label: e.relation, weight: e.weight },
      })),
    ]
    if (cyRef.current) cyRef.current.destroy()
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'font-size': 11,
            'font-family': 'Inter, sans-serif',
            'font-weight': '500',
            color: '#fff',
            'text-valign': 'center',
            'text-outline-width': 2,
            'text-outline-color': 'data(color)',
            width: 40, height: 40,
            'border-width': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.2,
            'line-color': '#4f52d9',
            'line-opacity': 0.5,
            'target-arrow-color': '#6366f1',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 9,
            'font-family': 'Inter, sans-serif',
            color: '#8080a8',
            'text-rotation': 'autorotate',
            'text-background-color': '#1a1a2e',
            'text-background-opacity': 0.75,
            'text-background-padding': '2px',
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': '#fff', 'border-opacity': 0.9 },
        },
        {
          selector: 'node:hover',
          style: { 'border-width': 2, 'border-color': '#fff', 'border-opacity': 0.6 },
        },
      ],
      layout: {
        name: 'cose',
        animate: true,
        animationDuration: 400,
        nodeRepulsion: () => 4500,
        idealEdgeLength: () => 90,
        fit: true,
        padding: 40,
      } as any,
    })
    cy.on('tap', 'node', (evt) => onNodeClick(evt.target.data('label')))
    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null }
  }, [data])

  const usedTypes = [...new Set(data.nodes.map((n) => n.type))]

  return (
    <div className={styles.canvasWrapper}>
      <div className={styles.canvasStats}>
        节点 {data.nodes.length} · 边 {data.edges.length}
      </div>
      <div ref={containerRef} className={styles.canvas} />
      <div className={styles.legend}>
        {usedTypes.map((t) => (
          <div key={t} className={styles.legendItem}>
            <div className={styles.legendDot} style={{ background: TYPE_COLOR[t] ?? TYPE_COLOR.ENTITY }} />
            {TYPE_LABEL[t] ?? t}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function GraphViewer({ docs }: Props) {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [docGraphData, setDocGraphData] = useState<GraphData | null>(null)
  const [subgraphData, setSubgraphData] = useState<GraphData | null>(null)
  const [subgraphError, setSubgraphError] = useState<string | null>(null)
  const [modalEntity, setModalEntity] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string>('ALL')
  const [loading, setLoading] = useState(false)
  const [overview, setOverview] = useState<GraphOverview | null>(null)
  const [categories, setCategories] = useState<GraphEntityCategories | null>(null)
  const [showCategories, setShowCategories] = useState(true)
  const [expandedType, setExpandedType] = useState<string | null>(null)
  const [typeDetail, setTypeDetail] = useState<EntityTypePageResult | null>(null)
  const [typeDetailLoading, setTypeDetailLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<GraphSearchResult | null>(null)
  const [searching, setSearching] = useState(false)

  // Snapshot & diff state
  const [snapshots, setSnapshots] = useState<GraphSnapshot[]>([])
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [activeVersion, setActiveVersion] = useState<string | null>(null)
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null)
  const [diffV1, setDiffV1] = useState<string | null>(null)
  const [diffV2, setDiffV2] = useState<string | null>(null)
  const [diffResult, setDiffResult] = useState<GraphDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffSearch, setDiffSearch] = useState('')

  // Toast state for graph update notification
  const [graphUpdateToast, setGraphUpdateToast] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const refreshOverview = () => {
    getGraphOverview().then((r) => setOverview(r.data)).catch(console.error)
    getGraphEntityCategories().then((r) => setCategories(r.data)).catch(console.error)
  }

  const refreshAll = () => {
    refreshOverview()
    getGraphSnapshots().then((r) => setSnapshots(r.data)).catch(console.error)
    fetch('/api/v1/graph/current-version')
      .then(r => r.json())
      .then(d => setActiveVersion(d.version))
      .catch(console.error)
  }

  useEffect(() => {
    refreshAll()

    // Subscribe to graph update events
    const es = new EventSource(graphEventsUrl())
    esRef.current = es
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'graph_updated') {
          refreshAll()
          // Reset doc-specific data so it reloads with new graph
          setDocGraphData(null)
          setSubgraphData(null)
          setDiffResult(null)
          setDiffV1(null)
          setDiffV2(null)
          setGraphUpdateToast(`图谱已更新，已加载 ${data.version}`)
          setTimeout(() => setGraphUpdateToast(null), 4000)
        }
      } catch { /* ignore */ }
    }
    es.onerror = () => { /* reconnect handled by browser */ }

    return () => { es.close(); esRef.current = null }
  }, [])

  const handleLoadSnapshot = async (version: string) => {
    if (version === activeVersion) return
    if (!confirm(`切换到 ${version}？当前检索将使用新版本图谱。`)) return
    setLoadingVersion(version)
    try {
      await loadGraphSnapshot(version)
      setActiveVersion(version)
      refreshOverview()
      getGraphSnapshots().then(r => setSnapshots(r.data)).catch(console.error)
    } catch (e) { console.error(e) }
    finally { setLoadingVersion(null) }
  }

  const runSearch = () => {
    const q = searchQuery.trim()
    if (!q) return
    setSearching(true)
    searchGraphEntities(q)
      .then((r) => setSearchResult(r.data))
      .catch(console.error)
      .finally(() => setSearching(false))
  }

  useEffect(() => {
    setSubgraphData(null)
    if (!selectedDocId) { setDocGraphData(null); return }
    setLoading(true)
    getGraphByDocument(selectedDocId)
      .then((r) => setDocGraphData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedDocId])

  // Opening modal doesn't clear categories panel state
  const handleEntityClick = (label: string) => {
    setModalEntity(label)
  }

  const toggleDiffVersion = (v: string) => {
    if (diffV1 === v) { setDiffV1(null); return }
    if (diffV2 === v) { setDiffV2(null); return }
    if (!diffV1) { setDiffV1(v); return }
    if (!diffV2) { setDiffV2(v); return }
    // both already set: replace older selection
    setDiffV1(diffV2); setDiffV2(v)
  }

  const runDiff = async () => {
    if (!diffV1 || !diffV2) return
    setDiffLoading(true)
    setDiffResult(null)
    setShowCategories(false)
    // Sort so smaller version number is always the "from" (older)
    const versionNum = (v: string) => parseInt(v.replace(/\D/g, ''), 10) || 0
    const [lo, hi] = versionNum(diffV1) <= versionNum(diffV2)
      ? [diffV1, diffV2]
      : [diffV2, diffV1]
    try {
      const r = await getGraphDiff(lo, hi)
      setDiffResult(r.data)
    } catch (e) { console.error(e) }
    finally { setDiffLoading(false) }
  }

  const handleDeleteSnapshot = async (version: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteGraphSnapshot(version).catch(console.error)
    setSnapshots(prev => prev.filter(s => s.version !== version))
    if (diffV1 === version) setDiffV1(null)
    if (diffV2 === version) setDiffV2(null)
    if (diffResult?.v1 === version || diffResult?.v2 === version) setDiffResult(null)
  }

  const handleTypeExpand = async (typeKey: string) => {
    if (expandedType === typeKey) {
      setExpandedType(null)
      setTypeDetail(null)
      return
    }
    setExpandedType(typeKey)
    setTypeDetailLoading(true)
    setTypeDetail(null)
    try {
      const res = await getEntitiesByType(typeKey, 1, 50)
      setTypeDetail(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setTypeDetailLoading(false)
    }
  }

  const loadMoreTypeDetail = async () => {
    if (!typeDetail || !expandedType) return
    const nextPage = typeDetail.page + 1
    setTypeDetailLoading(true)
    try {
      const res = await getEntitiesByType(expandedType, nextPage, 50)
      setTypeDetail(prev => prev ? {
        ...res.data,
        items: [...prev.items, ...res.data.items]
      } : res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setTypeDetailLoading(false)
    }
  }

  const indexedDocs = docs.filter((d) => d.status === 'indexed')

  const entities = useMemo<GraphNode[]>(() => {
    if (!docGraphData) return []
    const nodes = filterType === 'ALL'
      ? docGraphData.nodes
      : docGraphData.nodes.filter((n) => n.type === filterType)
    return [...nodes].sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  }, [docGraphData, filterType])

  const groupedEntities = useMemo(() => {
    const groups: Record<string, GraphNode[]> = {}
    entities.forEach((n) => {
      const t = n.type ?? 'ENTITY'
      if (!groups[t]) groups[t] = []
      groups[t].push(n)
    })
    return groups
  }, [entities])

  const usedTypes = useMemo(() =>
    [...new Set((docGraphData?.nodes ?? []).map((n) => n.type))],
    [docGraphData]
  )

  const filteredDiffNodes = useMemo(() => {
    if (!diffResult) return { added: [] as GraphDiffNode[], removed: [] as GraphDiffNode[], unchanged: [] as GraphDiffNode[] }
    const q = diffSearch.toLowerCase()
    return {
      added:     diffResult.added_nodes.filter(n => !q || n.label.toLowerCase().includes(q)),
      removed:   diffResult.removed_nodes.filter(n => !q || n.label.toLowerCase().includes(q)),
      unchanged: (diffResult.unchanged_nodes ?? []).filter(n => !q || n.label.toLowerCase().includes(q)),
    }
  }, [diffResult, diffSearch])

  return (
    <div className={styles.wrapper}>
      {/* Left panel — docs + entity list only */}
      <div className={styles.panel}>
        {/* Version snapshots */}
        {snapshots.length > 0 && (
          <div className={styles.snapshotSection}>
            <div className={styles.snapshotHeader} onClick={() => setSnapshotsOpen(v => !v)}>
              <span className={styles.snapshotTitle}>版本快照 <span className={styles.panelCount}>{snapshots.length}</span></span>
              <span className={styles.snapshotToggle}>{snapshotsOpen ? '▲' : '▼'}</span>
            </div>
            {snapshotsOpen && (
              <div className={styles.snapshotList}>
                {snapshots.map(s => {
                  const isV1 = diffV1 === s.version
                  const isV2 = diffV2 === s.version
                  const ts = new Date(s.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                  const strategyLabel = s.skip_llm ? 'NER' : `NER+LLM`
                  const nerModel = s.ner_model ?? 'zh_core_web_sm'
                  const shortNer = nerModel.replace('zh_core_web_', '')  // sm / trf / lg
                  const modelLine = s.skip_llm
                    ? `spaCy ${shortNer}`
                    : `spaCy ${shortNer} + ${(s.llm_model ?? '').split(/[\s/]/).pop() ?? 'LLM'}`
                  const isActive = activeVersion === s.version
                  return (
                    <div
                      key={s.version}
                      className={`${styles.snapshotItem} ${isV1 ? styles.snapshotItemV1 : ''} ${isV2 ? styles.snapshotItemV2 : ''} ${isActive && !isV1 && !isV2 ? styles.snapshotItemActive : ''}`}
                      onClick={() => toggleDiffVersion(s.version)}
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
                          onClick={(e) => { e.stopPropagation(); handleLoadSnapshot(s.version) }}
                          title={isActive ? '当前使用中' : `切换到 ${s.version}`}
                        >
                          {loadingVersion === s.version ? '切换中' : isActive ? '✓' : '切换'}
                        </button>
                        <button className={styles.snapshotDel} onClick={(e) => handleDeleteSnapshot(s.version, e)} title="删除">×</button>
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
                    onClick={runDiff}
                  >
                    {diffLoading ? '对比中...' : (() => {
                      if (!diffV1 || !diffV2) return '选择两个版本后对比'
                      const vn = (v: string) => parseInt(v.replace(/\D/g, ''), 10) || 0
                      const [lo, hi] = vn(diffV1) <= vn(diffV2) ? [diffV1, diffV2] : [diffV2, diffV1]
                      return `对比 ${lo} → ${hi}`
                    })()}
                  </button>
                  {diffResult && (
                    <button
                      className={styles.snapshotCancelBtn}
                      onClick={() => { setDiffResult(null); setDiffSearch(''); setDiffV1(null); setDiffV2(null) }}
                    >✕ 关闭对比</button>
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
              onChange={e => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResult(null) }}
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
                    <div key={e} className={styles.searchResultItem} onClick={() => handleEntityClick(e)}>
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
                    <div key={i} className={styles.searchResultItem} onClick={() => handleEntityClick(m.label)}>
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

        <div className={styles.panelSection}>
          <div className={styles.panelLabel}>文档</div>
          {indexedDocs.length === 0 && (
            <div className={styles.panelEmpty}>暂无已索引文档</div>
          )}
          {indexedDocs.map((doc) => (
            <div
              key={doc.id}
              className={`${styles.docItem} ${doc.id === selectedDocId ? styles.docItemActive : ''}`}
              onClick={() => setSelectedDocId(doc.id === selectedDocId ? null : doc.id)}
              title={doc.filename}
            >
              <span className={styles.docItemName}>{doc.filename}</span>
            </div>
          ))}
        </div>

        {docGraphData && (
          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>实体类型</div>
            <div className={styles.typeFilters}>
              <button
                className={`${styles.typeBtn} ${filterType === 'ALL' ? styles.typeBtnActive : ''}`}
                onClick={() => setFilterType('ALL')}
              >全部 {docGraphData.nodes.length}</button>
              {usedTypes.map((t) => (
                <button
                  key={t}
                  className={`${styles.typeBtn} ${filterType === t ? styles.typeBtnActive : ''}`}
                  style={filterType === t ? { borderColor: TYPE_COLOR[t], color: TYPE_COLOR[t] } : {}}
                  onClick={() => setFilterType(t)}
                >
                  {TYPE_LABEL[t] ?? t} {docGraphData.nodes.filter((n) => n.type === t).length}
                </button>
              ))}
            </div>
          </div>
        )}

        {entities.length > 0 && (
          <div className={`${styles.panelSection} ${styles.entityListSection}`}>
            <div className={styles.panelLabel}>
              实体列表 <span className={styles.panelCount}>{entities.length}</span>
            </div>
            <div className={styles.entityList}>
              {Object.entries(groupedEntities).map(([type, nodes]) => (
                <div key={type}>
                  <div className={styles.entityGroup}>
                    <span className={styles.entityGroupDot} style={{ background: TYPE_COLOR[type] ?? TYPE_COLOR.ENTITY }} />
                    {TYPE_LABEL[type] ?? type}
                  </div>
                  {nodes.map((n) => (
                    <div
                      key={n.id}
                      className={`${styles.entityItem} ${subgraphData?.nodes.some(sn => sn.id === n.id) ? styles.entityItemActive : ''}`}
                      onClick={() => handleEntityClick(n.label)}
                      title={`点击展开「${n.label}」的关系图`}
                    >
                      {n.label}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right content */}
      <div className={styles.content}>

        {/* Overview — always shown when no doc selected and no subgraph */}
        {!selectedDocId && overview && (
          <div className={styles.overviewDefault}>
            {/* Version comparison cards (when two versions selected) */}
            {diffV1 && diffV2 && (
              <div className={styles.overviewMultiCol}>
                {(() => {
                  const vn = (v: string) => parseInt(v.replace(/\D/g, ''), 10) || 0
                  const [lo, hi] = vn(diffV1) <= vn(diffV2) ? [diffV1, diffV2] : [diffV2, diffV1]
                  return [lo, hi].map(ver => {
                    const snap = snapshots.find(s => s.version === ver)
                    const isNewer = ver === hi
                    if (!snap) return null
                    const nerShort = (snap.ner_model ?? 'sm').replace('zh_core_web_', '')
                    const strategy = snap.skip_llm ? `NER·${nerShort}` : `NER·${nerShort}+LLM`
                    const llmModel = !snap.skip_llm ? (snap.llm_model ?? '') : ''
                    const ts = new Date(snap.timestamp).toLocaleString('zh-CN', {
                      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                    })
                    return (
                      <div key={ver} className={`${styles.snapshotOverviewCard} ${isNewer ? styles.snapshotOverviewCardNew : styles.snapshotOverviewCardOld}`}>
                        {/* Version info card — same as single column */}
                        <div className={styles.currentVersionCard}>
                          <div className={styles.currentVersionRow}>
                            <span className={styles.currentVersionBadge}>{ver}</span>
                            <span className={styles.currentVersionLabel}>{isNewer ? '新版本' : '旧版本'}</span>
                            <span className={styles.currentVersionTs}>{ts}</span>
                          </div>
                          <div className={styles.currentVersionRow}>
                            <span className={styles.currentVersionMeta}>构建策略：{strategy}</span>
                            {llmModel && <span className={styles.currentVersionMeta}>LLM：{llmModel}</span>}
                            <span className={styles.currentVersionMeta}>NER：{snap.ner_model ?? 'zh_core_web_sm'}</span>
                          </div>
                        </div>
                        {/* Stats cards — same grid as single column */}
                        <div className={styles.overviewCardGrid}>
                          {[
                            { v: snap.node_count.toLocaleString(), k: '实体节点', accent: true },
                            { v: snap.edge_count.toLocaleString(), k: '关系边', accent: false },
                            { v: snap.semantic_edge_count.toLocaleString(), k: '语义关系', accent: false },
                            { v: snap.cooccur_edge_count?.toLocaleString() ?? '—', k: '共现关系', accent: false },
                            { v: snap.document_count, k: '覆盖文档', accent: false },
                          ].map(({ v, k, accent }) => (
                            <div key={k} className={styles.overviewCard}>
                              <div className={`${styles.overviewCardValue} ${accent ? styles.overviewCardValueAccent : ''}`}>{v}</div>
                              <div className={styles.overviewCardKey}>{k}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}

            {/* Single-column current graph overview — card style */}
            {(!diffV1 || !diffV2) && (
              <>
                {/* Single-column current graph overview — card style */}
                {snapshots.length > 0 && (() => {
                  // Show active version info, not necessarily the latest snapshot
                  const activeSnap = (activeVersion && snapshots.find(s => s.version === activeVersion))
                    ?? snapshots[0]
                  const nerShort = (activeSnap.ner_model ?? 'sm').replace('zh_core_web_', '')
                  const strategy = activeSnap.skip_llm ? `NER·${nerShort}` : `NER·${nerShort}+LLM`
                  const llmModel = !activeSnap.skip_llm ? (activeSnap.llm_model ?? '') : ''
                  const ts = new Date(activeSnap.timestamp).toLocaleString('zh-CN', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })
                  return (
                    <div className={styles.currentVersionCard}>
                      <div className={styles.currentVersionRow}>
                        <span className={styles.currentVersionBadge}>{activeSnap.version}</span>
                        <span className={styles.currentVersionLabel}>当前图谱版本</span>
                        <span className={styles.currentVersionTs}>{ts}</span>
                      </div>
                      <div className={styles.currentVersionRow}>
                        <span className={styles.currentVersionMeta}>构建策略：{strategy}</span>
                        {llmModel && <span className={styles.currentVersionMeta}>LLM：{llmModel}</span>}
                        <span className={styles.currentVersionMeta}>NER：{activeSnap.ner_model ?? 'zh_core_web_sm'}</span>
                      </div>
                    </div>
                  )
                })()}

                {/* Stats + Type distribution + Top relations — auto columns */}
                {(() => {
                  const hasTypes = overview.entity_type_stats.length > 0
                  const hasRelations = overview.top_relations.length > 0
                  const colCount = 1 + (hasTypes ? 1 : 0) + (hasRelations ? 1 : 0)
                  const colStyle = { gridTemplateColumns: `repeat(${colCount}, 1fr)` }
                  return (
                    <div className={styles.overviewThreeCols} style={colStyle}>
                      {/* Col 1: stat cards */}
                      <div className={styles.overviewThreeColCard}>
                        <div className={styles.overviewDefaultSectionTitle}>统计数据</div>
                        <div className={styles.overviewCardGridInner}>
                          {[
                            { v: overview.node_count.toLocaleString(), k: '实体节点', accent: true },
                            { v: overview.edge_count.toLocaleString(), k: '关系边', accent: false },
                            { v: overview.semantic_edge_count.toLocaleString(), k: '语义关系', accent: false },
                            { v: overview.cooccur_edge_count.toLocaleString(), k: '共现关系', accent: false },
                            { v: overview.document_count, k: '覆盖文档', accent: false },
                          ].map(({ v, k, accent }) => (
                            <div key={k} className={styles.overviewCard}>
                              <div className={`${styles.overviewCardValue} ${accent ? styles.overviewCardValueAccent : ''}`}>{v}</div>
                              <div className={styles.overviewCardKey}>{k}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Col 2: entity type distribution */}
                      {hasTypes && (
                        <div className={styles.overviewThreeColCard}>
                          <div className={styles.overviewDefaultSectionTitle}>实体类型分布</div>
                          <div className={styles.overviewThreeColScroll}>
                            {overview.entity_type_stats.map((s) => {
                              const pct = Math.round(s.count / overview.node_count * 100)
                              return (
                                <div key={s.type} className={styles.overviewDefaultRow}>
                                  <div className={styles.overviewDefaultDot} style={{ background: s.color }} />
                                  <span className={styles.overviewDefaultLabel}>{s.label}</span>
                                  <div className={styles.overviewDefaultTrack}>
                                    <div className={styles.overviewDefaultFill} style={{ width: `${pct}%`, background: s.color }} />
                                  </div>
                                  <span className={styles.overviewDefaultCount}>{s.count}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Col 3: top relations */}
                      {hasRelations && (
                        <div className={styles.overviewThreeColCard}>
                          <div className={styles.overviewDefaultSectionTitle}>高频语义关系</div>
                          <div className={styles.overviewThreeColScroll}>
                            {overview.top_relations.map((r) => (
                              <div key={r.relation} className={styles.overviewDefaultRelRow}>
                                <span className={styles.overviewDefaultRelName}>{r.relation}</span>
                                <span className={styles.overviewDefaultRelCount}>{r.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}

              </>
            )}

            {/* Entity categories inline — shown below stats when not diffing */}
            {(!diffV1 || !diffV2) && categories && (
              <div className={styles.categoriesInline}>
                {[
                  { badge: 'NER', badgeColor: 'rgba(99,102,241,0.15)', badgeText: 'var(--accent)', title: 'spaCy 命名实体识别', total: categories.ner_total, nodes: categories.ner_nodes },
                  { badge: 'LLM', badgeColor: 'rgba(148,163,184,0.15)', badgeText: '#94a3b8', title: '大模型关系抽取实体', total: categories.llm_total, nodes: categories.llm_nodes },
                ].map(({ badge, badgeColor, badgeText, title, total, nodes }) => (
                  <div key={badge} className={styles.categoriesInlineGroup}>
                    <div className={styles.categoryGroupHeader}>
                      <span className={styles.categoryGroupBadge} style={{ background: badgeColor, color: badgeText }}>{badge}</span>
                      <span className={styles.categoryGroupTitle}>{title}</span>
                      <span className={styles.categoryGroupCount}>{total} 个</span>
                    </div>
                    {nodes.map((cat) => {
                      const typeKey = badge === 'LLM' ? 'LLM' : cat.type
                      const isExpanded = expandedType === typeKey
                      return (
                        <div key={cat.type}>
                          <div
                            className={`${styles.categoryRow} ${isExpanded ? styles.categoryRowActive : ''}`}
                            onClick={() => handleTypeExpand(typeKey)}
                          >
                            <div className={styles.categoryDot} style={{ background: cat.color }} />
                            <span className={styles.categoryLabel}>{cat.label}</span>
                            <span className={styles.categoryType}>{cat.type}</span>
                            <span className={styles.categoryCount}>{cat.count}</span>
                            <span className={styles.categoryExpandIcon}>{isExpanded ? '▲' : '▼'}</span>
                          </div>
                          {isExpanded && (
                            <div className={styles.categoryDetail}>
                              {typeDetailLoading && typeDetail === null && (
                                <div className={styles.categoryDetailLoading}>加载中...</div>
                              )}
                              {typeDetail && (
                                <>
                                  <div className={styles.entityTable}>
                                    <div className={styles.entityTableHeader}>
                                      <span className={styles.entityTableCol}>实体名称</span>
                                      <span className={styles.entityTableColDeg}>度数</span>
                                      <span className={styles.entityTableColDoc}>来源文档</span>
                                    </div>
                                    {typeDetail.items.map((item) => (
                                      <div key={item.label} className={styles.entityTableRow} onClick={() => handleEntityClick(item.label)}>
                                        <span className={styles.entityTableName}>{item.label}</span>
                                        <span className={styles.entityTableDeg}>{item.degree}</span>
                                        <span className={styles.entityTableDoc}>
                                          {item.document_names.map((n, i) => (
                                            <span key={i} className={styles.entityTableDocTag} title={n}>{n}</span>
                                          ))}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                  {typeDetail.items.length < typeDetail.total && (
                                    <div className={styles.categoryLoadMore}>
                                      <span className={styles.categoryLoadMoreHint}>
                                        已显示 {typeDetail.items.length} / {typeDetail.total}
                                      </span>
                                      <button
                                        className={styles.categoryLoadMoreBtn}
                                        onClick={(e) => { e.stopPropagation(); loadMoreTypeDetail() }}
                                        disabled={typeDetailLoading}
                                      >
                                        {typeDetailLoading ? '加载中...' : '加载更多'}
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedDocId && !overview && (
          <div className={styles.empty}>搜索实体后点击结果，或选择左侧文档查看实体图谱</div>
        )}
        {selectedDocId && loading && (
          <div className={styles.empty}>加载中...</div>
        )}
        {selectedDocId && !loading && docGraphData?.nodes.length === 0 && (
          <div className={styles.empty}>该文档暂无图谱数据</div>
        )}
        {selectedDocId && !loading && !subgraphData && docGraphData && docGraphData.nodes.length > 0 && !showCategories && (
          <div className={styles.empty}>← 点击左侧实体展开关系图</div>
        )}
        {selectedDocId && !loading && subgraphData && !showCategories && (
          <>
            <div className={styles.subgraphHeader}>
              <span className={styles.subgraphTitle}>
                「{subgraphData.nodes[0]?.label ?? ''}」周边关系
              </span>
              <button className={styles.resetBtn} onClick={() => setSubgraphData(null)}>← 返回</button>
            </div>
            <GraphCanvas data={subgraphData} onNodeClick={handleEntityClick} />
          </>
        )}

        {/* Diff result view */}
        {diffResult && !showCategories && (
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
                value={diffSearch}
                onChange={e => setDiffSearch(e.target.value)}
              />
            </div>
            <div className={styles.diffBody}>
              <div className={styles.diffCol}>
                <div className={styles.diffColHeader}>新增实体 <span className={`${styles.diffColCount} ${styles.diffColCountAdded}`}>{filteredDiffNodes.added.length}</span></div>
                <div className={styles.diffColScroll}>
                  {filteredDiffNodes.added.map((n, i) => (
                    <div key={i} className={`${styles.diffNode} ${styles.diffNodeAdded}`} onClick={() => handleEntityClick(n.label)}>
                      <div className={styles.nodeTypeDot} style={{ background: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY }} />
                      <span className={styles.diffNodeLabel}>{n.label}</span>
                      <span className={styles.diffNodeType}>{n.type}</span>
                    </div>
                  ))}
                  {filteredDiffNodes.added.length === 0 && <div className={styles.empty}>无结果</div>}
                </div>
              </div>
              <div className={styles.diffColDivider} />
              <div className={styles.diffCol}>
                <div className={styles.diffColHeader}>删除实体 <span className={`${styles.diffColCount} ${styles.diffColCountRemoved}`}>{filteredDiffNodes.removed.length}</span></div>
                <div className={styles.diffColScroll}>
                  {filteredDiffNodes.removed.map((n, i) => (
                    <div key={i} className={`${styles.diffNode} ${styles.diffNodeRemoved}`}>
                      <div className={styles.nodeTypeDot} style={{ background: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY }} />
                      <span className={styles.diffNodeLabel}>{n.label}</span>
                      <span className={styles.diffNodeType}>{n.type}</span>
                    </div>
                  ))}
                  {filteredDiffNodes.removed.length === 0 && <div className={styles.empty}>无结果</div>}
                </div>
              </div>
              <div className={styles.diffColDivider} />
              <div className={styles.diffCol}>
                <div className={styles.diffColHeader}>不变实体 <span className={styles.diffColCountUnchanged}>{filteredDiffNodes.unchanged.length}</span></div>
                <div className={styles.diffColScroll}>
                  {filteredDiffNodes.unchanged.map((n, i) => (
                    <div key={i} className={`${styles.diffNode} ${styles.diffNodeUnchanged}`} onClick={() => handleEntityClick(n.label)}>
                      <div className={styles.nodeTypeDot} style={{ background: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY }} />
                      <span className={styles.diffNodeLabel}>{n.label}</span>
                      <span className={styles.diffNodeType}>{n.type}</span>
                    </div>
                  ))}
                  {filteredDiffNodes.unchanged.length === 0 && <div className={styles.empty}>无结果</div>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {modalEntity && (
        <GraphEntityModal entity={modalEntity} onClose={() => setModalEntity(null)} />
      )}

      {/* Graph update toast */}
      {graphUpdateToast && (
        <div className={styles.updateToast}>{graphUpdateToast}</div>
      )}
    </div>
  )
}
