import { useEffect, useRef, useState, useMemo } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import {
  type GraphData, type GraphNode, type GraphOverview, type GraphSearchResult,
  type GraphEntityCategories, type EntityCategoryStats, type EntityDetail, type EntityTypePageResult, type Document,
  getSubgraph, getGraphByDocument, getGraphOverview, getGraphEntityCategories, getEntitiesByType, searchGraphEntities
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
  const [showCategories, setShowCategories] = useState(false)
  const [expandedType, setExpandedType] = useState<string | null>(null)
  const [typeDetail, setTypeDetail] = useState<EntityTypePageResult | null>(null)
  const [typeDetailLoading, setTypeDetailLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<GraphSearchResult | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    getGraphOverview().then((r) => setOverview(r.data)).catch(console.error)
    getGraphEntityCategories().then((r) => setCategories(r.data)).catch(console.error)
  }, [])

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

  return (
    <div className={styles.wrapper}>
      {/* Left panel — docs + entity list only */}
      <div className={styles.panel}>
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
                {categories && (
                  <button
                    className={`${styles.categoriesToggleBtn} ${showCategories ? styles.categoriesToggleBtnActive : ''}`}
                    onClick={() => setShowCategories(v => !v)}
                  >
                    实体分类
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Entity categories panel — shown alongside content, not blocking it */}
        {categories && showCategories && (
          <div className={styles.categoriesPanel}>
            <div className={styles.categoriesHeader}>
              <span className={styles.categoriesTitle}>实体来源分类</span>
              <button className={styles.categoriesClose} onClick={() => { setShowCategories(false); setExpandedType(null); setTypeDetail(null) }}>✕</button>
            </div>
            <div className={styles.categoriesBody}>
              {[
                { badge: 'NER', badgeColor: 'rgba(99,102,241,0.15)', badgeText: 'var(--accent)', title: 'spaCy 命名实体识别', total: categories.ner_total, nodes: categories.ner_nodes },
                { badge: 'LLM', badgeColor: 'rgba(148,163,184,0.15)', badgeText: '#94a3b8', title: '大模型关系抽取实体', total: categories.llm_total, nodes: categories.llm_nodes },
              ].map(({ badge, badgeColor, badgeText, title, total, nodes }) => (
                <div key={badge} className={styles.categoryGroup}>
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
          </div>
        )}

        {!selectedDocId && !showCategories && (
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
      </div>

      {modalEntity && (
        <GraphEntityModal entity={modalEntity} onClose={() => setModalEntity(null)} />
      )}
    </div>
  )
}
