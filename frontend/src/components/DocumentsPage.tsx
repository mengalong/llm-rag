import { useEffect, useRef, useState, type DragEvent } from 'react'
import { type Document, type ChunkItem, type ChunkSettings, getDocumentChunks, deleteDocument } from '../api/client'
import styles from './DocumentsPage.module.css'

interface Props {
  docs: Document[]
  uploading: boolean
  uploadProgress: number
  onUpload: (f: File, settings?: ChunkSettings) => void
  onRefresh: () => void
}

const MIME_ICON: Record<string, string> = {
  'application/pdf': '📄',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'text/plain': '📃',
  'text/markdown': '📋',
}
const BADGE: Record<string, string> = {
  indexed: styles['badge-indexed'],
  processing: styles['badge-processing'],
  pending: styles['badge-pending'],
  error: styles['badge-error'],
}
const BADGE_LABEL: Record<string, string> = {
  indexed: '已索引', processing: '处理中', pending: '等待', error: '错误',
}
const STRATEGY_LABELS: Record<string, string> = {
  recursive: '递归分割（推荐）',
  sentence: '按句子分割',
  fixed: '固定长度',
}
const STRATEGY_HINTS: Record<string, string> = {
  recursive: '按段落→句子→字符递归切分，保留语义完整性',
  sentence: '以句号/换行为边界，适合短句密集的文档',
  fixed: '按固定字符数硬切，速度最快但语义可能被截断',
}

/** Format ISO UTC datetime to UTC+8 */
function fmtTime(iso: string | null, showDate = true): string {
  if (!iso) return '—'
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  const opts: Intl.DateTimeFormatOptions = showDate
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', ...opts })
}

export default function DocumentsPage({ docs, uploading, uploadProgress, onUpload, onRefresh }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [chunks, setChunks] = useState<ChunkItem[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Chunk strategy settings
  const [strategy, setStrategy] = useState<'recursive' | 'sentence' | 'fixed'>('recursive')
  const [chunkSize, setChunkSize] = useState(2000)
  const [chunkOverlap, setChunkOverlap] = useState(256)
  const [showStrategyPanel, setShowStrategyPanel] = useState(false)

  // Poll while any doc is in progress
  useEffect(() => {
    const hasPending = docs.some((d) => d.status === 'pending' || d.status === 'processing')
    if (!hasPending) return
    const t = setInterval(onRefresh, 1500)
    return () => clearInterval(t)
  }, [docs, onRefresh])

  // Load chunks when selection changes or doc becomes indexed
  const selectedDoc = docs.find((d) => d.id === selectedId) ?? null
  useEffect(() => {
    if (!selectedId || !selectedDoc || selectedDoc.status !== 'indexed') { setChunks([]); return }
    setChunksLoading(true)
    getDocumentChunks(selectedId)
      .then((r) => {
        const loaded = r.data.chunks
        setChunks(loaded)
        // Default: expand first 10 chunks
        setExpandedChunks(new Set(loaded.slice(0, 10).map((c) => c.id)))
      })
      .catch(console.error)
      .finally(() => setChunksLoading(false))
  }, [selectedId, selectedDoc?.status])

  const toggleChunk = (id: string) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filteredChunks = search.trim()
    ? chunks.filter((c) => c.content.toLowerCase().includes(search.toLowerCase()))
    : chunks

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteDocument(id)
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const settings: ChunkSettings = { chunkStrategy: strategy, chunkSize, chunkOverlap }
    Array.from(files).forEach((f) => onUpload(f, settings))
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>文件管理</span>
        <button
          className={`${styles.strategyBtn} ${showStrategyPanel ? styles.strategyBtnActive : ''}`}
          onClick={() => setShowStrategyPanel((v) => !v)}
        >
          ⚙ 切片策略：{STRATEGY_LABELS[strategy]}
        </button>
        <div
          className={`${styles.dropzone} ${dragging ? styles.dragOver : ''} ${uploading ? styles.uploading : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !uploading && inputRef.current?.click()}
          title="支持 PDF、DOCX、TXT、Markdown（.md）"
        >
          <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc,.txt,.md,.markdown"
            style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
          {uploading
            ? <div className={styles.uploadProgress}>
                <div className={styles.uploadBar} style={{ width: `${uploadProgress}%` }} />
                <span>{uploadProgress}%</span>
              </div>
            : <span>＋ 上传文档</span>}
        </div>
        <span className={styles.uploadHint}>PDF · DOCX · TXT · MD</span>
      </div>

      {/* Strategy panel */}
      {showStrategyPanel && (
        <div className={styles.strategyPanel}>
          <div className={styles.strategyRow}>
            {(['recursive', 'sentence', 'fixed'] as const).map((s) => (
              <button
                key={s}
                className={`${styles.strategyOption} ${strategy === s ? styles.strategyOptionActive : ''}`}
                onClick={() => setStrategy(s)}
              >
                <span className={styles.strategyName}>{STRATEGY_LABELS[s]}</span>
                <span className={styles.strategyHint}>{STRATEGY_HINTS[s]}</span>
              </button>
            ))}
          </div>
          <div className={styles.strategyParams}>
            <label>
              切片大小（字符）
              <input type="number" min={100} max={8000} step={100}
                value={chunkSize} onChange={(e) => setChunkSize(Number(e.target.value))} />
            </label>
            <label>
              重叠大小（字符）
              <input type="number" min={0} max={1000} step={50}
                value={chunkOverlap} onChange={(e) => setChunkOverlap(Number(e.target.value))} />
            </label>
          </div>
        </div>
      )}

      <div className={styles.body}>
        {/* Left: document list */}
        <div className={styles.listPane}>
          <div className={styles.listScroll}>
            {docs.length === 0 && <div className={styles.emptyList}>暂无文档，请上传文件</div>}
            {docs.map((doc) => (
              <div
                key={doc.id}
                className={`${styles.docRow} ${doc.id === selectedId ? styles.selected : ''}`}
                onClick={() => setSelectedId(doc.id)}
              >
                <div className={styles.docIcon}>{MIME_ICON[doc.mime_type] ?? '📄'}</div>
                <div className={styles.docInfo}>
                  <div className={styles.docName} title={doc.filename}>{doc.filename}</div>
                  <div className={styles.docMeta}>
                    <span className={`${styles.badge} ${BADGE[doc.status] ?? ''}`}>
                      {BADGE_LABEL[doc.status] ?? doc.status}
                    </span>
                    {doc.status === 'indexed' && (
                      <span className={styles.docChunks}>{doc.chunk_count} 片段</span>
                    )}
                  </div>
                  <div className={styles.docTimes}>
                    <span>上传 {fmtTime(doc.created_at)}</span>
                    {doc.indexed_at && <span>完成 {fmtTime(doc.indexed_at)}</span>}
                  </div>
                  {(doc.status === 'processing' || doc.status === 'pending') && (
                    <div className={styles.docProgress}>
                      <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${doc.progress ?? 0}%` }} />
                      </div>
                      {doc.progress_step && <div className={styles.progressStep}>{doc.progress_step}</div>}
                    </div>
                  )}
                  {doc.error && <div className={styles.docError}>{doc.error}</div>}
                </div>
                <button className={styles.docDel} onClick={(e) => handleDelete(doc.id, e)} title="删除">×</button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: chunk detail */}
        <div className={styles.detailPane}>
          {!selectedDoc ? (
            <div className={styles.noSelect}>← 选择文档查看切片详情</div>
          ) : selectedDoc.status !== 'indexed' ? (
            <div className={styles.noSelect}>
              {selectedDoc.status === 'error' ? `处理失败：${selectedDoc.error}` : '文档尚未完成索引'}
            </div>
          ) : (
            <>
              <div className={styles.detailHeader}>
                <span className={styles.detailTitle} title={selectedDoc.filename}>{selectedDoc.filename}</span>
                <span className={styles.detailMeta}>
                  {chunks.length} 片 · {STRATEGY_LABELS[selectedDoc.chunk_strategy ?? 'recursive']} · size={selectedDoc.chunk_size} overlap={selectedDoc.chunk_overlap}
                </span>
              </div>
              <div className={styles.searchBox}>
                <input className={styles.searchInput} placeholder="搜索切片内容..."
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {chunksLoading ? (
                <div className={styles.loadingChunks}>加载中...</div>
              ) : (
                <div className={styles.chunkScroll}>
                  {filteredChunks.map((chunk) => (
                    <div key={chunk.id} className={styles.chunkCard}>
                      <div className={styles.chunkCardHeader} onClick={() => toggleChunk(chunk.id)}>
                        <span className={styles.chunkIdx}>#{chunk.chunk_index + 1}</span>
                        {chunk.heading && <span className={styles.chunkHeading}>{chunk.heading}</span>}
                        {chunk.page != null && <span className={styles.chunkPageBadge}>第 {chunk.page} 页</span>}
                        <span className={styles.chunkLen}>{chunk.content.length} 字</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>
                          {expandedChunks.has(chunk.id) ? '▲' : '▼'}
                        </span>
                      </div>
                      {expandedChunks.has(chunk.id) && (
                        <div className={styles.chunkBody}>{chunk.content}</div>
                      )}
                    </div>
                  ))}
                  {filteredChunks.length === 0 && search && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                      无匹配结果
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
