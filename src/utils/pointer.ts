/**
 * 双端指针输入适配（weapp 触摸 / H5 触摸 + 鼠标）：
 * - eventPoint：从 TouchEvent 或 MouseEvent 统一取出 clientX/clientY
 * - mouseProps：H5 构建下给组件条件挂载鼠标事件（weapp 下返回空对象，构建期死代码消除）
 * - 触摸去重：触屏浏览器会在 touch 后合成 mouse 事件，600ms 内的鼠标事件直接忽略
 */

const IS_H5 = process.env.TARO_ENV === 'h5'
let lastTouchAt = 0

/** 标记"刚发生过触摸"（触摸处理器入口调用） */
export function markTouch(): void {
  lastTouchAt = Date.now()
}

/** 触摸后 600ms 内的鼠标事件视为合成事件，忽略 */
function isSyntheticMouse(): boolean {
  return Date.now() - lastTouchAt < 600
}

export function eventPoint(e: any): { clientX: number; clientY: number } | null {
  const p = e?.touches?.[0] ?? e?.changedTouches?.[0] ?? e
  if (!p || p.clientX == null || p.clientY == null) return null
  return p
}

export interface MouseHandlers {
  down?: (e: any) => void
  move?: (e: any) => void
  up?: (e: any) => void
}

/** H5 下返回鼠标事件 props；weapp 下返回 {}（属性展开后无副作用） */
export function mouseProps(h: MouseHandlers): Record<string, (e: any) => void> {
  if (!IS_H5) return {}
  return {
    onMouseDown: (e: any) => {
      if (isSyntheticMouse()) return
      h.down?.(e)
    },
    onMouseMove: (e: any) => {
      if (isSyntheticMouse()) return
      h.move?.(e)
    },
    onMouseUp: (e: any) => {
      if (isSyntheticMouse()) return
      h.up?.(e)
    },
    onMouseLeave: (e: any) => {
      if (isSyntheticMouse()) return
      h.up?.(e)
    }
  }
}
