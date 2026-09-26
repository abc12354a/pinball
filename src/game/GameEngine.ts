import Taro from '@tarojs/taro'
import { CONFIG } from '../config/config'
import { StateMachine } from './core/stateMachine'
import { createRng } from './core/rng'
import type { GameMode, Phase, RoundContext, SettleResult } from './core/types'
import { GameLoop, type CanvasLike } from './loop'
import { PlinkoWorld } from './physics/world'
import { createBoard } from './render/board'
import { Renderer } from './render/renderer'
import { soundManager } from '../audio/soundManager'

/**
 * GameEngine —— 粘合层：状态机 + 物理 + 渲染 + 触摸 + 主循环。
 *
 * React 边界约定：frame 内零 setState；对外只通过 machine 通知 + onSettle 回调。
 */

export interface EngineHooks {
  /** 结算落地（进 SETTLE 时调用一次）：由 store 应用退珠/出卡持久化 */
  onSettle?: (result: SettleResult, ctx: RoundContext) => void
  /** 黄金钉微奖励 */
  onBumperReward?: (balls: number) => void
  getMode?: () => GameMode
}

/** 蓄力往返周期：力度条 0→1→0 往复（保留"时机"手感，防"必胜力道"） */
const CHARGE_PERIOD_MS = 1600
const SETTLE_WIN_MS = 1500
const SETTLE_LOSE_MS = 800

export class GameEngine {
  readonly sm: StateMachine
  readonly world: PlinkoWorld
  readonly renderer: Renderer
  private rng = createRng()
  private loop: GameLoop
  private acc = 0
  private power = 0.5
  private settleDoneAt = 0
  private lastRollTickAt = 0
  private prevPhase: Phase = 'IDLE'
  private pausedAt = 0
  private hooks: EngineHooks
  /** 画布物理尺寸（清全屏用） */
  private physW = 0
  private physH = 0

  constructor(
    canvas: CanvasLike,
    cssWidth: number,
    cssHeight: number,
    hooks: EngineHooks = {}
  ) {
    let dpr = 2
    try {
      dpr = Math.min((Taro as any).getWindowInfo?.()?.pixelRatio || Taro.getSystemInfoSync?.()?.pixelRatio || 2, 3)
    } catch {
      dpr = 2
    }
    this.hooks = hooks
    // 自适应板高：保持 375 宽基准，按画布纵横比缩放高度（480~640 钳制）
    // → scale ≈ cssW/375，棋盘宽度撑满、四周零留白
    const targetH = Math.round((CONFIG.board.width * cssHeight) / cssWidth)
    const layout = createBoard(targetH)
    this.world = new PlinkoWorld(layout)
    this.sm = new StateMachine({ rng: this.rng, getMode: hooks.getMode })
    const ctx2d = canvas.getContext('2d')
    this.renderer = new Renderer(ctx2d, layout, this.world, this.sm)

    // 画布物理尺寸 + 逻辑坐标缩放（375 宽基准，按画布纵横比适配高度，居中）
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    this.physW = canvas.width
    this.physH = canvas.height
    const scale = Math.min(cssWidth / layout.width, cssHeight / layout.height)
    const ox = (cssWidth - layout.width * scale) / 2
    const oy = (cssHeight - layout.height * scale) / 2
    ctx2d.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy)

    this.world.onPegHit = (x, y, nx, ny, depthRatio, speed) => {
      const impactTrauma = Math.min(0.35, 0.08 + speed * 0.0003)
      this.renderer.shake.addTrauma(impactTrauma)
      this.renderer.particles.spark(x, y, nx, ny, 4)
      soundManager.playBounce(depthRatio)
    }

    this.world.onBumperHit = (index) => {
      this.sm.dispatch({ t: 'BUMPER_HIT', index })
      const px = layout.pegs[index * 3]
      const py = layout.pegs[index * 3 + 1]
      this.renderer.celebrateBumper(px, py)
      soundManager.playBumper()
      this.hooks.onBumperReward?.(CONFIG.bumpers?.rewardBalls ?? 1)
    }

    this.world.onLanded = (lane) => {
      if (this.sm.phase === 'PHYSICS') {
        this.sm.dispatch({ t: 'LANDED', lane })
      }
    }
    // 投珠滑入：每颗到位时清脆咔哒声（与 playCoin/playFeederRoll 不叠加）
    this.renderer.onFeederArrive = () => soundManager.playRollTick(1.2)
    this.sm.subscribe((phase, ctx) => {
      this.onPhaseChange(phase, ctx)
    })
    this.loop = new GameLoop(canvas, (dtMs) => this.frame(dtMs))
  }

  start(): void {
    this.loop.start()
  }

  destroy(): void {
    this.loop.stop()
  }

  pause(): void {
    this.pausedAt = Date.now()
    this.loop.stop()
  }

  resume(): void {
    const awayMs = this.pausedAt ? Date.now() - this.pausedAt : 0
    // PHYSICS 中离开超 3s：跳过动画直接按已定落点结算
    if (this.sm.phase === 'PHYSICS' && awayMs > 3000) {
      this.sm.dispatch({ t: 'LANDED', lane: this.sm.ctx.targetLane })
    }
    this.pausedAt = 0
    this.loop.start()
  }

  // ---------- 触摸（整块画布 = 拉杆） ----------

  handleTouchStart(): void {
    if (this.sm.phase === 'FIRE' || this.sm.phase === 'BET_WINDOW') {
      this.sm.dispatch({ t: 'CHARGE_START' })
    }
  }

  handleTouchEnd(): void {
    if (this.sm.ctx.charging && this.sm.phase === 'FIRE') {
      this.power = this.chargePowerNow()
      this.sm.dispatch({ t: 'CHARGE_END', power: this.power })
    }
  }

  /** 外部直接通过拉杆力度发射（支持拟真拖拽释放与快速连发；BET_WINDOW 自动确认投注） */
  launchWithPower(power: number): void {
    if (this.sm.phase === 'FIRE' || this.sm.phase === 'BET_WINDOW') {
      this.power = Math.max(0.1, Math.min(1, power))
      soundManager.playPlungerRelease()
      if (!this.sm.ctx.charging) {
        this.sm.dispatch({ t: 'CHARGE_START' })
      }
      this.sm.dispatch({ t: 'CHARGE_END', power: this.power })
    }
  }

  /** 触发小球入道滑入动画与音效 */
  triggerFeeder(count = 1): void {
    this.renderer.triggerFeederAnimation(count)
    soundManager.playFeederRoll()
  }

  setBallSkin(color: string, glow: string): void {
    this.renderer.ballSkin = { color, glow }
  }

  /** 当前蓄力值（力度条往返） */
  private chargePowerNow(): number {
    const held = Date.now() - this.sm.ctx.chargeStartTs
    const ph = (held % CHARGE_PERIOD_MS) / (CHARGE_PERIOD_MS / 2)
    return Math.max(0, Math.min(1, ph <= 1 ? ph : 2 - ph))
  }

  // ---------- 主循环 ----------

  private frame(dtMs: number): void {
    const now = Date.now()
    this.sm.tick(now)

    // 倍数滚动：每 110ms 一次跳动音，音调随进度上扬（渲染层同步翻数）
    if (this.sm.phase === 'ROLL_MULT') {
      const total = CONFIG.mult.rollAnimMs
      const elapsed = Math.max(0, total - Math.max(0, this.sm.ctx.rollEndTs - now))
      if (now - this.lastRollTickAt >= 110) {
        this.lastRollTickAt = now
        soundManager.playRollTick(0.9 + 0.5 * Math.min(1, elapsed / total))
      }
    }

    // 结算动画时长 → 自动 SETTLE_DONE
    if (this.sm.phase === 'SETTLE' && now >= this.settleDoneAt) {
      this.sm.dispatch({ t: 'SETTLE_DONE' })
    }

    // 固定步长子步进（封顶 4）
    const fixedMs = CONFIG.physics.fixedDt * 1000
    this.acc = Math.min(this.acc + dtMs, fixedMs * CONFIG.physics.maxSubSteps)
    let steps = 0
    while (this.acc >= fixedMs && steps < CONFIG.physics.maxSubSteps) {
      this.world.step(CONFIG.physics.fixedDt)
      this.acc -= fixedMs
      steps++
    }

    if (this.sm.ctx.charging) {
      this.renderer.chargePower = this.chargePowerNow()
    }
    this.renderer.step(dtMs / 1000)
    this.renderer.draw(this.physW, this.physH)
  }

  // ---------- 状态机 → 引擎联动 ----------

  private onPhaseChange(phase: Phase, ctx: RoundContext): void {
    // 只在"阶段变化"时动作（ctx 微调通知会重复触发同 phase）
    const changed = phase !== this.prevPhase
    const prev = this.prevPhase
    this.prevPhase = phase
    if (!changed) return

    if (phase === 'ROLL_MULT') {
      this.lastRollTickAt = 0
    }

    if (phase === 'BET_WINDOW' && prev === 'ROLL_MULT') {
      soundManager.playRollTick(1.8) // 锁定咔哒
    }

    if (phase === 'PHYSICS') {
      soundManager.playLaunch()
      this.world.setTargetLane(ctx.targetLane)
      this.world.launch(this.power)
      return
    }

    if (phase === 'SETTLE') {
      const r = ctx.lastSettle
      if (r && r.isWin) {
        this.renderer.celebrate(ctx.targetLane, r.winBalls)
        soundManager.playWin()
        if (r.winBalls > 0) {
          soundManager.playPayoutStream(Math.min(12, Math.max(3, Math.floor(r.winBalls / 5))))
        }
        if (ctx.feverActive) soundManager.playFever()
      }
      if (this.hooks.onSettle && r) this.hooks.onSettle(r, ctx)
      const dur = r && r.isWin ? SETTLE_WIN_MS : SETTLE_LOSE_MS
      this.settleDoneAt = Date.now() + dur
      return
    }

    if (phase === 'IDLE' && prev !== 'IDLE') {
      this.world.reset()
    }
  }
}
