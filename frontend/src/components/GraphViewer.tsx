import { useEffect, useRef, useState, useMemo } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import {
  type GraphData, type GraphNode, type GraphOverview,
  type GraphEntityCategories, type Document,
  type GraphSnapshot, type GraphDiff, type GraphSearchResult,
  getSubgraph, getGraphByDocument, getGraphOverview, getGraphEntityCategories,
  getGraphSnapshots, getGraphDiff, graphEventsUrl,
} from '../api/client'
import GraphEntityModal from './GraphEntityModal'
import GraphSnapshotPanel from './GraphSnapshotPanel'
import GraphOverviewPanel from './GraphOverviewPanel'
import GraphDiffPanel from './GraphDiffPanel'
import styles from './GraphViewer.module.css'

interface Props {
  docs: Document[]
}

const TYPE_COLOR: Record<string, string> = {
  PERSON: '#a78bfa', ORG: '#60a5fa', GPE: '#34d399',
  PRODUCT: '#fb923c', LOC: '#f472b6', ENTITY: '#94a3b8',
}
const TYPE_LABEL: Record<string, string> = {
  PERSON: '人物', ORG: '组织', GPE: '地点', PRODUCT: '产品', LOC: '位置', ENTITY: '实体',
}

// ── Internal Cytoscape canvas ────────────────────────────────────────────────
function GraphCanvas({ data, onNodeClick }: { data: GraphData; onNodeClick: (label: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.nodes.length === 0) return
    const elements = [
      ...data.nodes.map(n => ({ data: { id: n.id, label: n.label, type: n.type, color: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY } })),
      ...data.edges.map(e => ({ data: { id: e.id, source: e.source, target: e.target, label: e.relation, weight: e.weight } })),
    ]
    if (cyRef.current) cyRef.current.destroy()
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        { selector: 'node', style: { 'background-color': 'data(color)', label: 'data(label)', 'font-size': 11, 'font-family': 'Inter, sans-serif', 'font-weight': '500', color: '#fff', 'text-valign': 'center', 'text-outline-width': 2, 'text-outline-color': 'data(color)', width: 40, height: 40, 'border-width': 0 } },
        { selector: 'edge', style: { width: 1.2, 'line-color': '#4f52d9', 'line-opacity': 0.5, 'target-arrow-color': '#6366f1', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'curve-style': 'bezier', label: 'data(label)', 'font-size': 9, 'font-family': 'Inter, sans-serif', color: '#8080a8', 'text-rotation': 'autorotate', 'text-background-color': '#1a1a2e', 'text-background-opacity': 0.75, 'text-background-padding': '2px' } },
        { selector: 'node:hover', style: { 'border-width': 2, 'border-color': '#fff', 'border-opacity': 0.6 } },
      ],
      layout: { name: 'cose', animate: true, animationDuration: 400, nodeRepulsion: () => 4500, idealEdgeLength: () => 90, fit: true, padding: 40 } as any,
    })
    cy.on('tap', 'node', evt => onNodeClick(evt.target.data('label')))
    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null }
  }, [data])

  const usedTypes = [...new Set(data.nodes.map(n => n.type))]
  return (
    <div className={styles.canvasWrapper}>
      <div className={styles.canvasStats}>节点 {data.nodes.length} · 边 {data.edges.length}</div>
      <div ref={containerRef} className={styles.canvas} />
      <div className={styles.legend}>
        {usedTypes.map(t => (
          <div key={t} className={styles.legendItem}>
            <div className={styles.legendDot} style={{ background: TYPE_COLOR[t] ?? TYPE_COLOR.ENTITY }} />
            {TYPE_LABEL[t] ?? t}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function GraphViewer({ docs }: Props) {
  // Doc / entity state
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [docGraphData, setDocGraphData] = useState<GraphData | null>(null)
  const [subgraphData, setSubgraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState('ALL')
  const [modalEntity, setModalEntity] = useState<string | null>(null)

  // Overview state
  const [overview, setOverview] = useState<GraphOverview | null>(null)
  const [categories, setCategories] = useState<GraphEntityCategories | null>(null)

  // Snapshot / diff state
  const [snapshots, setSnapshots] = useState<GraphSnapshot[]>([])
  const [activeVersion, setActiveVersion] = useState<string | null>(null)
  const [diffV1, setDiffV1] = useState<string | null>(null)
  const [diffV2, setDiffV2] = useState<string | null>(null)
  const [diffResult, setDiffResult] = useState<GraphDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  // Search
  const [searchResult, setSearchResult] = useState<GraphSearchResult | null>(null)
  const [searching, setSearching] = useState(false)

  // Toast
  const [toast, setToast] = useState<string | null>(null)

  const esRef = useRef<EventSource | null>(null)

  // ── Data loading ────────────────────────────────────────────────────────
  const refreshOverview = () => {
    getGraphOverview().then(r => setOverview(r.data)).catch(console.error)
    getGraphEntityCategories().then(r => setCategories(r.data)).catch(console.error)
  }

  const refreshAll = () => {
    refreshOverview()
    getGraphSnapshots().then(r => setSnapshots(r.data)).catch(console.error)
    fetch('/api/v1/graph/current-version')
      .then(r => r.json())
      .then(d => setActiveVersion(d.version))
      .catch(console.error)
  }

  useEffect(() => {
    refreshAll()
    const es = new EventSource(graphEventsUrl())
    esRef.current = es
    es.onmessage = event => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'graph_updated') {
          refreshAll()
          setDocGraphData(null)
          setSubgraphData(null)
          setDiffResult(null)
          setDiffV1(null)
          setDiffV2(null)
          setToast(`图谱已更新，已加载 ${data.version}`)
          setTimeout(() => setToast(null), 4000)
        }
      } catch { /* ignore */ }
    }
    return () => { es.close(); esRef.current = null }
  }, [])

  useEffect(() => {
    setSubgraphData(null)
    if (!selectedDocId) { setDocGraphData(null); return }
    setLoading(true)
    getGraphByDocument(selectedDocId)
      .then(r => setDocGraphData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedDocId])

  // ── Diff helpers ────────────────────────────────────────────────────────
  const toggleDiffVersion = (v: string) => {
    if (diffV1 === v) { setDiffV1(null); return }
    if (diffV2 === v) { setDiffV2(null); return }
    if (!diffV1) { setDiffV1(v); return }
    if (!diffV2) { setDiffV2(v); return }
    setDiffV1(diffV2); setDiffV2(v)
  }

  const runDiff = async () => {
    if (!diffV1 || !diffV2) return
    setDiffLoading(true)
    setDiffResult(null)
    const vn = (s: string) => parseInt(s.replace(/\D/g, ''), 10) || 0
    const [lo, hi] = vn(diffV1) <= vn(diffV2) ? [diffV1, diffV2] : [diffV2, diffV1]
    try {
      const r = await getGraphDiff(lo, hi)
      setDiffResult(r.data)
    } catch (e) { console.error(e) }
    finally { setDiffLoading(false) }
  }

  const clearDiff = () => {
    setDiffResult(null)
    setDiffV1(null)
    setDiffV2(null)
  }

  // ── Entity & doc helpers ────────────────────────────────────────────────
  const handleEntityClick = async (label: string) => setModalEntity(label)

  const indexedDocs = docs.filter(d => d.status === 'indexed')

  const entities = useMemo<GraphNode[]>(() => {
    if (!docGraphData) return []
    const nodes = filterType === 'ALL' ? docGraphData.nodes : docGraphData.nodes.filter(n => n.type === filterType)
    return [...nodes].sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  }, [docGraphData, filterType])

  const groupedEntities = useMemo(() => {
    const groups: Record<string, GraphNode[]> = {}
    entities.forEach(n => {
      const t = n.type ?? 'ENTITY'
      if (!groups[t]) groups[t] = []
      groups[t].push(n)
    })
    return groups
  }, [entities])

  const usedTypes = useMemo(() => [...new Set((docGraphData?.nodes ?? []).map(n => n.type))], [docGraphData])

  const showOverview = !selectedDocId && overview !== null
  const showDiff = !!diffResult

  return (
    <div className={styles.wrapper}>
      {/* ── Left panel ── */}
      <div className={styles.panel}>
        <GraphSnapshotPanel
          snapshots={snapshots}
          activeVersion={activeVersion}
          diffV1={diffV1}
          diffV2={diffV2}
          diffLoading={diffLoading}
          diffResult={diffResult}
          searchResult={searchResult}
          searching={searching}
          onSnapshotsChange={setSnapshots}
          onActiveVersionChange={v => { setActiveVersion(v); refreshOverview() }}
          onToggleDiffVersion={toggleDiffVersion}
          onRunDiff={runDiff}
          onClearDiff={clearDiff}
          onEntityClick={handleEntityClick}
          onSearchResultChange={setSearchResult}
          onSearchingChange={setSearching}
        />

        {/* Doc list */}
        <div className={styles.panelSection}>
          <div className={styles.panelLabel}>文档</div>
          {indexedDocs.length === 0 && <div className={styles.panelEmpty}>暂无已索引文档</div>}
          {indexedDocs.map(doc => (
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
              {usedTypes.map(t => (
                <button
                  key={t}
                  className={`${styles.typeBtn} ${filterType === t ? styles.typeBtnActive : ''}`}
                  style={filterType === t ? { borderColor: TYPE_COLOR[t], color: TYPE_COLOR[t] } : {}}
                  onClick={() => setFilterType(t)}
                >
                  {TYPE_LABEL[t] ?? t} {docGraphData.nodes.filter(n => n.type === t).length}
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
                  {nodes.map(n => (
                    <div
                      key={n.id}
                      className={`${styles.entityItem} ${subgraphData?.nodes.some(sn => sn.id === n.id) ? styles.entityItemActive : ''}`}
                      onClick={() => handleEntityClick(n.label)}
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

      {/* ── Right content ── */}
      <div className={styles.content}>
        {/* Overview */}
        {showOverview && (
          <GraphOverviewPanel
            overview={overview!}
            categories={categories}
            snapshots={snapshots}
            activeVersion={activeVersion}
            diffV1={diffV1}
            diffV2={diffV2}
            diffResult={diffResult}
            onEntityClick={handleEntityClick}
          />
        )}

        {/* Diff */}
        {showDiff && (
          <GraphDiffPanel
            diffResult={diffResult!}
            onEntityClick={handleEntityClick}
          />
        )}

        {/* Doc states */}
        {selectedDocId && loading && <div className={styles.empty}>加载中...</div>}
        {selectedDocId && !loading && docGraphData?.nodes.length === 0 && (
          <div className={styles.empty}>该文档暂无图谱数据</div>
        )}
        {selectedDocId && !loading && !subgraphData && docGraphData && docGraphData.nodes.length > 0 && (
          <div className={styles.empty}>← 点击左侧实体展开关系图</div>
        )}
        {selectedDocId && !loading && subgraphData && (
          <>
            <div className={styles.subgraphHeader}>
              <span className={styles.subgraphTitle}>「{subgraphData.nodes[0]?.label ?? ''}」周边关系</span>
              <button className={styles.resetBtn} onClick={() => setSubgraphData(null)}>← 返回</button>
            </div>
            <GraphCanvas data={subgraphData} onNodeClick={handleEntityClick} />
          </>
        )}

        {!selectedDocId && !overview && (
          <div className={styles.empty}>搜索实体后点击结果，或选择左侧文档查看实体图谱</div>
        )}
      </div>

      {modalEntity && (
        <GraphEntityModal entity={modalEntity} onClose={() => setModalEntity(null)} />
      )}
      {toast && <div className={styles.updateToast}>{toast}</div>}
    </div>
  )
}
