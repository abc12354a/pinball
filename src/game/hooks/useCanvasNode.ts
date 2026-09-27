import { useEffect, useState } from 'react'
import Taro, { useReady } from '@tarojs/taro'
import type { CanvasLike } from '../loop'

export interface CanvasInfo {
  canvas: CanvasLike
  /** CSS 尺寸（px） */
  width: number
  height: number
}

const IS_H5 = process.env.TARO_ENV === 'h5'

/**
 * H5：直接取 DOM canvas（Taro H5 的 selectorQuery 不保证 node 语义），
 * 并把 window 的 rAF 绑到元素上（DOM canvas 没有自己的 requestAnimationFrame）。
 */
function queryH5Node(id: string): CanvasInfo | null {
  if (typeof document === 'undefined') return null
  const el = document.getElementById(id)
  if (!el) return null
  const canvas = el instanceof HTMLCanvasElement ? el : el.querySelector('canvas')
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const w = canvas as unknown as CanvasLike
  w.requestAnimationFrame = (cb) => window.requestAnimationFrame(cb)
  w.cancelAnimationFrame = (h) => window.cancelAnimationFrame(h)
  return { canvas: w, width: rect.width, height: rect.height }
}

/**
 * 获取 type="2d" 的 canvas 节点（双端）。
 * 已知坑（taro#14438）：React 下 useReady 后偶发拿不到 node —— nextTick + 失败重试。
 */
export function useCanvasNode(id: string): CanvasInfo | null {
  const [info, setInfo] = useState<CanvasInfo | null>(null)

  const query = (attempt: number) => {
    if (IS_H5) {
      const r = queryH5Node(id)
      if (r) setInfo(r)
      else if (attempt < 10) setTimeout(() => query(attempt + 1), 100)
      return
    }
    Taro.createSelectorQuery()
      .select(`#${id}`)
      .fields({ node: true, size: true }, (res) => {
        const r = res as { node: CanvasLike | null; width?: number; height?: number } | null
        if (r && r.node && r.width && r.height) {
          setInfo({ canvas: r.node, width: r.width, height: r.height })
        } else if (attempt < 10) {
          setTimeout(() => query(attempt + 1), 100)
        }
      })
      .exec()
  }

  useReady(() => {
    Taro.nextTick(() => query(0))
  })

  useEffect(() => {
    const timer = setTimeout(() => query(0), 60)
    return () => {
      clearTimeout(timer)
      setInfo(null)
    }
  }, [])
  return info
}
