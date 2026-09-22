import Taro from '@tarojs/taro'
import { CONFIG } from '../config/config'
import { StateMachine } from './core/stateMachine'
import { createRng } from './core/rng'
import type { EventReward, GameMode, Phase, RoundContext, SettleResult } from './core/types'
import { GameLoop, type CanvasLike } from './loop'
import { PlinkoWorld } from './physics/world'
import { createBoard } from './render/board'
import { Renderer } from './render/renderer'
import { TournamentRunner, type TournamentId } from '../events/tournaments'
import { EventScheduler } from '../events/scheduler'

/**
 * GameEngine —— 粘合层：状态机 + 物理 + 渲染 + 触摸 + 赛事 + 主循环。
 *
 * React 边界约定：frame 内零 setState；对外只通过 machine 通知 + onSettle/onReward 回调。
 */

export interface EngineHooks {
  /** 结算落地（进 SETTLE 时调用一次）：由 store 应用退珠/出卡/能量持久化 */
  onSettle?: (result: SettleResult, ctx: RoundContext) => void
  /** 赛事奖励（EVENT_DONE 恢复快照时经 pendingReward 通道转发） */
  onReward?: (reward: EventReward) => void
  getMode?: () => GameMode
}

/** 蓄力往返周期：力度条 0→1→0 往复（保留"时机"手感，防"必胜力道"） */
const CHARGE_PERIOD_MS = 1600
const SETTLE_WIN_MS = 1500
const SETTLE_LOSE_MS = 800
const SETTLE_HAPPY_MS = 450

export class GameEngine {
  readonly sm: StateMachine
  readonly world: PlinkoWorld
  readonly renderer: Renderer
  readonly tournament: TournamentRunner
  private scheduler: EventScheduler
  private rng = createRng()
  private loop: GameLoop
  private acc = 0
  private power = 0.5
  private settleDoneAt = 0
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
    this.hooks = hooks
    const dpr = Math.min(Taro.getSystemInfoSync().pixelRatio, 2)
    const layout = createBoard()
    this.world = new PlinkoWorld(layout)
    this.sm = new StateMachine({ rng: this.rng, getMode: hooks.getMode })
    this.tournament = new TournamentRunner(this.sm, this.rng)
    const ctx2d = canvas.getContext('2d')
    this.renderer = new Renderer(ctx2d, layout, this.world, this.sm)

    // 画布物理尺寸 + 逻辑坐标缩放（375×560 居中）
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    this.physW = canvas.width
    this.physH = canvas.height
    const scale = Math.min(cssWidth / layout.width, cssHeight / layout.height)
    const ox = (cssWidth - layout.width * scale) / 2
    const oy = (cssHeight - layout.height * scale) / 2
    ctx2d.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy)

    this.world.onLanded = (lane) => {
      if (this.sm.phase === 'PHYSICS') {
        this.sm.dispatch({ t: 'LANDED', lane })
      } else if (this.sm.phase === 'ONLINE_MINIGAME') {
        // 巅峰对决：命中亮灯道计分
        this.tournament.onDuelLanded(lane)
      }
      // 其余情况（赛事打断中的旧球）：只记录，恢复时 fast-forward
    }
    this.sm.subscribe((phase, ctx) => {
      // 赛事奖励瞬时通道（EVENT_DONE 派发期间可读）
      if (this.sm.pendingReward) this.hooks.onReward?.(this.sm.pendingReward)
      this.onPhaseChange(phase, ctx)
    })
    // 巅峰对决发射：直接驱动钉板（不经状态机）
    this.tournament.onDuelLaunch = (lane, power) => {
      this.world.setTargetLane(lane)
      this.world.launch(power)
    }
    this.scheduler = new EventScheduler(Date.now())
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
    // 赛事期间：决斗蓄力 / 拍打类计分
    if (this.sm.phase === 'ONLINE_MINIGAME') {
      if (this.tournament.chargeStart()) return
      this.tournament.tap()
      return
    }
    if (this.sm.phase === 'FIRE' || this.sm.phase === 'HAPPY30S') {
      this.sm.dispatch({ t: 'CHARGE_START' })
    }
  }

  handleTouchEnd(): void {
    if (this.sm.phase === 'ONLINE_MINIGAME') {
      this.tournament.chargeEnd(this.tournament.chargePower)
      return
    }
    if (this.sm.ctx.charging && this.sm.phase === 'FIRE') {
      this.power = this.chargePowerNow()
      this.sm.dispatch({ t: 'CHARGE_END', power: this.power })
    }
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

    // 赛事：推进中的倒计时/结算 + 定时轮换发起新赛事
    this.tournament.tick(now)
    this.scheduler.tick(
      now,
      () =>
        this.sm.phase !== 'EVENT_INVITE' &&
        this.sm.phase !== 'ONLINE_MINIGAME',
      (id: TournamentId) => this.tournament.startInvite(id, now)
    )

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
    } else if (this.tournament.isCharging) {
      this.renderer.chargePower = this.tournament.chargePower
    }
    // 决斗期间亮灯轨来自赛事（状态机 ctx 处于快照态）
    this.renderer.litOverride =
      this.sm.phase === 'ONLINE_MINIGAME' && this.tournament.getSnapshot().id === 'duel'
        ? this.tournament.duelLitLanes
        : null
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

    if (phase === 'PHYSICS') {
      // 赛事恢复：球已落道 → fast-forward 结算；否则继续飞
      if (this.world.state === 'flying') return
      if (this.world.state === 'landed') {
        this.sm.dispatch({ t: 'LANDED', lane: this.world.landedLane })
        return
      }
      this.world.setTargetLane(ctx.targetLane)
      this.world.launch(this.power)
      return
    }

    if (phase === 'SETTLE') {
      const r = ctx.lastSettle
      if (r && r.isWin) {
        this.renderer.celebrate(ctx.targetLane)
        // 中奖震动反馈（接口不可用时静默）
        try {
          Taro.vibrateShort({ type: 'medium' })
        } catch {
          // ignore
        }
      }
      if (this.hooks.onSettle && r) this.hooks.onSettle(r, ctx)
      const dur = ctx.happy.active
        ? SETTLE_HAPPY_MS
        : r && r.isWin
          ? SETTLE_WIN_MS
          : SETTLE_LOSE_MS
      this.settleDoneAt = Date.now() + dur
      return
    }

    if (phase === 'IDLE' && prev !== 'IDLE') {
      this.world.reset()
    }
  }
}
