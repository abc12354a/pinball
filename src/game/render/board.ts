import { CONFIG } from '../../config/config'

/**
 * 钉板布局（纯数据，逻辑坐标，宽 375 基准，高度自适应 480~640）：
 * - 顶部右侧发射口（母球从这里进入钉板）
 * - 中部错排钉阵（9 行，9/8 钉交替）
 * - 底部 12 条落球轨道 + 分道壁 + 落道传感器线
 *
 * 高度参数化：所有 Y 向常量按 k = height/560 等比缩放（X 向不变），
 * 引擎按画布纵横比选高度 → 棋盘宽度撑满屏幕、四周零留白。
 */

export interface BoardLayout {
  width: number
  height: number
  /** 钉子扁平数组 [x, y, r, ...]（Float64Array，零 GC） */
  pegs: Float64Array
  pegCount: number
  ballRadius: number
  /** 钉板左右墙 */
  wallLeft: number
  wallRight: number
  lanes: {
    count: number
    left: number
    width: number
    /** 分道壁顶（进入轨道区，落点在此后钳制） */
    top: number
    /** 传感器线：球心过线即落道 */
    landY: number
  }
  spawn: { x: number; y: number }
  /** 末段引导起始线（最后钉排下方） */
  guideLineY: number
  /** 外分道壁（边缘轨道封口段）：[top, bottom)，之外边缘轨开放 */
  outerDividerTop: number
  outerDividerBottom: number
  /** 钉阵 Y 向范围（碰钉音效的深度比映射用） */
  pegFieldTop: number
  pegFieldBottom: number
  /** 特殊黄金弹性蘑菇钉索引 */
  bumperIndices: number[]
}

export function createBoard(height: number = CONFIG.board.height): BoardLayout {
  const { width, laneCount } = CONFIG.board
  const h = Math.max(480, Math.min(640, Math.round(height)))
  const k = h / 560 // Y 向缩放系数（基准 560）
  const ballRadius = 10

  const fieldLeft = 24
  const fieldRight = width - 24
  const fieldW = fieldRight - fieldLeft
  const rows = 9
  const pegR = 4
  // 外分道壁（漏斗）位置：边缘轨道 0/11 的内侧壁（Y 向随高度等比）
  const outerDividerTop = Math.round(96 * k)
  const outerDividerBottom = Math.round(290 * k)
  const dividerL = fieldLeft + (fieldW / laneCount) // 51.25
  const dividerR = fieldRight - (fieldW / laneCount) // 324.75
  // 漏斗段内钉阵必须离漏斗壁 ≥24px 通行间隙（墙-钉面 = 球径 20 + 余量 4），
  // 否则"漏斗壁×边钉"形成 < 球径的楔形缝隙卡球（M2 实测踩坑 ×2；X 向不缩放，约束保持）
  const funnelPegL = dividerL + pegR + 24 // 79.25
  const funnelPegR = dividerR - pegR - 24 // 296.75
  // 漏斗段以下的排铺满全宽（边缘留同样的 24px 间隙），把散出去的球弹回钉阵
  const fullPegL = fieldLeft + pegR + 24 // 52
  const fullPegR = fieldRight - pegR - 24 // 323
  const topY = Math.round(128 * k)
  const bottomY = Math.round(444 * k)
  // 物理安全：h=480 时 spacingY≈33.9，对角钉距≈39 > 最小间隙 2×(10+4)=28，不卡球
  const spacingY = (bottomY - topY) / (rows - 1)

  const pegs: number[] = []
  for (let r = 0; r < rows; r++) {
    const y = topY + spacingY * r
    const inFunnel = y < outerDividerBottom
    const left = inFunnel ? funnelPegL : fullPegL
    const right = inFunnel ? funnelPegR : fullPegR
    const wide = r % 2 === 0 // 8 钉 / 7 钉 交替错排
    const n = wide ? 8 : 7
    const spacingX = (right - left) / (n - 1)
    for (let i = 0; i < n; i++) {
      const x = left + spacingX * i
      pegs.push(x, y, pegR)
    }
  }

  const laneTop = bottomY + Math.round(36 * k) // 分道壁顶
  const landY = laneTop + Math.round(44 * k) // 传感器线（landY ≤ h-26，下方留口袋空间）

  return {
    width,
    height: h,
    pegs: new Float64Array(pegs),
    pegCount: pegs.length / 3,
    ballRadius,
    wallLeft: fieldLeft,
    wallRight: fieldRight,
    lanes: {
      count: laneCount,
      left: fieldLeft,
      width: fieldW / laneCount,
      top: laneTop,
      landY
    },
    spawn: { x: width - 36, y: 50 },
    guideLineY: bottomY - Math.round(6 * k),
    // 外分道壁封口段：上段把球漏斗聚向中间（否则边缘走廊直坠堆积），
    // 下段开放让边缘轨低概率可达（"边缘难落"+ 末段引导仍可导入）
    outerDividerTop,
    outerDividerBottom,
    pegFieldTop: topY,
    pegFieldBottom: bottomY,
    bumperIndices: [40, 42]
  }
}

/** x 坐标 → 轨道索引（越界钳到边缘轨） */
export function laneIndexOf(layout: BoardLayout, x: number): number {
  const { left, width, count } = layout.lanes
  const lane = Math.floor((x - left) / width)
  return Math.max(0, Math.min(count - 1, lane))
}

/** 轨道索引 → 轨道中心 x */
export function laneCenterX(layout: BoardLayout, lane: number): number {
  return layout.lanes.left + layout.lanes.width * (lane + 0.5)
}
