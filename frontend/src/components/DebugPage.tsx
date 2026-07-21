import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { type DebugResult, type DebugHit, type MatchedGraphNode, debugQueryStream } from '../api/client'
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

function NodeRow({ node }: { node: MatchedGraphNode }) {
  return (
    <div className={styles.nodeRow}>
      <div className={styles.nodeTypeDot} style={{ background: TYPE_COLOR[node.type] ?? TYPE_COLOR.ENTITY }} />
      <div className={styles.nodeInfo}>
        <div className={styles.nodeMain}>
          <span className={styles.nodeLabel}>{node.label}</span>
          <span className={styles.nodeType}>{node.type}</span>
          <span className={styles.nodeDeg}>度{node.degree}</span>
          <span className={styles.nodeReason} style={{ color: REASON_COLOR[node.match_reason] }}>
            {REASON_LABEL[node.match_reason]}
          </span>
        </div>
        {node.matched_by && node.match_reason !== 'graph_neighbor' && (
          <div className={styles.nodeMatchedBy}>
            {node.match_reason === 'fuzzy' ? `关键词「${node.matched_by}」` : `实体「${node.matched_by}」`}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DebugPage() {
  const [question, setQuestion] = useState('')
  const [topK, setTopK] = useState(5)
  const [loading, setLoading] = useState(false)
  const [retrieval, setRetrieval] = useState<Omit<DebugResult, 'answer_with_graph' | 'answer_without_graph'> | null>(null)
  const [answerWith, setAnswerWith] = useState('')
  const [answerWithout, setAnswerWithout] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const run = () => {
    if (!question.trim()) return
    if (esRef.current) esRef.current.close()

    setLoading(true)
    setError(null)
    setRetrieval(null)
    setAnswerWith('')
    setAnswerWithout('')
    setDone(false)

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
          })
          setLoading(false)
        } else if (data.type === 'token') {
          if (data.label === 'with_graph') setAnswerWith(prev => prev + data.token)
          else setAnswerWithout(prev => prev + data.token)
        } else if (data.type === 'done') {
          setDone(true)
          es.close()
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

  return (
    <div className={styles.page}>
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
                  <div className={styles.sectionTitle}>NER 实体</div>
                  {retrieval.ner_entities.length === 0
                    ? <div className={styles.empty}>未识别到命名实体</div>
                    : retrieval.ner_entities.map(e => (
                      <span key={e} className={styles.pill} style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent)' }}>
                        {e} <span className={styles.pillTag}>spaCy</span>
                      </span>
                    ))}
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>关键词匹配</div>
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
                    <span className={styles.count}>{retrieval.matched_graph_nodes.filter(n => n.match_reason !== 'graph_neighbor').length}命中+{retrieval.matched_graph_nodes.filter(n => n.match_reason === 'graph_neighbor').length}邻居</span>
                  </div>
                  {retrieval.matched_graph_nodes.length === 0
                    ? <div className={styles.empty}>无命中</div>
                    : retrieval.matched_graph_nodes.map((n, i) => <NodeRow key={i} node={n} />)}
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

          {/* Bottom: answer comparison — stream in */}
          <div className={styles.answerRow}>
            <div className={styles.answerCol}>
              <div className={styles.answerHeader}>
                <span className={styles.answerLabel}>开启图谱增强</span>
                <span className={styles.answerMeta}>{retrieval.vector_hits.length + retrieval.graph_hits.length} 个来源</span>
                {!answerWith && !done && <span className={styles.answerStreaming}>输出中...</span>}
              </div>
              <div className={styles.answerContent}>
                {answerWith
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{answerWith}</ReactMarkdown>
                  : <div className={styles.answerPlaceholder}>等待回答...</div>}
              </div>
            </div>
            <div className={styles.answerDivider} />
            <div className={styles.answerCol}>
              <div className={styles.answerHeader}>
                <span className={styles.answerLabel}>不开启图谱增强</span>
                <span className={styles.answerMeta}>{retrieval.vector_hits.length} 个来源</span>
                {!answerWithout && !done && <span className={styles.answerStreaming}>输出中...</span>}
              </div>
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
  )
}
