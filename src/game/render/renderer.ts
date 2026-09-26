import { CONFIG } from '../../config/config'
import type { BoardLayout } from './board'
import type { PlinkoWorld } from '../physics/world'
import { SINK_DEPTH } from '../physics/world'
import type { StateMachine } from '../core/stateMachine'
import type { Phase } from '../core/types'
import { ParticlePool, ScreenShake, FloatingTextPool, PayoutHopper } from './effects'

/**
 * Canvas2D 渲染器：霓虹街机风。
 * 具备微屏幕震动 (ScreenShake)、碰撞火花、小球速度形变、倍数滚轮、落道冲天激光与中奖喷珠瀑布。
 */

export class Renderer {
  readonly particles = new ParticlePool()
  readonly shake = new ScreenShake()
  readonly floatingTexts = new FloatingTextPool()
  readonly payoutHopper = new PayoutHopper()

  /** 中奖轨道爆闪倒计时（秒） */
  private winFlash = 0
  private winLane = -1
  /** 倍数锁定余韵（秒）：ROLL_MULT 结束瞬间触发弹跳/粒子/亮灯爆发 */
  private multLockFlash = 0
  private lastDrawnPhase: Phase | '' = ''
  /** 出珠计数器：中奖额 + 已数到值 + 剩余展示时长（秒） */
  private payoutTotal = 0
  private payoutShown = 0
  private payoutTimer = 0
  /** 蓄力进度 [0,1]，引擎写入 */
  chargePower = 0
  /** 母球皮肤设置 */
  ballSkin = { color: '#a8dcff', glow: '#5aa8e8' }
  /** 投珠滑入：单球到位回调（引擎接音效） */
  onFeederArrive: (() => void) | null = null
  /** 投料滑轨小球池（10 槽预分配，零 GC） */
  private feederPool: { active: boolean; t: number; delay: number }[] = []
  /** 投料路径（弧长参数化折线）：底部右侧沿轨道上行 → 弯入发射口 */
  private feederPathX: Float32Array
  private feederPathY: Float32Array
  private feederPathCum: Float32Array

  constructor(
    private ctx: CanvasRenderingContext2D,
    private layout: BoardLayout,
    private world: PlinkoWorld,
    private sm: StateMachine
  ) {
    for (let i = 0; i < 10; i++) this.feederPool.push({ active: false, t: 0, delay: 0 })

    // 预计算投料路径：右缘垂直上行段 + 发射轨弯道（drawRail 同款二次曲线采样）
    const L = this.layout
    const baseY = L.height * 0.975
    const xs: number[] = [L.width - 12]
    const ys: number[] = [baseY - 10]
    const p0x = L.width - 12
    const p0y = L.spawn.y + 26
    const p1x = L.width - 12
    const p1y = L.spawn.y - 8
    const p2x = L.spawn.x - 14
    const p2y = L.spawn.y - 8
    xs.push(p0x)
    ys.push(p0y) // 垂直段终点 = 曲线起点
    for (let i = 1; i <= 8; i++) {
      const t = i / 8
      const mt = 1 - t
      xs.push(mt * mt * p0x + 2 * mt * t * p1x + t * t * p2x)
      ys.push(mt * mt * p0y + 2 * mt * t * p1y + t * t * p2y)
    }
    const n = xs.length
    this.feederPathX = new Float32Array(xs)
    this.feederPathY = new Float32Array(ys)
    this.feederPathCum = new Float32Array(n)
    for (let i = 1; i < n; i++) {
      const dx = xs[i] - xs[i - 1]
      const dy = ys[i] - ys[i - 1]
      this.feederPathCum[i] = this.feederPathCum[i - 1] + Math.sqrt(dx * dx + dy * dy)
    }
  }

  /** 投料路径取样：s ∈ [0,1]（弧长比例）→ 坐标 */
  private feederAt(s: number, out: { x: number; y: number }): void {
    const total = this.feederPathCum[this.feederPathCum.length - 1]
    const target = Math.max(0, Math.min(1, s)) * total
    for (let i = 1; i < this.feederPathCum.length; i++) {
      if (this.feederPathCum[i] >= target) {
        const seg = this.feederPathCum[i] - this.feederPathCum[i - 1]
        const f = seg > 0 ? (target - this.feederPathCum[i - 1]) / seg : 0
        out.x = this.feederPathX[i - 1] + (this.feederPathX[i] - this.feederPathX[i - 1]) * f
        out.y = this.feederPathY[i - 1] + (this.feederPathY[i] - this.feederPathY[i - 1]) * f
        return
      }
    }
    out.x = this.feederPathX[this.feederPathX.length - 1]
    out.y = this.feederPathY[this.feederPathY.length - 1]
  }

  /** 中奖特效：轨道爆闪 + 鱼贯喷珠瀑布 + 出珠计数器 + 冲天光柱 + 全屏礼花 */
  celebrate(lane: number, winBalls = 0): void {
    this.winFlash = 1.0
    this.winLane = lane
    this.shake.addTrauma(0.55)
    const cx = this.layout.lanes.left + this.layout.lanes.width * (lane + 0.5)
    this.particles.burst(cx, this.layout.lanes.landY - 6, 36)
    this.particles.confetti(this.layout.width, winBalls > 50 ? 50 : 25)
    // 喷珠数量与中奖额挂钩（8~30 颗鱼贯喷出）
    this.payoutHopper.spawnFromLane(
      cx,
      this.layout.lanes.landY,
      Math.min(30, Math.max(8, Math.ceil(winBalls / 3)))
    )
    // 出珠计数器：+N 珠随喷流递增（1.2s 数完，共展示 2.2s）
    this.payoutTotal = winBalls
    this.payoutShown = 0
    this.payoutTimer = 2.2
    const text = winBalls > 80 ? `CRITICAL!` : winBalls > 0 ? `+${winBalls} 珠` : '中奖!'
    this.floatingTexts.spawn(text, cx, this.layout.lanes.landY - 24, '#ffd76e', 24)
  }

  /** 黄金钉被撞击时的金色粒子爆发与震屏 */
  celebrateBumper(x: number, y: number): void {
    this.shake.addTrauma(0.3)
    this.particles.spark(x, y, 0, -1, 10)
    this.particles.burst(x, y, 16, ['#ffd76e', '#ff9f43', '#ffffff'])
    this.floatingTexts.spawn('+1 珠', x, y - 16, '#ffd76e', 18)
  }

  /** 触发投珠滑入动画：count 颗（视觉上限 10），沿右侧轨道鱼贯上行入发射口 */
  triggerFeederAnimation(count = 5): void {
    const visual = Math.min(Math.max(1, count), 10)
    let spawned = 0
    for (let i = 0; i < this.feederPool.length && spawned < visual; i++) {
      const fb = this.feederPool[i]
      if (fb.active) continue
      fb.active = true
      fb.t = 0
      fb.delay = spawned * 0.07
      spawned++
    }
    if (spawned > 0) {
      this.floatingTexts.spawn(
        `+${count} 珠`,
        this.layout.width - 92,
        this.layout.spawn.y + 44,
        '#7ecbff',
        20
      )
    }
  }

  step(dtSec: number): void {
    this.shake.step(dtSec)
    this.particles.step(dtSec)
    this.floatingTexts.step(dtSec)
    this.payoutHopper.step(dtSec, this.layout.height * 0.975)
    if (this.winFlash > 0) this.winFlash -= dtSec
    if (this.multLockFlash > 0) this.multLockFlash -= dtSec
    if (this.payoutTimer > 0) {
      this.payoutTimer -= dtSec
      const counting = Math.max(0, Math.min(1, (2.2 - this.payoutTimer) / 1.2))
      this.payoutShown = Math.round(this.payoutTotal * counting)
    }

    // 推进投料滑轨小球（单程 0.9s，easeInOut 由绘制端处理）
    for (let i = 0; i < this.feederPool.length; i++) {
      const fb = this.feederPool[i]
      if (!fb.active) continue
      if (fb.delay > 0) {
        fb.delay -= dtSec
        continue
      }
      fb.t += dtSec / 0.9
      if (fb.t >= 1) {
        fb.active = false
        this.particles.burst(this.layout.spawn.x, this.layout.spawn.y, 5, ['#d0e8ff', '#7ecbff'])
        this.onFeederArrive?.()
      }
    }
  }

  /** physW/physH：画布物理像素尺寸（letterbox 清全屏用；坐标 transform 已由引擎设好） */
  draw(physW: number, physH: number): void {
    const ctx = this.ctx
    const L = this.layout
    const litLanes = this.sm.ctx.litLanes
    const { charging } = this.sm.ctx

    // 绘制街机机箱外部装饰背景（避免黑色虚空，融入立式弹珠机体感）
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#100a1a'
    ctx.fillRect(0, 0, physW, physH)
    // 侧边装饰条
    const sideG = ctx.createLinearGradient(0, 0, physW, 0)
    sideG.addColorStop(0, 'rgba(45, 25, 75, 0.8)')
    sideG.addColorStop(0.15, 'rgba(22, 15, 33, 0.4)')
    sideG.addColorStop(0.85, 'rgba(22, 15, 33, 0.4)')
    sideG.addColorStop(1, 'rgba(45, 25, 75, 0.8)')
    ctx.fillStyle = sideG
    ctx.fillRect(0, 0, physW, physH)
    ctx.restore()

    ctx.save()
    // 注入微屏幕震动
    if (this.shake.offsetX !== 0 || this.shake.offsetY !== 0) {
      ctx.translate(this.shake.offsetX, this.shake.offsetY)
    }

    // 倍数滚轮转移检测：ROLL_MULT 结束瞬间 → 锁定特效（弹跳 + 粒子 + 浮字）
    const phase = this.sm.phase
    if (this.lastDrawnPhase === 'ROLL_MULT' && phase !== 'ROLL_MULT') {
      this.multLockFlash = 0.45
      const cx = L.width / 2
      const cy = L.height * 0.5
      this.particles.burst(cx, cy, 18, ['#ffd76e', '#ffffff', '#ff9f43'])
      this.floatingTexts.spawn(`×${this.sm.ctx.mult} 锁定！`, cx, cy - L.height * 0.09, '#ffd76e', 22)
    }
    this.lastDrawnPhase = phase

    this.drawBackground()

    // 中奖垂直冲天激光光柱
    if (this.winFlash > 0 && this.winLane >= 0) {
      this.drawWinningBeam(this.winLane)
    }

    // 轨道灯：锁定后才点亮（滚动期间保持熄灭，锁定瞬间随 multLockFlash 爆发）
    const litSet = litLanes
    const rolling = phase === 'ROLL_MULT'
    for (let i = 0; i < L.lanes.count; i++) {
      const isLit = !rolling && litSet.indexOf(i) >= 0
      let boost = this.winFlash > 0 && i === this.winLane ? this.winFlash : 0
      if (isLit && this.multLockFlash > 0) boost += this.multLockFlash * 0.8
      this.drawLaneLight(i, isLit, boost)
    }

    this.drawPegs()
    this.drawDividers()
    this.drawRail()
    if (rolling || this.multLockFlash > 0) this.drawMultRoll()
    this.drawFeederBalls()
    this.drawBall()
    this.payoutHopper.draw(ctx)
    this.particles.draw(ctx)
    this.floatingTexts.draw(ctx)
    this.drawPayoutCounter()
    if (charging) this.drawPowerBar()

    ctx.restore()
  }

  // ---------- 各图层 ----------

  private drawBackground(): void {
    const ctx = this.ctx
    const L = this.layout
    ctx.fillStyle = '#1b1230'
    ctx.fillRect(0, 0, L.width, L.height)

    // 氛围渐变：普通 / 狂热 FEVER
    const g = ctx.createLinearGradient(0, 0, 0, L.height)
    if (this.sm.ctx.feverActive) {
      g.addColorStop(0, 'rgba(255, 180, 0, 0.32)')
      g.addColorStop(0.4, 'rgba(255, 77, 94, 0.18)')
      g.addColorStop(0.8, 'rgba(27, 18, 48, 0)')
    } else {
      g.addColorStop(0, 'rgba(120, 80, 220, 0.18)')
      g.addColorStop(0.5, 'rgba(27, 18, 48, 0)')
    }
    ctx.fillStyle = g
    ctx.fillRect(0, 0, L.width, L.height)
  }

  private drawLaneLight(i: number, isLit: boolean, boost: number): void {
    const ctx = this.ctx
    const L = this.layout
    const x = L.lanes.left + L.lanes.width * (i + 0.5)
    const y = L.lanes.landY + L.height * 0.025
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
      const isBumper = L.bumperIndices?.indexOf(i) >= 0

      if (isBumper) {
        // 黄金弹性蘑菇钉
        const br = 7
        const glow = 10 + f * 12
        const bg = ctx.createRadialGradient(x, y, 0, x, y, br + glow)
        bg.addColorStop(0, `rgba(255, 215, 110, ${0.45 + f * 0.5})`)
        bg.addColorStop(1, 'rgba(255, 165, 0, 0)')
        ctx.fillStyle = bg
        ctx.beginPath()
        ctx.arc(x, y, br + glow, 0, Math.PI * 2)
        ctx.fill()

        const core = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, br)
        core.addColorStop(0, '#ffffff')
        core.addColorStop(0.3, '#fff0a3')
        core.addColorStop(0.8, '#ffb800')
        core.addColorStop(1, '#d48800')
        ctx.fillStyle = core
        ctx.beginPath()
        ctx.arc(x, y, br, 0, Math.PI * 2)
        ctx.fill()

        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.2
        ctx.stroke()
      } else if (f > 0.05) {
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
    const baseY = L.height * 0.975
    ctx.strokeStyle = '#4a3a6a'
    ctx.lineWidth = 3
    ctx.beginPath()
    // 内部分道壁
    for (let i = 1; i < L.lanes.count; i++) {
      const x = L.lanes.left + L.lanes.width * i
      ctx.moveTo(x, L.lanes.top)
      ctx.lineTo(x, baseY)
    }
    // 外分道壁：封口段更长（漏斗结构）
    const outerL = L.lanes.left + L.lanes.width
    const outerR = L.lanes.left + L.lanes.width * (L.lanes.count - 1)
    ctx.moveTo(outerL, L.outerDividerTop)
    ctx.lineTo(outerL, baseY)
    ctx.moveTo(outerR, L.outerDividerTop)
    ctx.lineTo(outerR, baseY)
    // 底板
    ctx.moveTo(L.wallLeft, baseY)
    ctx.lineTo(L.wallRight, baseY)
    ctx.stroke()
  }

  /** 发射轨道（视觉装饰）：右上进入槽 */
  private drawRail(): void {
    const ctx = this.ctx
    const L = this.layout
    ctx.strokeStyle = 'rgba(126, 203, 255, 0.4)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(L.width - 12, L.height * 0.975)
    ctx.lineTo(L.width - 12, L.spawn.y + 26)
    ctx.quadraticCurveTo(L.width - 12, L.spawn.y - 8, L.spawn.x - 14, L.spawn.y - 8)
    ctx.stroke()
  }

  /** 倍数滚轮：中央面板老虎机式减速翻数 → 锁定弹跳（arcTo 圆角，小程序 canvas 兼容） */
  private drawMultRoll(): void {
    const ctx = this.ctx
    const L = this.layout
    const cx = L.width / 2
    const cy = L.height * 0.5
    const pw = L.width * 0.62
    const ph = L.height * 0.15
    const now = Date.now()
    const rolling = this.sm.phase === 'ROLL_MULT'

    // 面板底（手绘圆角矩形）
    const r = 14
    const x0 = cx - pw / 2
    const y0 = cy - ph / 2
    ctx.beginPath()
    ctx.moveTo(x0 + r, y0)
    ctx.arcTo(x0 + pw, y0, x0 + pw, y0 + ph, r)
    ctx.arcTo(x0 + pw, y0 + ph, x0, y0 + ph, r)
    ctx.arcTo(x0, y0 + ph, x0, y0, r)
    ctx.arcTo(x0, y0, x0 + pw, y0, r)
    ctx.closePath()
    ctx.fillStyle = 'rgba(20, 13, 36, 0.8)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 215, 110, 0.85)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    let value: number
    let offsetY = 0
    let scale = 1
    if (rolling) {
      // t: 0→1 等速推进，翻数频率按 (1-(1-t)^3) 减速（老虎机手感）
      const t = Math.max(0, Math.min(1, 1 - (this.sm.ctx.rollEndTs - now) / CONFIG.mult.rollAnimMs))
      const flips = Math.floor(16 * (1 - Math.pow(1 - t, 3)))
      value = CONFIG.mult.levels[flips % CONFIG.mult.levels.length]
      offsetY = (((t * 16) % 1) - 0.5) * 8 // 翻页竖直偏移
    } else {
      value = this.sm.ctx.mult
      // 锁定弹跳：1.6 → 1（easeOutBack 过冲）
      const p = Math.max(0, Math.min(1, 1 - this.multLockFlash / 0.45))
      const c1 = 1.70158
      const c3 = c1 + 1
      const e = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
      scale = 1.6 - 0.6 * e
    }

    ctx.translate(cx, cy + offsetY)
    ctx.scale(scale, scale)
    ctx.font = `bold ${Math.round(ph * 0.62)}px sans-serif`
    ctx.fillStyle = rolling ? '#e8ddfa' : '#ffd76e'
    ctx.shadowColor = rolling ? 'rgba(126, 203, 255, 0.6)' : 'rgba(255, 215, 110, 0.8)'
    ctx.shadowBlur = 12
    ctx.fillText(`${value}×`, 0, 0)
    ctx.shadowBlur = 0
    ctx.font = `bold ${Math.round(ph * 0.16)}px sans-serif`
    ctx.fillStyle = 'rgba(207, 195, 232, 0.8)'
    ctx.fillText(rolling ? '倍数滚动中' : 'MULTIPLIER', 0, ph * 0.32)
    ctx.restore()
  }

  /** 出珠计数器：棋盘上方居中大号 "+N 珠"，随喷流递增，末段淡出 */
  private drawPayoutCounter(): void {
    if (this.payoutTimer <= 0 || this.payoutTotal <= 0) return
    const ctx = this.ctx
    const L = this.layout
    const alpha = Math.min(1, this.payoutTimer / 0.4)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.round(L.height * 0.062)}px sans-serif`
    ctx.fillStyle = '#ffd76e'
    ctx.shadowColor = 'rgba(255, 180, 0, 0.9)'
    ctx.shadowBlur = 16
    ctx.fillText(`+${this.payoutShown} 珠`, L.width / 2, L.height * 0.14)
    ctx.restore()
  }

  private drawFeederBalls(): void {
    const ctx = this.ctx
    const pos = { x: 0, y: 0 }
    const ghost = { x: 0, y: 0 }
    const r = 10.5
    for (let i = 0; i < this.feederPool.length; i++) {
      const fb = this.feederPool[i]
      if (!fb.active || fb.delay > 0) continue
      const t = Math.min(1, fb.t)
      // easeInOut：起步加速 → 入口减速
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      this.feederAt(eased, pos)

      // 拖尾重影（身后 2 枚渐隐）
      for (let g = 0; g < 2; g++) {
        const gt = Math.max(0, eased - 0.055 * (g + 1))
        this.feederAt(gt, ghost)
        ctx.fillStyle = `rgba(126, 203, 255, ${0.3 - g * 0.15})`
        ctx.beginPath()
        ctx.arc(ghost.x, ghost.y, r - g, 0, Math.PI * 2)
        ctx.fill()
      }

      // 外发光光晕
      const halo = ctx.createRadialGradient(pos.x, pos.y, r * 0.4, pos.x, pos.y, r * 2.2)
      halo.addColorStop(0, 'rgba(126, 203, 255, 0.28)')
      halo.addColorStop(1, 'rgba(126, 203, 255, 0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, r * 2.2, 0, Math.PI * 2)
      ctx.fill()

      // 球体
      const g2 = ctx.createRadialGradient(pos.x - 3, pos.y - 3, 1, pos.x, pos.y, r)
      g2.addColorStop(0, '#ffffff')
      g2.addColorStop(0.4, '#d0e8ff')
      g2.addColorStop(1, '#7ecbff')
      ctx.fillStyle = g2
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawWinningBeam(lane: number): void {
    const ctx = this.ctx
    const L = this.layout
    const cx = L.lanes.left + L.lanes.width * (lane + 0.5)
    const w = L.lanes.width * 0.95
    const topY = L.height * 0.07
    const g = ctx.createLinearGradient(0, topY, 0, L.lanes.landY)
    g.addColorStop(0, 'rgba(255, 215, 110, 0)')
    g.addColorStop(0.3, `rgba(255, 215, 110, ${0.25 * this.winFlash})`)
    g.addColorStop(0.8, `rgba(255, 77, 94, ${0.45 * this.winFlash})`)
    g.addColorStop(1, `rgba(255, 255, 255, ${0.8 * this.winFlash})`)
    ctx.fillStyle = g
    ctx.fillRect(cx - w / 2, topY, w, L.lanes.landY - L.height * 0.05)
  }

  private drawBall(): void {
    const ctx = this.ctx
    const w = this.world
    const L = this.layout
    if (w.state === 'idle') return

    // 沉入机器：暗色口袋 + 球体按进度缩小淡出（landed 后残留在口袋里）
    const inPocket = w.state === 'sinking' || w.state === 'landed'
    let pocketP = 0
    if (inPocket) {
      pocketP = Math.max(0, Math.min(1, (w.by - L.lanes.landY) / SINK_DEPTH))
      const px = L.lanes.left + L.lanes.width * ((w.landedLane >= 0 ? w.landedLane : 0) + 0.5)
      const py = L.lanes.landY + L.height * 0.012
      ctx.beginPath()
      ctx.ellipse(px, py, L.lanes.width * 0.32, 5, 0, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // 尾迹（sinking 起已清零）
    const n = Math.min(w.trailLen, w.trailX.length)
    for (let i = 1; i <= n; i++) {
      const idx = (w.trailLen - i + w.trailX.length * 2) % w.trailX.length
      const alpha = 0.28 * (1 - i / n)
      if (alpha <= 0.02) continue
      ctx.fillStyle = this.ballSkin.glow + Math.round(alpha * 255).toString(16).padStart(2, '0')
      ctx.beginPath()
      ctx.arc(w.trailX[idx], w.trailY[idx], this.layout.ballRadius * (1 - i / (n * 1.5)), 0, Math.PI * 2)
      ctx.fill()
    }

    // 物理速度形变 (Squash & Stretch)
    const r = this.layout.ballRadius * (1 - 0.55 * pocketP)
    const speed = Math.sqrt(w.bvx * w.bvx + w.bvy * w.bvy)
    const stretch = 1 + Math.min(0.28, speed / 1400)
    const squash = 1 / Math.sqrt(stretch)
    const angle = Math.atan2(w.bvy, w.bvx)

    ctx.save()
    ctx.globalAlpha = 1 - 0.75 * pocketP
    ctx.translate(w.bx, w.by)
    if (speed > 40) ctx.rotate(angle)
    ctx.scale(stretch, squash)

    // 球体（径向渐变高光，使用自定义皮肤）
    const g = ctx.createRadialGradient(-3, -4, 1, 0, 0, r)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.4, this.ballSkin.color)
    g.addColorStop(1, this.ballSkin.glow)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /** 蓄力条：右侧竖条 */
  private drawPowerBar(): void {
    const ctx = this.ctx
    const L = this.layout
    const x = L.width - 26
    const h = Math.round(L.height * 0.21)
    const y = Math.round(L.height * 0.27)
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
