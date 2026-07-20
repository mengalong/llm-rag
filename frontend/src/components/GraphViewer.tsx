import { useEffect, useRef, useState } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { type GraphData } from '../api/client'
import styles from './GraphViewer.module.css'

interface Props {
  data: GraphData | null
  fullData: GraphData | null    // full graph, for reset
  onNodeClick?: (nodeId: string, label: string) => void
  onReset?: () => void
}

const TYPE_COLOR: Record<string, string> = {
  PERSON: '#e57373',
  ORG: '#64b5f6',
  GPE: '#81c784',
  PRODUCT: '#ffb74d',
  LOC: '#ce93d8',
  ENTITY: '#90a4ae',
}
const TYPE_LABEL: Record<string, string> = {
  PERSON: '人物', ORG: '组织', GPE: '地点', PRODUCT: '产品', LOC: '位置', ENTITY: '实体',
}

export default function GraphViewer({ data, fullData, onNodeClick, onReset }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [edgeCount, setEdgeCount] = useState(0)

  useEffect(() => {
    if (!containerRef.current || !data || data.nodes.length === 0) return

    const elements = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          type: n.type,
          color: TYPE_COLOR[n.type] ?? TYPE_COLOR.ENTITY,
        },
      })),
      ...data.edges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.relation,
          weight: e.weight,
        },
      })),
    ]

    setNodeCount(data.nodes.length)
    setEdgeCount(data.edges.length)

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
            'font-size': 12,
            color: '#fff',
            'text-valign': 'center',
            'text-outline-width': 2,
            'text-outline-color': 'data(color)',
            width: 42,
            height: 42,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#3a3a3a',
            'target-arrow-color': '#3a3a3a',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 10,
            color: '#8e8ea0',
            'text-rotation': 'autorotate',
            'text-background-color': '#212121',
            'text-background-opacity': 0.7,
            'text-background-padding': '2px',
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': '#10a37f' },
        },
        {
          selector: 'node:hover',
          style: { 'border-width': 2, 'border-color': '#fff', opacity: 0.9 },
        },
      ],
      layout: {
        name: 'cose',
        animate: true,
        animationDuration: 400,
        nodeRepulsion: () => 4000,
        idealEdgeLength: () => 100,
        fit: true,
        padding: 40,
      } as any,
    })

    cy.on('tap', 'node', (evt) => {
      onNodeClick?.(evt.target.id(), evt.target.data('label'))
    })

    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null }
  }, [data])

  const usedTypes = [...new Set((data?.nodes ?? []).map((n) => n.type))]

  if (!data || data.nodes.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>图谱为空，上传文档后自动构建</div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <span className={styles.stats}>
          节点 {nodeCount} · 边 {edgeCount}
          {data.stats?.top_entities?.length > 0 && (
            <> · 热门：{data.stats.top_entities.slice(0, 5).join('、')}</>
          )}
        </span>
        {fullData && onReset && data !== fullData && (
          <button className={styles.resetBtn} onClick={onReset}>← 返回全图</button>
        )}
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
