import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { type DebugResult, type DebugHit, type MatchedGraphNode, debugQuery } from '../api/client'
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
  const [result, setResult] = useState<DebugResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!question.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const r = await debugQuery(question.trim(), topK)
      setResult(r.data)
    } catch (e: any) {
      setError(e?.message ?? '请求失败')
    } finally {
      setLoading(false)
    }
  }

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

      {result && (
        <div className={styles.body}>
          {/* Top: retrieval process */}
          <div className={styles.retrievalRow}>
            {/* Graph process */}
            <div className={styles.retrievalCol}>
              <div className={styles.colHeader}>图谱检索过程</div>
              <div className={styles.colScroll}>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>NER 实体</div>
                  {result.ner_entities.length === 0
                    ? <div className={styles.empty}>未识别到命名实体</div>
                    : result.ner_entities.map(e => (
                      <span key={e} className={styles.pill} style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent)' }}>
                        {e} <span className={styles.pillTag}>spaCy</span>
                      </span>
                    ))}
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>关键词匹配</div>
                  {result.fuzzy_entities.length === 0
                    ? <div className={styles.empty}>{result.ner_entities.length > 0 ? 'NER 已命中' : '无匹配'}</div>
                    : result.fuzzy_entities.map(e => (
                      <span key={e} className={styles.pill} style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                        {e} <span className={styles.pillTag}>关键词</span>
                      </span>
                    ))}
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    命中节点
                    <span className={styles.count}>{result.matched_graph_nodes.filter(n => n.match_reason !== 'graph_neighbor').length}命中+{result.matched_graph_nodes.filter(n => n.match_reason === 'graph_neighbor').length}邻居</span>
                  </div>
                  {result.matched_graph_nodes.length === 0
                    ? <div className={styles.empty}>无命中</div>
                    : result.matched_graph_nodes.map((n, i) => <NodeRow key={i} node={n} />)}
                </div>
                {result.graph_paths.length > 0 && (
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>扩展路径 <span className={styles.count}>{result.graph_paths.length}</span></div>
                    {result.graph_paths.slice(0, 6).map((p, i) => (
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
              <div className={styles.colHeader}>向量召回 <span className={styles.count}>{result.vector_hits.length}</span></div>
              <div className={styles.colScroll}>
                {result.vector_hits.map(h => <HitCard key={h.chunk_id} hit={h} />)}
              </div>
            </div>

            {/* Graph hits */}
            <div className={styles.retrievalCol}>
              <div className={styles.colHeader}>图谱扩展召回 <span className={styles.count}>{result.graph_hits.length}</span></div>
              <div className={styles.colScroll}>
                {result.graph_hits.length === 0
                  ? <div className={styles.emptyCol}>无额外图谱召回{result.matched_graph_nodes.length === 0 ? '（未命中图谱节点）' : '（已在向量结果中）'}</div>
                  : result.graph_hits.map(h => <HitCard key={h.chunk_id} hit={h} />)}
              </div>
            </div>
          </div>

          {/* Bottom: answer comparison */}
          <div className={styles.answerRow}>
            <div className={styles.answerCol}>
              <div className={styles.answerHeader}>
                <span className={styles.answerLabel}>开启图谱增强</span>
                <span className={styles.answerMeta}>{result.vector_hits.length + result.graph_hits.length} 个来源</span>
              </div>
              <div className={styles.answerContent}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer_with_graph}</ReactMarkdown>
              </div>
            </div>
            <div className={styles.answerDivider} />
            <div className={styles.answerCol}>
              <div className={styles.answerHeader}>
                <span className={styles.answerLabel}>不开启图谱增强</span>
                <span className={styles.answerMeta}>{result.vector_hits.length} 个来源</span>
              </div>
              <div className={styles.answerContent}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer_without_graph}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}

      {!result && !loading && (
        <div className={styles.placeholder}>
          输入问题后点击「分析」，查看检索过程详情并对比图谱增强效果
        </div>
      )}
    </div>
  )
}
