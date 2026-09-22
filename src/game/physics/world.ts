import { CONFIG } from '../../config/config'
import { laneCenterX, laneIndexOf, type BoardLayout } from '../render/board'

/**
 * PlinkoWorld —— 钉板物理（纯表现层）。
 *
 * 落点在松手瞬间已由 pickLane 抽出（概率主导）：
 * - setTargetLane(lane) 后，球过 guideLineY 起施加渐进引导力 + 横向阻尼；
 * - 进入轨道区（lanes.top）后钳制在目标轨道内，保证 LANDED === targetLane；
 * - 不设目标（targetLane = -1）即为"自然分布"模式，用于实测回填 W2。
 *
 * 零分配设计：钉数据扁平数组、尾迹复用缓冲、无闭包捕获。
 */

export type WorldState = 'idle' | 'flying' | 'landed'

const TRAIL_LEN = 10
const MAX_SPEED = 1100

export class PlinkoWorld {
  state: WorldState = 'idle'
  /** 球心位置/速度（逻辑坐标） */
  bx = 0
  by = 0
  bvx = 0
  bvy = 0
  /** 尾迹环形缓冲 */
  readonly trailX = new Float32Array(TRAIL_LEN)
  readonly trailY = new Float32Array(TRAIL_LEN)
  trailLen = 0
  /** 每颗钉的闪光强度 [0,1]，碰撞置 1 后指数衰减（渲染读） */
  readonly pegFlash: Float32Array
  /** 落道回调 */
  onLanded: ((lane: number) => void) | null = null
  landedLane = -1
  /** 引导中的目标轨道，-1 = 无（自然模式） */
  private targetLane = -1
  private cfg = CONFIG.physics
  private layout: BoardLayout

  constructor(layout: BoardLayout) {
    this.layout = layout
    this.pegFlash = new Float32Array(layout.pegCount)
  }

  setTargetLane(lane: number): void {
    this.targetLane = lane
  }

  get target(): number {
    return this.targetLane
  }

  /** 发射：power ∈ [0,1] 决定水平初速（弱力落右侧、满力够到左半场） */
  launch(power: number): void {
    const p = Math.max(0, Math.min(1, power))
    this.bx = this.layout.spawn.x
    this.by = this.layout.spawn.y
    this.bvx = -(140 + 300 * p)
    this.bvy = 30 + 60 * (1 - p)
    this.trailLen = 0
    this.landedLane = -1
    this.state = 'flying'
  }

  /** 固定步长推进（1/120s），dt 单位秒 */
  step(dt: number): void {
    if (this.state !== 'flying') {
      this.decayFlash(dt)
      return
    }
    const { gravity, pegRestitution, wallRestitution, jitter, guideK, guideDamp } = this.cfg
    const L = this.layout
    const r = L.ballRadius

    // 末段引导（目标模式下）：渐进弹簧 + 阻尼，只在 guideLineY 以下生效
    if (this.targetLane >= 0 && this.by > L.guideLineY) {
      const tx = laneCenterX(L, this.targetLane)
      this.bvx += guideK * (tx - this.bx) * dt
      this.bvx *= Math.max(0, 1 - guideDamp * dt)
    }

    // 半隐式欧拉
    this.bvy += gravity * dt
    // 防静止：低速时随机扰动，打破钉顶平衡
    const sp2 = this.bvx * this.bvx + this.bvy * this.bvy
    if (sp2 < 30 * 30) this.bvx += (Math.random() - 0.5) * 36
    this.clampSpeed()
    this.bx += this.bvx * dt
    this.by += this.bvy * dt

    this.collidePegs(r, pegRestitution, jitter)
    this.collideWalls(r, wallRestitution)

    // 尾迹（环形写入）
    const idx = this.trailLen < TRAIL_LEN ? this.trailLen : (this.trailLen % TRAIL_LEN)
    this.trailX[idx] = this.bx
    this.trailY[idx] = this.by
    this.trailLen++

    // 落道传感器
    if (this.by >= L.lanes.landY) {
      let lane = laneIndexOf(L, this.bx)
      if (this.targetLane >= 0 && lane !== this.targetLane) {
        // 引导未完全收敛：钳到目标轨道（等价撞分道壁滑入）
        lane = this.targetLane
        this.bx = laneCenterX(L, lane)
      }
      this.landedLane = lane
      this.state = 'landed'
      if (this.onLanded) this.onLanded(lane)
    }
    this.decayFlash(dt)
  }

  reset(): void {
    this.state = 'idle'
    this.targetLane = -1
    this.landedLane = -1
    this.trailLen = 0
  }

  // ---------- 内部 ----------

  private clampSpeed(): void {
    const v2 = this.bvx * this.bvx + this.bvy * this.bvy
    if (v2 > MAX_SPEED * MAX_SPEED) {
      const s = MAX_SPEED / Math.sqrt(v2)
      this.bvx *= s
      this.bvy *= s
    }
  }

  private collidePegs(r: number, e: number, jitter: number): void {
    const pegs = this.layout.pegs
    const n = this.layout.pegCount
    for (let i = 0; i < n; i++) {
      const px = pegs[i * 3]
      const py = pegs[i * 3 + 1]
      const pr = pegs[i * 3 + 2]
      const dx = this.bx - px
      const dy = this.by - py
      const distSq = dx * dx + dy * dy
      const rr = r + pr
      if (distSq >= rr * rr || distSq === 0) continue
      const dist = Math.sqrt(distSq)
      const nx = dx / dist
      const ny = dy / dist
      // 位置修正
      const push = rr - dist
      this.bx += nx * push
      this.by += ny * push
      // 速度反射（法向分量 × 恢复系数，切向加微扰）
      const vn = this.bvx * nx + this.bvy * ny
      if (vn < 0) {
        const jx = (Math.random() * 2 - 1) * jitter
        const jy = (Math.random() * 2 - 1) * jitter
        this.bvx -= (1 + e) * vn * nx
        this.bvy -= (1 + e) * vn * ny
        this.bvx += jx * Math.abs(vn)
        this.bvy += jy * Math.abs(vn)
        // 最小反弹速度：防球在钉顶静止平衡
        const vn2 = this.bvx * nx + this.bvy * ny
        const MIN_BOUNCE = 55
        if (vn2 < MIN_BOUNCE) {
          const add = MIN_BOUNCE - vn2
          this.bvx += nx * add
          this.bvy += ny * add
        }
      }
      this.pegFlash[i] = 1
    }
  }

  private collideWalls(r: number, e: number): void {
    const L = this.layout
    // 轨道区：分道壁钳制（球被限制在单条轨道内）
    if (this.by >= L.lanes.top) {
      const lane = laneIndexOf(L, this.bx)
      const laneL = L.lanes.left + L.lanes.width * lane + r
      const laneR = L.lanes.left + L.lanes.width * (lane + 1) - r
      if (this.bx < laneL) {
        this.bx = laneL
        if (this.bvx < 0) this.bvx = -this.bvx * e
      } else if (this.bx > laneR) {
        this.bx = laneR
        if (this.bvx > 0) this.bvx = -this.bvx * e
      }
      return
    }
    // 外分道壁封口段：只允许在内侧 10 轨范围（漏斗聚中）
    if (this.by >= L.outerDividerTop && this.by < L.outerDividerBottom) {
      const innerL = L.lanes.left + L.lanes.width + r
      const innerR = L.lanes.left + L.lanes.width * (L.lanes.count - 1) - r
      if (this.bx < innerL) {
        this.bx = innerL
        if (this.bvx < 0) this.bvx = -this.bvx * e
      } else if (this.bx > innerR) {
        this.bx = innerR
        if (this.bvx > 0) this.bvx = -this.bvx * e
      }
      return
    }
    // 顶部发射区 + 下段开放区：外墙
    if (this.bx - r < L.wallLeft) {
      this.bx = L.wallLeft + r
      if (this.bvx < 0) this.bvx = -this.bvx * e
    } else if (this.bx + r > L.wallRight) {
      this.bx = L.wallRight - r
      if (this.bvx > 0) this.bvx = -this.bvx * e
    }
  }

  private decayFlash(dt: number): void {
    const f = this.pegFlash
    const k = Math.exp(-6 * dt)
    for (let i = 0; i < f.length; i++) {
      if (f[i] > 0.01) f[i] *= k
      else if (f[i] !== 0) f[i] = 0
    }
  }
}
