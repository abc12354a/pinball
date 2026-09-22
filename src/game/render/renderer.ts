import type { BoardLayout } from './board'
import type { PlinkoWorld } from '../physics/world'
import type { StateMachine } from '../core/stateMachine'
import { ParticlePool } from './effects'

/**
 * Canvas2D 渲染器：霓虹街机风。
 * 每帧全量重绘（单球 ~60 钉，量级极小）；逻辑坐标 375×560，
 * scale = min(cw/375, ch/560)，居中，dpr 由外部 setTransform 一次性处理。
 */

export class Renderer {
  private particles = new ParticlePool()
  /** 中奖轨道爆闪倒计时（秒） */
  private winFlash = 0
  private winLane = -1
  /** 蓄力进度 [0,1]，引擎写入 */
  chargePower = 0
  /** 亮灯轨覆盖（巅峰对决期间由赛事提供；null = 用状态机 ctx） */
  litOverride: number[] | null = null

  constructor(
    private ctx: CanvasRenderingContext2D,
    private layout: BoardLayout,
    private world: PlinkoWorld,
    private sm: StateMachine
  ) {}

  /** 中奖特效：轨道爆闪 + 粒子喷发 */
  celebrate(lane: number): void {
    this.winFlash = 0.9
    this.winLane = lane
    const cx = this.layout.lanes.left + this.layout.lanes.width * (lane + 0.5)
    this.particles.burst(cx, this.layout.lanes.landY - 6, 36)
  }

  step(dtSec: number): void {
    this.particles.step(dtSec)
    if (this.winFlash > 0) this.winFlash -= dtSec
  }

  /** physW/physH：画布物理像素尺寸（letterbox 清全屏用；坐标 transform 已由引擎设好） */
  draw(physW: number, physH: number): void {
    const ctx = this.ctx
    const L = this.layout
    const litLanes = this.litOverride ?? this.sm.ctx.litLanes
    const { charging } = this.sm.ctx
    // 全屏清底（含逻辑板外的 letterbox 区）
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#160f21'
    ctx.fillRect(0, 0, physW, physH)
    ctx.restore()
    this.drawBackground()

    // 轨道灯（ROLL_MULT 亮灯后开始显示；中奖爆闪加强）
    const litSet = litLanes
    for (let i = 0; i < L.lanes.count; i++) {
      const isLit = litSet.indexOf(i) >= 0
      const boost = this.winFlash > 0 && i === this.winLane ? this.winFlash : 0
      this.drawLaneLight(i, isLit, boost)
    }

    this.drawPegs()
    this.drawDividers()
    this.drawRail()
    this.drawBall()
    this.particles.draw(ctx)
    if (charging) this.drawPowerBar()
  }

  // ---------- 各图层 ----------

  private drawBackground(): void {
    const ctx = this.ctx
    const L = this.layout
    ctx.fillStyle = '#1b1230'
    ctx.fillRect(0, 0, L.width, L.height)
    // 顶部氛围渐变
    const g = ctx.createLinearGradient(0, 0, 0, L.height)
    g.addColorStop(0, 'rgba(120, 80, 220, 0.18)')
    g.addColorStop(0.5, 'rgba(27, 18, 48, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, L.width, L.height)
  }

  private drawLaneLight(i: number, isLit: boolean, boost: number): void {
    const ctx = this.ctx
    const L = this.layout
    const x = L.lanes.left + L.lanes.width * (i + 0.5)
    const y = L.lanes.landY + 14
    const base = isLit ? 1 : 0
    // 光晕
    const glowR = 10 + base * 8 + boost * 14
    if (isLit || boost > 0) {
      const alpha = 0.35 + boost * 0.5
      const g = ctx.createRadialGradient(x, y, 0, x, y, glowR)
      g.addColorStop(0, `rgba(255, 77, 94, ${alpha})`)
      g.addColorStop(1, 'rgba(255, 77, 94, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, glowR, 0, Math.PI * 2)
      ctx.fill()
    }
    // 灯体
    ctx.fillStyle = isLit ? '#ff4d5e' : '#3a2b55'
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fill()
    if (isLit) {
      ctx.fillStyle = `rgba(255, 220, 220, ${0.6 + boost * 0.4})`
      ctx.beginPath()
      ctx.arc(x - 1.5, y - 1.5, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawPegs(): void {
    const ctx = this.ctx
    const L = this.layout
    const pegs = L.pegs
    const flash = this.world.pegFlash
    for (let i = 0; i < L.pegCount; i++) {
      const x = pegs[i * 3]
      const y = pegs[i * 3 + 1]
      const r = pegs[i * 3 + 2]
      const f = flash[i]
      if (f > 0.05) {
        ctx.fillStyle = `rgba(255, 240, 180, ${0.5 + f * 0.5})`
        ctx.beginPath()
        ctx.arc(x, y, r + f * 2.5, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillStyle = '#e8b64c'
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  private drawDividers(): void {
    const ctx = this.ctx
    const L = this.layout
    ctx.strokeStyle = '#4a3a6a'
    ctx.lineWidth = 3
    ctx.beginPath()
    // 内部分道壁
    for (let i = 1; i < L.lanes.count; i++) {
      const x = L.lanes.left + L.lanes.width * i
      ctx.moveTo(x, L.lanes.top)
      ctx.lineTo(x, L.height - 14)
    }
    // 外分道壁：封口段更长（漏斗结构）
    const outerL = L.lanes.left + L.lanes.width
    const outerR = L.lanes.left + L.lanes.width * (L.lanes.count - 1)
    ctx.moveTo(outerL, L.outerDividerTop)
    ctx.lineTo(outerL, L.height - 14)
    ctx.moveTo(outerR, L.outerDividerTop)
    ctx.lineTo(outerR, L.height - 14)
    // 底板
    ctx.moveTo(L.wallLeft, L.height - 14)
    ctx.lineTo(L.wallRight, L.height - 14)
    ctx.stroke()
  }

  /** 发射轨道（视觉装饰）：右上进入槽 */
  private drawRail(): void {
    const ctx = this.ctx
    const L = this.layout
    ctx.strokeStyle = 'rgba(126, 203, 255, 0.4)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(L.width - 12, L.height - 14)
    ctx.lineTo(L.width - 12, L.spawn.y + 26)
    ctx.quadraticCurveTo(L.width - 12, L.spawn.y - 8, L.spawn.x - 14, L.spawn.y - 8)
    ctx.stroke()
  }

  private drawBall(): void {
    const ctx = this.ctx
    const w = this.world
    if (w.state === 'idle') return
    // 尾迹
    const n = Math.min(w.trailLen, w.trailX.length)
    for (let i = 1; i <= n; i++) {
      const idx = (w.trailLen - i + w.trailX.length * 2) % w.trailX.length
      const alpha = 0.25 * (1 - i / n)
      if (alpha <= 0.02) continue
      ctx.fillStyle = `rgba(126, 203, 255, ${alpha})`
      ctx.beginPath()
      ctx.arc(w.trailX[idx], w.trailY[idx], this.layout.ballRadius * (1 - i / (n * 1.5)), 0, Math.PI * 2)
      ctx.fill()
    }
    // 球体（径向渐变高光）
    const r = this.layout.ballRadius
    const g = ctx.createRadialGradient(w.bx - 3, w.by - 4, 1, w.bx, w.by, r)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.4, '#a8dcff')
    g.addColorStop(1, '#5aa8e8')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(w.bx, w.by, r, 0, Math.PI * 2)
    ctx.fill()
  }

  /** 蓄力条：右侧竖条 */
  private drawPowerBar(): void {
    const ctx = this.ctx
    const L = this.layout
    const x = L.width - 26
    const h = 120
    const y = 150
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(x, y, 8, h)
    const p = this.chargePower
    const grad = ctx.createLinearGradient(x, y + h, x, y)
    grad.addColorStop(0, '#7ecbff')
    grad.addColorStop(0.6, '#ffd76e')
    grad.addColorStop(1, '#ff6b81')
    ctx.fillStyle = grad
    ctx.fillRect(x, y + h * (1 - p), 8, h * p)
    // 刻度
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < 4; i++) {
      ctx.moveTo(x, y + (h / 4) * i)
      ctx.lineTo(x + 8, y + (h / 4) * i)
    }
    ctx.stroke()
  }
}
