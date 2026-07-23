/**
 * GraphOverviewPanel — right-side overview: version card, stat cols, entity categories
 */
import { useState } from 'react'
import {
  type GraphOverview, type GraphEntityCategories, type EntityTypePageResult,
  type GraphSnapshot, type GraphDiff,
  getEntitiesByType,
} from '../api/client'
import styles from './GraphViewer.module.css'

const TYPE_COLOR: Record<string, string> = {
  PERSON: '#a78bfa', ORG: '#60a5fa', GPE: '#34d399',
  PRODUCT: '#fb923c', LOC: '#f472b6', ENTITY: '#94a3b8',
}

interface Props {
  overview: GraphOverview
  categories: GraphEntityCategories | null
  snapshots: GraphSnapshot[]
  activeVersion: string | null
  diffV1: string | null
  diffV2: string | null
  diffResult: GraphDiff | null
  onEntityClick: (label: string) => void
}

export default function GraphOverviewPanel({
  overview, categories, snapshots, activeVersion, diffV1, diffV2, diffResult, onEntityClick,
}: Props) {
  const [expandedType, setExpandedType] = useState<string | null>(null)
  const [typeDetail, setTypeDetail] = useState<EntityTypePageResult | null>(null)
  const [typeDetailLoading, setTypeDetailLoading] = useState(false)

  const handleTypeExpand = async (typeKey: string) => {
    if (expandedType === typeKey) { setExpandedType(null); setTypeDetail(null); return }
    setExpandedType(typeKey)
    setTypeDetailLoading(true)
    setTypeDetail(null)
    try {
      const r = await getEntitiesByType(typeKey, 1, 50)
      setTypeDetail(r.data)
    } catch { /* ignore */ }
    finally { setTypeDetailLoading(false) }
  }

  const loadMore = async () => {
    if (!typeDetail || !expandedType) return
    setTypeDetailLoading(true)
    try {
      const r = await getEntitiesByType(expandedType, typeDetail.page + 1, 50)
      setTypeDetail(prev => prev ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data)
    } catch { /* ignore */ }
    finally { setTypeDetailLoading(false) }
  }

  const vn = (v: string) => parseInt(v.replace(/\D/g, ''), 10) || 0

  // --- version comparison multi-col ---
  const showMultiCol = !!(diffV1 && diffV2)
  const sortedVersions = showMultiCol
    ? (vn(diffV1!) <= vn(diffV2!) ? [diffV1!, diffV2!] : [diffV2!, diffV1!])
    : []

  // --- single-col active snap ---
  const activeSnap = (activeVersion && snapshots.find(s => s.version === activeVersion)) ?? snapshots[0]

  const hasTypes = overview.entity_type_stats.length > 0
  const hasRelations = overview.top_relations.length > 0
  const colCount = 1 + (hasTypes ? 1 : 0) + (hasRelations ? 1 : 0)

  return (
    <div className={styles.overviewDefault}>
      {/* Multi-col version comparison */}
      {showMultiCol && (
        <div className={styles.overviewMultiCol}>
          {sortedVersions.map((ver, idx) => {
            const snap = snapshots.find(s => s.version === ver)
            if (!snap) return null
            const isNewer = idx === 1
            const nerShort = (snap.ner_model ?? 'sm').replace('zh_core_web_', '')
            const strategyLabel = snap.strategy
              ? snap.strategy
              : snap.skip_llm ? `NER·${nerShort}` : `NER·${nerShort}+LLM`
            const llmModel = !snap.skip_llm ? (snap.llm_model ?? '') : ''
            const ts = new Date(snap.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
            return (
              <div key={ver} className={`${styles.snapshotOverviewCard} ${isNewer ? styles.snapshotOverviewCardNew : styles.snapshotOverviewCardOld}`}>
                <div className={styles.currentVersionCard}>
                  <div className={styles.currentVersionRow}>
                    <span className={styles.currentVersionBadge}>{ver}</span>
                    <span className={styles.currentVersionLabel}>{isNewer ? '新版本' : '旧版本'}</span>
                    <span className={styles.currentVersionTs}>{ts}</span>
                  </div>
                  <div className={styles.currentVersionRow}>
                    <span className={styles.currentVersionMeta}>构建策略：{strategyLabel}</span>
                    {llmModel && <span className={styles.currentVersionMeta}>LLM：{llmModel}</span>}
                    <span className={styles.currentVersionMeta}>NER：{snap.ner_model ?? 'zh_core_web_sm'}</span>
                  </div>
                </div>
                <div className={styles.overviewCardGridInner}>
                  {[
                    { v: snap.node_count.toLocaleString(), k: '实体节点', accent: true },
                    { v: snap.edge_count.toLocaleString(), k: '关系边', accent: false },
                    { v: snap.semantic_edge_count.toLocaleString(), k: '语义关系', accent: false },
                    { v: (snap.cooccur_edge_count ?? 0).toLocaleString(), k: '共现关系', accent: false },
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
          })}
        </div>
      )}

      {/* Single-col view */}
      {(!diffV1 || !diffV2) && (
        <>
          {activeSnap && (
            <div className={styles.currentVersionCard}>
              <div className={styles.currentVersionRow}>
                <span className={styles.currentVersionBadge}>{activeSnap.version}</span>
                <span className={styles.currentVersionLabel}>当前图谱版本</span>
                <span className={styles.currentVersionTs}>
                  {new Date(activeSnap.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className={styles.currentVersionRow}>
                {(() => {
                  const nerShort = (activeSnap.ner_model ?? 'sm').replace('zh_core_web_', '')
                  const strategyLabel = activeSnap.strategy
                    ? activeSnap.strategy
                    : activeSnap.skip_llm ? `NER·${nerShort}` : `NER·${nerShort}+LLM`
                  const llmModel = !activeSnap.skip_llm ? (activeSnap.llm_model ?? '') : ''
                  return <>
                    <span className={styles.currentVersionMeta}>构建策略：{strategyLabel}</span>
                    {llmModel && <span className={styles.currentVersionMeta}>LLM：{llmModel}</span>}
                    <span className={styles.currentVersionMeta}>NER：{activeSnap.ner_model ?? 'zh_core_web_sm'}</span>
                  </>
                })()}
              </div>
            </div>
          )}

          <div className={styles.overviewThreeCols} style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
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

            {hasTypes && (
              <div className={styles.overviewThreeColCard}>
                <div className={styles.overviewDefaultSectionTitle}>实体类型分布</div>
                <div className={styles.overviewThreeColScroll}>
                  {overview.entity_type_stats.map(s => {
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

            {hasRelations && (
              <div className={styles.overviewThreeColCard}>
                <div className={styles.overviewDefaultSectionTitle}>高频语义关系</div>
                <div className={styles.overviewThreeColScroll}>
                  {overview.top_relations.map(r => (
                    <div key={r.relation} className={styles.overviewDefaultRelRow}>
                      <span className={styles.overviewDefaultRelName}>{r.relation}</span>
                      <span className={styles.overviewDefaultRelCount}>{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {categories && (
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
                  {nodes.map(cat => {
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
                            {typeDetailLoading && !typeDetail && <div className={styles.categoryDetailLoading}>加载中...</div>}
                            {typeDetail && (
                              <>
                                <div className={styles.entityTable}>
                                  <div className={styles.entityTableHeader}>
                                    <span className={styles.entityTableCol}>实体名称</span>
                                    <span className={styles.entityTableColDeg}>度数</span>
                                    <span className={styles.entityTableColDoc}>来源文档</span>
                                  </div>
                                  {typeDetail.items.map(item => (
                                    <div key={item.label} className={styles.entityTableRow} onClick={() => onEntityClick(item.label)}>
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
                                  <div
                                    className={`${styles.categoryLoadMore} ${typeDetailLoading ? styles.categoryLoadMoreLoading : ''}`}
                                    onClick={e => { e.stopPropagation(); if (!typeDetailLoading) loadMore() }}
                                  >
                                    <span className={styles.categoryLoadMoreCenter}>
                                      {typeDetailLoading
                                        ? '加载中...'
                                        : `加载更多（已显示 ${typeDetail.items.length} / ${typeDetail.total}）`}
                                    </span>
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
        </>
      )}
    </div>
  )
}
