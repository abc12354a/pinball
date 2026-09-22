import { CONFIG } from '../../config/config'

/**
 * 钉板布局（纯数据，逻辑坐标，基准 375×560）：
 * - 顶部右侧发射口（母球从这里进入钉板）
 * - 中部错排钉阵（9 行，9/8 钉交替）
 * - 底部 12 条落球轨道 + 分道壁 + 落道传感器线
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
}

export function createBoard(): BoardLayout {
  const { width, height, laneCount } = CONFIG.board
  const ballRadius = 10

  const fieldLeft = 24
  const fieldRight = width - 24
  const fieldW = fieldRight - fieldLeft
  const rows = 9
  const pegR = 4
  // 外分道壁（漏斗）位置：边缘轨道 0/11 的内侧壁
  const outerDividerTop = 96
  const outerDividerBottom = 290
  const dividerL = fieldLeft + (fieldW / laneCount) // 51.25
  const dividerR = fieldRight - (fieldW / laneCount) // 324.75
  // 漏斗段内钉阵必须离漏斗壁 ≥24px 通行间隙（墙-钉面 = 球径 20 + 余量 4），
  // 否则"漏斗壁×边钉"形成 < 球径的楔形缝隙卡球（M2 实测踩坑 ×2）
  const funnelPegL = dividerL + pegR + 24 // 79.25
  const funnelPegR = dividerR - pegR - 24 // 296.75
  // 漏斗段以下的排铺满全宽（边缘留同样的 24px 间隙），把散出去的球弹回钉阵
  const fullPegL = fieldLeft + pegR + 24 // 52
  const fullPegR = fieldRight - pegR - 24 // 323
  const topY = 128
  const bottomY = 444
  const spacingY = (bottomY - topY) / (rows - 1) // 39.5

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

  const laneTop = bottomY + 36 // 480：分道壁顶
  const landY = laneTop + 44 // 524：传感器线

  return {
    width,
    height,
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
    guideLineY: bottomY - 6,
    // 外分道壁封口段：上段把球漏斗聚向中间（否则边缘走廊直坠堆积），
    // 下段开放让边缘轨低概率可达（"边缘难落"+ 末段引导仍可导入）
    outerDividerTop,
    outerDividerBottom
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
