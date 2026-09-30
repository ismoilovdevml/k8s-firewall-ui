import { useState } from 'react'

export type GraphDim = '2d' | '3d'

const KEY = 'fwui-topology-dim'

/** 2D/3D choice for the topology graphs, remembered per browser. */
export function useGraphDim(): [GraphDim, (d: GraphDim) => void] {
  const [dim, setDim] = useState<GraphDim>(() => {
    try {
      return localStorage.getItem(KEY) === '3d' ? '3d' : '2d'
    } catch {
      return '2d'
    }
  })
  const set = (d: GraphDim) => {
    setDim(d)
    try {
      localStorage.setItem(KEY, d)
    } catch {
      /* storage blocked: keep it for this page only */
    }
  }
  return [dim, set]
}
