import { useEffect, useRef, useState, useMemo } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { type GraphData, type GraphNode, type GraphOverview, type Document, getSubgraph, getGraphByDocument, getGraphOverview } from '../api/client'
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
  const [filterType, setFilterType] = useState<string>('ALL')
  const [loading, setLoading] = useState(false)
  const [overview, setOverview] = useState<GraphOverview | null>(null)

  useEffect(() => {
    getGraphOverview().then((r) => setOverview(r.data)).catch(console.error)
  }, [])

  useEffect(() => {
    setSubgraphData(null)
    if (!selectedDocId) { setDocGraphData(null); return }
    setLoading(true)
    getGraphByDocument(selectedDocId)
      .then((r) => setDocGraphData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedDocId])

  const handleEntityClick = async (label: string) => {
    try {
      const res = await getSubgraph(label, 2)
      setSubgraphData(res.data)
    } catch { /* entity not in graph */ }
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

  return (
    <div className={styles.wrapper}>
      {/* Left panel — docs + entity list only */}
      <div className={styles.panel}>
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
        {/* Overview banner — always visible at top of right area */}
        {overview && (
          <div className={styles.overviewBar}>
            <div className={styles.overviewStats}>
              {[
                { v: overview.node_count.toLocaleString(), k: '实体节点' },
                { v: overview.edge_count.toLocaleString(), k: '关系边' },
                { v: overview.semantic_edge_count.toLocaleString(), k: '语义关系' },
                { v: overview.document_count, k: '覆盖文档' },
              ].map(({ v, k }) => (
                <div key={k} className={styles.overviewStatItem}>
                  <span className={styles.overviewStatValue}>{v}</span>
                  <span className={styles.overviewStatKey}>{k}</span>
                </div>
              ))}
            </div>
            {overview.entity_type_stats.length > 0 && (
              <div className={styles.overviewTypeBars}>
                {overview.entity_type_stats.slice(0, 6).map((s) => {
                  const pct = Math.round(s.count / overview.node_count * 100)
                  return (
                    <div key={s.type} className={styles.overviewTypeItem} title={`${s.label}: ${s.count}`}>
                      <div className={styles.overviewTypeDot} style={{ background: s.color }} />
                      <span className={styles.overviewTypeLabel}>{s.label}</span>
                      <div className={styles.overviewTypeTrack}>
                        <div className={styles.overviewTypeFill} style={{ width: `${pct}%`, background: s.color }} />
                      </div>
                      <span className={styles.overviewTypeCount}>{s.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {overview.top_relations.length > 0 && (
              <div className={styles.overviewRelations}>
                <span className={styles.overviewRelLabel}>高频关系：</span>
                {overview.top_relations.slice(0, 5).map((r) => (
                  <span key={r.relation} className={styles.overviewRelTag}>
                    {r.relation} <span className={styles.overviewRelCount}>{r.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedDocId && (
          <div className={styles.empty}>← 选择左侧文档查看实体图谱</div>
        )}
        {selectedDocId && loading && (
          <div className={styles.empty}>加载中...</div>
        )}
        {selectedDocId && !loading && docGraphData?.nodes.length === 0 && (
          <div className={styles.empty}>该文档暂无图谱数据</div>
        )}
        {selectedDocId && !loading && subgraphData && (
          <>
            <div className={styles.subgraphHeader}>
              <span className={styles.subgraphTitle}>
                「{subgraphData.nodes.find(n => subgraphData.edges.some(e => e.source === n.id || e.target === n.id))?.label ?? subgraphData.nodes[0]?.label ?? ''}」关系图
              </span>
              <button className={styles.resetBtn} onClick={() => setSubgraphData(null)}>← 返回实体列表</button>
            </div>
            <GraphCanvas data={subgraphData} onNodeClick={handleEntityClick} />
          </>
        )}
        {selectedDocId && !loading && !subgraphData && docGraphData && docGraphData.nodes.length > 0 && (
          <div className={styles.empty}>← 点击左侧实体展开关系图</div>
        )}
      </div>
    </div>
  )
}
