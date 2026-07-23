import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  type DebugResult, type DebugHit, type MatchedGraphNode,
  type DebugRecordSummary, type DebugRecord,
  debugQueryStream, getDebugRecords, getDebugRecord, deleteDebugRecord
} from '../api/client'
import { useSidebar } from '../context/SidebarContext'
import GraphEntityModal from './GraphEntityModal'
import styles from './DebugPage.module.css'

const TYPE_COLOR: Record<string, string> = {
  PERSON: '#a78bfa', ORG: '#60a5fa', GPE: '#34d399',
  PRODUCT: '#fb923c', LOC: '#f472b6', ENTITY: '#94a3b8',
}
const REASON_LABEL: Record<string, string> = {
  ner: 'spaCy', fuzzy: '关键词', graph_neighbor: '图谱邻居',
}
const REASON_COLOR: Record<string, string> = {
  ner: 'var(--accent)', fuzzy: '#f59e0b', graph_neighbor: '#94a3b8',
}

function HitCard({ hit }: { hit: DebugHit }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={styles.hitCard}>
      <div className={styles.hitHeader} onClick={() => setExpanded(v => !v)}>
        <span className={`${styles.hitBadge} ${hit.source === 'graph' ? styles.hitBadgeGraph : ''}`}>
          {hit.source === 'graph' ? '图谱' : '向量'}
        </span>
        <span className={styles.hitScore}>
          {hit.source === 'graph' ? '图谱扩展' : `${(hit.score * 100).toFixed(1)}%`}
        </span>
        <span className={styles.hitFile}>{hit.filename}</span>
        {hit.page != null && <span className={styles.hitPage}>p{hit.page}</span>}
        <span className={styles.hitChunk}>#{hit.chunk_index + 1}</span>
        <span className={styles.hitToggle}>{expanded ? '▲' : '▼'}</span>
      </div>
      {hit.heading && <div className={styles.hitHeading}>{hit.heading}</div>}
      {expanded && <div className={styles.hitExcerpt}>{hit.excerpt}</div>}
    </div>
  )
}

function NodeRow({ node, onEntityClick }: { node: MatchedGraphNode; onEntityClick: (label: string) => void }) {
  // Parse "kw → node_label" format from fuzzy matched_by
  const [kwPart, nodePart] = node.matched_by?.includes(' → ')
    ? node.matched_by.split(' → ')
    : [node.matched_by, '']

  const matchDetail = () => {
    if (node.match_reason === 'ner') {
      // NER: matched_by is the NER entity extracted from question
      return kwPart && kwPart !== node.label
        ? <span>问题实体 <strong>「{kwPart}」</strong> → 命中节点 <strong>「{node.label}」</strong></span>
        : <span>问题实体 <strong>「{node.label}」</strong> 直接命中</span>
    }
    if (node.match_reason === 'fuzzy') {
      // fuzzy: kwPart=keyword, nodePart=node_label (or just kwPart if same)
      return nodePart
        ? <span>关键词 <strong>「{kwPart}」</strong> → 模糊匹配 <strong>「{nodePart}」</strong></span>
        : <span>关键词 <strong>「{kwPart}」</strong> 直接命中</span>
    }
    if (node.match_reason === 'graph_neighbor') {
      return node.matched_by
        ? <span>节点 <strong>「{node.matched_by}」</strong> 的邻居</span>
        : null
    }
    return null
  }

  return (
    <div className={`${styles.nodeRow} ${styles.nodeRowClickable}`} onClick={() => onEntityClick(node.label)}>
      <div className={styles.nodeTypeDot} style={{ background: TYPE_COLOR[node.type] ?? TYPE_COLOR.ENTITY }} />
      <div className={styles.nodeInfo}>
        <div className={styles.nodeMain}>
          <span className={styles.nodeLabel}>{node.label}</span>
          <span className={styles.nodeType}>{node.type}</span>
          <span className={styles.nodeDeg} title="该实体在图谱中的连接边数，度越高表示关联关系越丰富">度{node.degree}</span>
          <span className={styles.nodeReason} style={{ color: REASON_COLOR[node.match_reason] }}>
            {REASON_LABEL[node.match_reason]}
          </span>
        </div>
        <div className={styles.nodeMatchedBy}>{matchDetail()}</div>
      </div>
    </div>
  )
}

interface DebugPageProps {
  records: DebugRecordSummary[]
  selectedRecordId: string | null
  onSelectRecord: (id: string) => void
  onDeleteRecord: (id: string, e: React.MouseEvent) => void
}

export function DebugSidebarList({ records, selectedRecordId, onSelectRecord, onDeleteRecord }: DebugPageProps) {
  return (
    <div className={styles.historySidebar}>
      <div className={styles.historyHeader}>调试历史 <span className={styles.historyCount}>{records.length}</span></div>
      <div className={styles.historyList}>
        {records.length === 0 && <div className={styles.historyEmpty}>暂无记录</div>}
        {records.map(r => {
          const nerShort = (r.graph_ner_model ?? 'sm').replace('zh_core_web_', '')
          const strategy = r.graph_strategy || (r.graph_ner_model ? `NER·${nerShort}+LLM` : 'ner_llm')
          const llmShort = (r.qa_llm_model ?? '').split(/[\s/-]/).pop() ?? ''
          const ts = new Date(r.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          return (
            <div
              key={r.id}
              className={`${styles.historyItem} ${selectedRecordId === r.id ? styles.historyItemActive : ''}`}
              onClick={() => onSelectRecord(r.id)}
            >
              <div className={styles.historyItemQ}>{r.question.slice(0, 22)}{r.question.length > 22 ? '…' : ''}</div>
              <div className={styles.historyItemMeta}>
                <span className={styles.historyVerBadge}>{r.graph_version}</span>
                <span className={styles.historyStrategy}>{strategy}</span>
                <span className={styles.historyLlm}>{llmShort}</span>
              </div>
              <div className={styles.historyItemTs}>{ts}</div>
              <button className={styles.historyDel} onClick={(e) => onDeleteRecord(r.id, e)} title="删除">×</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DebugPage({ isActive = true }: { isActive?: boolean }) {
  const { setSidebarContent } = useSidebar()
  const [question, setQuestion] = useState('')
  const [topK, setTopK] = useState(5)
  const [loading, setLoading] = useState(false)
  const [retrieval, setRetrieval] = useState<Omit<DebugResult, 'answer_with_graph' | 'answer_without_graph'> | null>(null)
  const [answerWith, setAnswerWith] = useState('')
  const [answerWithout, setAnswerWithout] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalEntity, setModalEntity] = useState<string | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  // Version meta from done event
  const [sessionMeta, setSessionMeta] = useState<{
    graph_version: string; graph_ner_model: string; graph_llm_model: string | null
    graph_strategy: string; qa_llm_model: string; record_id: string
  } | null>(null)

  // History — self-contained, sidebar injected via Context
  const [records, setRecords] = useState<DebugRecordSummary[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [recordDetail, setRecordDetail] = useState<DebugRecord | null>(null)

  const loadRecords = useCallback(async () => {
    try { const r = await getDebugRecords(); setRecords(r.data) } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadRecords() }, [loadRecords])

  // Use a ref so the sidebar's onClick always calls the latest version
  // without needing to re-inject the sidebar on every render
  const selectRecordRef = useRef<(id: string) => void>(() => {})

  const selectRecord = useCallback(async (id: string) => {
    setSelectedRecordId(id)
    try {
      const r = await getDebugRecord(id)
      setRecordDetail(r.data)
      setRetrieval({
        question: r.data.question,
        ner_entities: r.data.ner_entities,
        fuzzy_entities: r.data.fuzzy_entities,
        matched_graph_nodes: r.data.matched_graph_nodes,
        graph_paths: r.data.graph_paths,
        vector_hits: r.data.vector_hits,
        graph_hits: r.data.graph_hits,
        final_hits: [...r.data.vector_hits, ...r.data.graph_hits],
        context_with_graph: r.data.context_with_graph,
        context_without_graph: r.data.context_without_graph,
        system_prompt: r.data.system_prompt,
      })
      setAnswerWith(r.data.answer_with_graph)
      setAnswerWithout(r.data.answer_without_graph)
      setDone(true)
      setSessionMeta({
        graph_version: r.data.graph_version,
        graph_ner_model: r.data.graph_ner_model,
        graph_llm_model: r.data.graph_llm_model,
        graph_strategy: r.data.graph_strategy,
        qa_llm_model: r.data.qa_llm_model,
        record_id: r.data.id,
      })
    } catch { /* ignore */ }
  }, [])

  // Keep ref in sync with latest function
  useEffect(() => { selectRecordRef.current = selectRecord }, [selectRecord])

  const handleDeleteRecord = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteDebugRecord(id).catch(() => {})
    setRecords(prev => prev.filter(r => r.id !== id))
    if (selectedRecordId === id) {
      setSelectedRecordId(null)
      setRecordDetail(null)
      setRetrieval(null)
      setAnswerWith('')
      setAnswerWithout('')
      setSessionMeta(null)
    }
  }

  const run = () => {
    if (!question.trim()) return
    if (esRef.current) esRef.current.close()

    setLoading(true)
    setError(null)
    setRetrieval(null)
    setAnswerWith('')
    setAnswerWithout('')
    setDone(false)
    setSessionMeta(null)
    setSelectedRecordId(null)
    setRecordDetail(null)

    const url = debugQueryStream(question.trim(), topK)
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'retrieval') {
          setRetrieval({
            question: question.trim(),
            ner_entities: data.ner_entities,
            fuzzy_entities: data.fuzzy_entities,
            matched_graph_nodes: data.matched_graph_nodes,
            graph_paths: data.graph_paths,
            vector_hits: data.vector_hits,
            graph_hits: data.graph_hits,
            final_hits: [...data.vector_hits, ...data.graph_hits],
            context_with_graph: data.context_with_graph ?? '',
            context_without_graph: data.context_without_graph ?? '',
            system_prompt: data.system_prompt ?? '',
          })
          setLoading(false)
        } else if (data.type === 'token') {
          if (data.label === 'with_graph') setAnswerWith(prev => prev + data.token)
          else setAnswerWithout(prev => prev + data.token)
        } else if (data.type === 'done') {
          setDone(true)
          es.close()
          if (data.record_id) {
            setSessionMeta({
              graph_version: data.graph_version ?? '',
              graph_ner_model: data.graph_ner_model ?? '',
              graph_llm_model: data.graph_llm_model ?? null,
              graph_strategy: data.graph_strategy ?? '',
              qa_llm_model: data.qa_llm_model ?? '',
              record_id: data.record_id,
            })
            loadRecords()
          }
        }
      } catch { /* parse error */ }
    }

    es.onerror = () => {
      setError('连接错误，请检查后端服务')
      setLoading(false)
      es.close()
    }
  }

  useEffect(() => () => { esRef.current?.close() }, [])

  // Inject sidebar — only once when active (uses ref to avoid stale closure)
  useEffect(() => {
    if (!isActive) return
    setSidebarContent(
      <DebugSidebarList
        records={records}
        selectedRecordId={selectedRecordId}
        onSelectRecord={id => selectRecordRef.current(id)}
        onDeleteRecord={async (id, e) => {
          e.stopPropagation()
          await deleteDebugRecord(id).catch(() => {})
          setRecords(prev => prev.filter(r => r.id !== id))
          if (selectedRecordId === id) { setSelectedRecordId(null); setRecordDetail(null); setRetrieval(null); setAnswerWith(''); setAnswerWithout(''); setSessionMeta(null) }
        }}
      />
    )
    return () => setSidebarContent(null)
  }, [isActive, records, selectedRecordId])

  return (
    <div className={styles.page}>
      <div className={styles.mainArea} style={{ flex: 1 }}>
        {/* Input */}
        <div className={styles.inputArea}>
        <input
          className={styles.questionInput}
          placeholder="输入问题，分析检索过程并对比图谱增强效果..."
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
        />
        <div className={styles.inputControls}>
          <label className={styles.controlLabel}>
            Top-K
            <input
              type="number" min={1} max={20}
              className={styles.topKInput}
              value={topK}
              onChange={e => setTopK(Number(e.target.value))}
            />
          </label>
          <button className={styles.runBtn} onClick={run} disabled={loading || !question.trim()}>
            {loading ? '分析中...' : '分析'}
          </button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
        {/* Version meta banner */}
        {sessionMeta && (
          <div className={styles.metaBanner}>
            <span className={styles.metaItem}>图谱 <strong>{sessionMeta.graph_version}</strong></span>
            <span className={styles.metaSep}>·</span>
            <span className={styles.metaItem}>{sessionMeta.graph_strategy || (sessionMeta.graph_ner_model ? `NER·${(sessionMeta.graph_ner_model ?? 'sm').replace('zh_core_web_', '')}+LLM` : 'ner_llm')}</span>
            {sessionMeta.graph_llm_model && (
              <><span className={styles.metaSep}>·</span><span className={styles.metaItem}>图谱LLM {sessionMeta.graph_llm_model}</span></>
            )}
            <span className={styles.metaSep}>·</span>
            <span className={styles.metaItem}>问答 {sessionMeta.qa_llm_model}</span>
          </div>
        )}
      </div>

      {loading && !retrieval && (
        <div className={styles.placeholder}>检索中...</div>
      )}

      {retrieval && (
        <div className={styles.body}>
          {/* Top: retrieval process */}
          <div className={styles.retrievalRow}>
            {/* Graph process */}
            <div className={styles.retrievalCol}>
              <div className={styles.colHeader}>图谱检索过程</div>
              <div className={styles.colScroll}>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>NER 实体
                    <span className={styles.sectionHint}>spaCy 从问题中识别的命名实体</span>
                  </div>
                  {retrieval.ner_entities.length === 0
                    ? <div className={styles.empty}>未识别到命名实体</div>
                    : retrieval.ner_entities.map(e => (
                      <span key={e} className={styles.pill} style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent)' }}>
                        {e} <span className={styles.pillTag}>spaCy</span>
                      </span>
                    ))}
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>关键词匹配
                    <span className={styles.sectionHint}>问题分词后模糊匹配到的图谱节点</span>
                  </div>
                  {retrieval.fuzzy_entities.length === 0
                    ? <div className={styles.empty}>{retrieval.ner_entities.length > 0 ? 'NER 已命中' : '无匹配'}</div>
                    : retrieval.fuzzy_entities.map(e => (
                      <span key={e} className={styles.pill} style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                        {e} <span className={styles.pillTag}>关键词</span>
                      </span>
                    ))}
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    命中节点
                    <span className={styles.sectionHint}>「度」= 图谱中的连接数，越高关联越丰富</span>
                    <span className={styles.count}>{retrieval.matched_graph_nodes.filter(n => n.match_reason !== 'graph_neighbor').length}命中+{retrieval.matched_graph_nodes.filter(n => n.match_reason === 'graph_neighbor').length}邻居</span>
                  </div>
                  {retrieval.matched_graph_nodes.length === 0
                    ? <div className={styles.empty}>无命中</div>
                    : (() => {
                        // Group: each hit node followed by its neighbors
                        const groups: Array<{ hit: MatchedGraphNode; neighbors: MatchedGraphNode[] }> = []
                        let current: { hit: MatchedGraphNode; neighbors: MatchedGraphNode[] } | null = null
                        for (const n of retrieval.matched_graph_nodes) {
                          if (n.match_reason !== 'graph_neighbor') {
                            current = { hit: n, neighbors: [] }
                            groups.push(current)
                          } else if (current) {
                            current.neighbors.push(n)
                          }
                        }
                        return groups.map((g, gi) => (
                          <div key={gi} className={styles.nodeGroup}>
                            <NodeRow node={g.hit} onEntityClick={setModalEntity} />
                            {g.neighbors.length > 0 && (
                              <div className={styles.neighborList}>
                                {g.neighbors.map((nb, ni) => (
                                  <div key={ni} className={styles.neighborRow}>
                                    <div className={styles.neighborConnector}>
                                      <div className={styles.neighborLine} />
                                      <div className={styles.neighborArrow}>→</div>
                                    </div>
                                    <NodeRow node={nb} onEntityClick={setModalEntity} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      })()
                  }
                </div>
                {retrieval.graph_paths.length > 0 && (
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>扩展路径 <span className={styles.count}>{retrieval.graph_paths.length}</span></div>
                    {retrieval.graph_paths.slice(0, 6).map((p, i) => (
                      <div key={i} className={styles.pathRow}>
                        <span className={styles.pathEntity}>{p.entities[0]}</span>
                        <span className={styles.pathRel}> —{p.relations[0]}→ </span>
                        <span className={styles.pathEntity}>{p.entities[1]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Vector hits */}
            <div className={styles.retrievalCol}>
              <div className={styles.colHeader}>向量召回 <span className={styles.count}>{retrieval.vector_hits.length}</span></div>
              <div className={styles.colScroll}>
                {retrieval.vector_hits.map(h => <HitCard key={h.chunk_id} hit={h} />)}
              </div>
            </div>

            {/* Graph hits */}
            <div className={styles.retrievalCol}>
              <div className={styles.colHeader}>图谱扩展召回 <span className={styles.count}>{retrieval.graph_hits.length}</span></div>
              <div className={styles.colScroll}>
                {retrieval.graph_hits.length === 0
                  ? <div className={styles.emptyCol}>无额外图谱召回{retrieval.matched_graph_nodes.length === 0 ? '（未命中图谱节点）' : '（已在向量结果中）'}</div>
                  : retrieval.graph_hits.map(h => <HitCard key={h.chunk_id} hit={h} />)}
              </div>
            </div>
          </div>

          {/* Bottom: answer comparison + prompt panel */}
          <div className={styles.answerRow}>
            <div className={styles.answerCol}>
              <div className={styles.answerHeader}>
                <span className={styles.answerLabel}>开启图谱增强</span>
                <span className={styles.answerMeta}>{retrieval.vector_hits.length + retrieval.graph_hits.length} 个来源</span>
                {!answerWith && !done && <span className={styles.answerStreaming}>输出中...</span>}
                <button className={styles.promptToggle} onClick={() => setShowPrompt(v => !v)}>
                  {showPrompt ? '▲ 收起 Prompt' : '▼ 查看 Prompt & Context'}
                </button>
              </div>
              {showPrompt && (
                <div className={styles.promptPanel}>
                  <div className={styles.promptSection}>
                    <div className={styles.promptSectionTitle}>System Prompt</div>
                    <pre className={styles.promptPre}>{retrieval.system_prompt}</pre>
                  </div>
                  <div className={styles.promptSection}>
                    <div className={styles.promptSectionTitle}>Context（含图谱召回，{retrieval.vector_hits.length + retrieval.graph_hits.length} 个来源）</div>
                    <pre className={styles.promptPre}>{retrieval.context_with_graph}</pre>
                  </div>
                </div>
              )}
              <div className={styles.answerContent}>
                {answerWith
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{answerWith}</ReactMarkdown>
                  : <div className={styles.answerPlaceholder}>等待回答...</div>}
              </div>
            </div>
            <div className={styles.answerDivider} />
            <div className={styles.answerCol}>
              <div className={styles.answerHeader}>
                <span className={styles.answerLabel}>
                  不开启图谱增强
                  {!retrieval.graph_hits.length && done && (
                    <span className={styles.sameContextNote}>（与左侧 Context 相同）</span>
                  )}
                </span>
                <span className={styles.answerMeta}>{retrieval.vector_hits.length} 个来源</span>
                {!answerWithout && !done && <span className={styles.answerStreaming}>输出中...</span>}
              </div>
              {showPrompt && retrieval.graph_hits.length > 0 && (
                <div className={styles.promptPanel}>
                  <div className={styles.promptSection}>
                    <div className={styles.promptSectionTitle}>Context（纯向量召回，{retrieval.vector_hits.length} 个来源）</div>
                    <pre className={styles.promptPre}>{retrieval.context_without_graph}</pre>
                  </div>
                </div>
              )}
              <div className={styles.answerContent}>
                {answerWithout
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{answerWithout}</ReactMarkdown>
                  : <div className={styles.answerPlaceholder}>等待回答...</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {!retrieval && !loading && (
        <div className={styles.placeholder}>
          输入问题后点击「分析」，查看检索过程详情并对比图谱增强效果
        </div>
      )}
      </div>
      {modalEntity && (
        <GraphEntityModal
          entity={modalEntity}
          onClose={() => setModalEntity(null)}
          version={sessionMeta?.graph_version}
        />
      )}
    </div>
  )
}
