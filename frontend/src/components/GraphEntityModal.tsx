import { useEffect, useRef, useState, useCallback } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { getSubgraph, getSubgraphByVersion, type GraphData } from '../api/client'
import styles from './GraphEntityModal.module.css'

const TYPE_COLOR: Record<string, string> = {
  PERSON:     '#818cf8',
  ORG:        '#38bdf8',
  GPE:        '#34d399',
  PRODUCT:    '#fb923c',
  LOC:        '#f472b6',
  WORK_OF_ART:'#a78bfa',
  EVENT:      '#fbbf24',
  FAC:        '#6ee7b7',
  NORP:       '#93c5fd',
  ENTITY:     '#94a3b8',
}
const TYPE_LABEL: Record<string, string> = {
  PERSON: '人物', ORG: '组织', GPE: '地点', PRODUCT: '产品', LOC: '位置', ENTITY: '实体',
}

const SIZES = [
  { label: '标准', w: 'calc(100vw - 48px)', h: 'calc(100vh - 48px)', fullscreen: false },
  { label: '全屏', w: '100vw', h: '100vh', fullscreen: true },
  { label: '小窗', w: '700px', h: '560px', fullscreen: false },
]

// Per-sizeIdx defaults: 标准=19, 全屏=20, 小窗=17
const FONT_SIZE_BY_SIZE = [19, 20, 17]

function defaultFontSize(sizeIdx = 0): number {
  return FONT_SIZE_BY_SIZE[sizeIdx] ?? FONT_SIZE_BY_SIZE[0]
}

interface Props {
  entity: string
  onClose: () => void
  version?: string  // if set, query from historical snapshot
}

export default function GraphEntityModal({ entity: initialEntity, onClose, version }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [currentEntity, setCurrentEntity] = useState(initialEntity)
  const [history, setHistory] = useState<string[]>([])
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sizeIdx, setSizeIdx] = useState(0)
  const [fontSize, setFontSize] = useState<number>(() => defaultFontSize(0))

  const fitGraph = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.resize()
      cyRef.current.fit(undefined, 48)
    }
  }, [])

  const handleSizeChange = useCallback((idx: number) => {
    setSizeIdx(idx)
    setFontSize(defaultFontSize(idx))
    requestAnimationFrame(() => { requestAnimationFrame(fitGraph) })
  }, [fitGraph])

  const loadEntity = useCallback((label: string) => {
    setLoading(true)
    setNotFound(false)
    setData(null)
    const fetch = version
      ? getSubgraphByVersion(label, version, 2)
      : getSubgraph(label, 2)
    fetch
      .then((r) => setData(r.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [version])

  useEffect(() => { loadEntity(currentEntity) }, [currentEntity])

  const navigateTo = useCallback((label: string) => {
    setHistory((h) => [...h, currentEntity])
    setCurrentEntity(label)
  }, [currentEntity])

  const goBack = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1]
      if (!prev) return h
      setCurrentEntity(prev)
      return h.slice(0, -1)
    })
  }, [])

  useEffect(() => {
    if (!containerRef.current || !data || data.nodes.length === 0) return

    const focalId = (
      data.nodes.find(n => n.label === currentEntity) ??
      data.nodes.find(n => n.label.toLowerCase() === currentEntity.toLowerCase())
    )?.id ?? data.nodes[0]?.id

    const elements = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id, label: n.label, type: n.type,
          color: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY,
          isTarget: n.id === focalId ? 1 : 0,
        },
      })),
      ...data.edges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, label: e.relation },
      })),
    ]

    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'font-size': fontSize,
            'font-family': '"Inter", "SF Pro Display", -apple-system, sans-serif',
            'font-weight': '600',
            color: '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-outline-width': 2,
            'text-outline-color': 'data(color)',
            width: 'label',
            height: 'label',
            padding: sizeIdx === 2 ? '8px' : '10px',
            shape: 'round-rectangle',
            'border-width': 0,
          } as any,
        },
        {
          selector: 'node[isTarget = 1]',
          style: {
            'background-color': '#dc2626',
            'text-outline-color': '#dc2626',
            'border-width': 3,
            'border-color': '#ffffff',
            'border-opacity': 1,
            'font-size': fontSize + 1,
            'font-weight': '700',
            'z-compound-depth': 'top',
          } as any,
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#64748b',
            'line-opacity': 0.4,
            'target-arrow-color': '#64748b',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.7,
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': Math.max(8, fontSize - 2),
            'font-family': '"Inter", -apple-system, sans-serif',
            color: '#94a3b8',
            'text-rotation': 'autorotate',
            'text-background-opacity': 0,
            'text-margin-y': -4,
          } as any,
        },
      ],
      layout: {
        name: 'cose',
        animate: true,
        animationDuration: 450,
        randomize: false,
        nodeRepulsion: () => 14000,
        nodeOverlap: 24,
        idealEdgeLength: () => sizeIdx === 2 ? 100 : 140,
        edgeElasticity: () => 100,
        nestingFactor: 1.2,
        gravity: 80,
        numIter: 1000,
        coolingFactor: 0.99,
        minTemp: 1.0,
        fit: true,
        padding: sizeIdx === 2 ? 32 : 56,
      } as any,
    })

    cy.on('tap', 'node', (evt) => {
      const label: string = evt.target.data('label')
      if (label && label !== currentEntity) navigateTo(label)
    })

    cyRef.current = cy
    return () => {
      cyRef.current = null
      cy.destroy()
    }
  }, [data, currentEntity, sizeIdx, fontSize])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && history.length > 0) goBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, goBack, history.length])

  const usedTypes = [...new Set((data?.nodes ?? []).map((n) => n.type))]
  const sz = SIZES[sizeIdx]

  return (
    <div
      className={`${styles.backdrop} ${sz.fullscreen ? styles.backdropFullscreen : ''}`}
      onClick={onClose}
    >
      <div
        className={`${styles.modal} ${sz.fullscreen ? styles.modalFullscreen : ''}`}
        style={sz.fullscreen ? undefined : { width: sz.w, height: sz.h } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          {history.length > 0 && (
            <button className={styles.backBtn} onClick={goBack} title="返回上一个实体 (←)">
              ← {history[history.length - 1]}
            </button>
          )}
          <span className={styles.title}>「{currentEntity}」关系图</span>
          {data && <span className={styles.stats}>节点 {data.nodes.length} · 边 {data.edges.length}</span>}
          <div className={styles.resizeBtns}>
            {SIZES.map((s, i) => (
              <button
                key={s.label}
                className={`${styles.resizeBtn} ${sizeIdx === i ? styles.resizeBtnActive : ''}`}
                onClick={() => handleSizeChange(i)}
              >{s.label}</button>
            ))}
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="关闭 (ESC)">✕</button>
        </div>

        {data && data.nodes.length > 0 && (
          <div className={styles.legend}>
            {usedTypes.map((t) => (
              <div key={t} className={styles.legendItem}>
                <div className={styles.legendDot} style={{ background: TYPE_COLOR[t] ?? TYPE_COLOR.ENTITY }} />
                {TYPE_LABEL[t] ?? t}
              </div>
            ))}
            <span className={styles.hint}>点击节点展开关系 · 滚轮缩放 · 拖拽移动</span>
          </div>
        )}

        <div className={styles.body}>
          {loading && <div className={styles.center}>加载中...</div>}
          {notFound && (
            <div className={styles.center}>
              {version
                ? `「${currentEntity}」在快照 ${version} 中不存在`
                : `图谱中未找到「${currentEntity}」`}
            </div>
          )}
          {!loading && !notFound && data && data.nodes.length === 0 && (
            <div className={styles.center}>该实体暂无关系数据</div>
          )}
          {!loading && data && data.nodes.length > 0 && (
            <div ref={containerRef} className={styles.canvas} />
          )}
        </div>
      </div>
    </div>
  )
}
