import { useEffect, useRef, useState, useCallback } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { getSubgraph, type GraphData } from '../api/client'
import styles from './GraphEntityModal.module.css'

const TYPE_COLOR: Record<string, string> = {
  PERSON: '#a78bfa', ORG: '#60a5fa', GPE: '#34d399',
  PRODUCT: '#fb923c', LOC: '#f472b6', ENTITY: '#94a3b8',
}
const TYPE_LABEL: Record<string, string> = {
  PERSON: '人物', ORG: '组织', GPE: '地点', PRODUCT: '产品', LOC: '位置', ENTITY: '实体',
}

const SIZES = [
  { label: '标准', w: 'calc(100vw - 48px)', h: 'calc(100vh - 48px)', fullscreen: false },
  { label: '全屏', w: '100vw', h: '100vh', fullscreen: true },
  { label: '小窗', w: '680px', h: '520px', fullscreen: false },
]

interface Props {
  entity: string
  onClose: () => void
}

export default function GraphEntityModal({ entity: initialEntity, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [currentEntity, setCurrentEntity] = useState(initialEntity)
  const [history, setHistory] = useState<string[]>([])
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sizeIdx, setSizeIdx] = useState(0)

  const loadEntity = useCallback((label: string) => {
    setLoading(true)
    setNotFound(false)
    setData(null)
    getSubgraph(label, 2)
      .then((r) => setData(r.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [])

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

    // Find the focal node — prefer exact label match, fall back to first node
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
    if (cyRef.current) cyRef.current.destroy()
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
            'font-size': 12,
            'font-family': 'Inter, sans-serif',
            'font-weight': '500',
            color: '#fff',
            'text-valign': 'center',
            'text-outline-width': 2,
            'text-outline-color': 'data(color)',
            width: 40, height: 40,
            'border-width': 0,
            cursor: 'pointer',
          },
        },
        {
          selector: 'node[isTarget = 1]',
          style: {
            width: 62, height: 62,
            'background-color': '#dc2626',
            'text-outline-color': '#dc2626',
            'border-width': 4,
            'border-color': '#ffffff',
            'border-opacity': 1,
            'font-size': 14,
            'font-weight': '700',
            'text-outline-width': 3,
            'z-compound-depth': 'top',
          } as any,
        },
        {
          selector: 'edge',
          style: {
            width: 1.4,
            'line-color': '#4f52d9',
            'line-opacity': 0.5,
            'target-arrow-color': '#6366f1',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.85,
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 10,
            'font-family': 'Inter, sans-serif',
            color: '#8080a8',
            'text-rotation': 'autorotate',
            'text-background-color': '#1a1a2e',
            'text-background-opacity': 0.75,
            'text-background-padding': '2px',
          },
        },
        {
          selector: 'node:hover',
          style: { 'border-width': 2, 'border-color': '#fff', 'border-opacity': 0.6 },
        },
      ],
      layout: {
        name: 'cose',
        animate: true,
        animationDuration: 350,
        nodeRepulsion: () => 5000,
        idealEdgeLength: () => 100,
        fit: true,
        padding: 40,
      } as any,
    })

    cy.on('tap', 'node', (evt) => {
      const label: string = evt.target.data('label')
      if (label && label !== currentEntity) navigateTo(label)
    })

    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null }
  }, [data, currentEntity])

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
                onClick={() => setSizeIdx(i)}
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
          {notFound && <div className={styles.center}>图谱中未找到「{currentEntity}」</div>}
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
