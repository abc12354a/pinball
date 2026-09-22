import { useEffect, useState } from 'react'
import Taro, { useReady } from '@tarojs/taro'
import type { CanvasLike } from '../loop'

export interface CanvasInfo {
  canvas: CanvasLike
  /** CSS 尺寸（px） */
  width: number
  height: number
}

/**
 * 获取 type="2d" 的 canvas 节点。
 * 已知坑（taro#14438）：React 下 useReady 后偶发拿不到 node —— nextTick + 失败重试 3 次。
 */
export function useCanvasNode(id: string): CanvasInfo | null {
  const [info, setInfo] = useState<CanvasInfo | null>(null)

  const query = (attempt: number) => {
    Taro.createSelectorQuery()
      .select(`#${id}`)
      .fields({ node: true, size: true }, (res) => {
        const r = res as { node: CanvasLike | null; width?: number; height?: number } | null
        if (r && r.node && r.width && r.height) {
          setInfo({ canvas: r.node, width: r.width, height: r.height })
        } else if (attempt < 3) {
          setTimeout(() => query(attempt + 1), 100)
        }
      })
      .exec()
  }

  useReady(() => {
    Taro.nextTick(() => query(0))
  })

  useEffect(() => () => setInfo(null), [])
  return info
}
