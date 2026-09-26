import { CONFIG } from '../../config/config'
import { computeSettle, litLanesOf, pickLane, rollMult } from './lottery'
import type { RNG } from './rng'
import type { GameEvent, GameMode, Phase, RoundContext, SettleResult } from './types'

/**
 * 一局状态机（规格书 8(1)）：
 * IDLE → READY → ROLL_MULT → BET_WINDOW → FIRE → PHYSICS → SETTLE → BONUS_CHECK → IDLE
 *
 * 纯逻辑、无小程序依赖：
 * - 时间经 tick(nowMs) 注入（绝对时间戳，切后台回来仍准确）
 * - 钱包持久化由外部监听者完成，机器只记录数值
 * - 非法转移直接 throw（开发期暴露 bug）
 */

export type MachineListener = (phase: Phase, ctx: RoundContext) => void

export interface MachineDeps {
  rng: RNG
  /** 当前产出模式（按开始时锁定进 ctx.mode） */
  getMode?: () => GameMode
  /** 时间源，默认 Date.now；测试注入固定时钟 */
  now?: () => number
  cfg?: typeof CONFIG
}

const PHYSICS_SAFETY_MS = 8000

function freshCtx(mode: GameMode): RoundContext {
  return {
    betTotal: 0,
    mult: 0,
    litLanes: [],
    targetLane: -1,
    isWin: false,
    mode,
    charging: false,
    chargeStartTs: 0,
    rollEndTs: 0,
    windowEndTs: 0,
    physicsStartTs: 0,
    settleStartTs: 0,
    lastSettle: null,
    comboCount: 0,
    feverActive: false,
    bumperHits: 0,
    roundSeq: 0
  }
}

export class StateMachine {
  phase: Phase = 'IDLE'
  ctx: RoundContext
  private cfg: typeof CONFIG
  private rng: RNG
  private getMode: () => GameMode
  private now: () => number
  private listeners: MachineListener[] = []
  /** 变更版本号，供外部 store 做浅比较 */
  version = 0

  constructor(deps: MachineDeps) {
    this.cfg = deps.cfg ?? CONFIG
    this.rng = deps.rng
    this.getMode = deps.getMode ?? (() => 'ball')
    this.now = deps.now ?? Date.now
    this.ctx = freshCtx(this.getMode())
  }

  subscribe(fn: MachineListener): () => void {
    this.listeners.push(fn)
    return () => {
      const i = this.listeners.indexOf(fn)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  /** 玩家可见的余额无关提示：待机是否可开局 */
  get canStart(): boolean {
    return this.phase === 'READY'
  }

  dispatch(e: GameEvent): void {
    switch (e.t) {
      case 'INSERT':
        this.onInsert(e.n)
        break
      case 'CONFIRM_BET':
        this.onConfirmBet()
        break
      case 'WINDOW_TIMEOUT':
        this.requirePhase('BET_WINDOW')
        this.enterFire()
        break
      case 'CHARGE_START':
        this.onChargeStart()
        break
      case 'CHARGE_END':
        this.onChargeEnd(e.power)
        break
      case 'BUMPER_HIT':
        this.onBumperHit(e.index)
        break
      case 'LANDED':
        this.onLanded(e.lane)
        break
      case 'SETTLE_DONE':
        this.requirePhase('SETTLE')
        this.afterSettle()
        break
    }
  }

  /** 时间推进：倒计时类状态转移（加注窗口/物理安全超时） */
  tick(nowMs: number = this.now()): void {
    switch (this.phase) {
      case 'ROLL_MULT':
        if (nowMs >= this.ctx.rollEndTs) {
          this.enterBetWindow(nowMs)
        }
        break
      case 'BET_WINDOW':
        if (nowMs >= this.ctx.windowEndTs) this.enterFire()
        break
      case 'PHYSICS':
        if (nowMs - this.ctx.physicsStartTs > PHYSICS_SAFETY_MS) {
          // 物理表现卡死（切后台等）：按已定落点直接结算
          this.onLanded(this.ctx.targetLane)
        }
        break
    }
  }

  // ---------- 事件处理 ----------

  private onInsert(n: number): void {
    // 投珠口物理上随时可投：仅投注相关相位受理，其余静默忽略
    if (this.phase !== 'IDLE' && this.phase !== 'READY' && this.phase !== 'BET_WINDOW') return
    if (n <= 0) return
    this.ctx.betTotal = Math.min(this.ctx.betTotal + n, this.cfg.bet.max)
    if (this.phase === 'IDLE' && this.ctx.betTotal >= this.cfg.bet.min) {
      this.setPhase('READY')
    } else {
      this.notify()
    }
  }

  private onConfirmBet(): void {
    if (this.phase === 'READY') {
      this.ctx.mode = this.getMode()
      this.ctx.roundSeq++
      this.enterRollMult(this.cfg.mult.rollAnimMs)
    } else if (this.phase === 'BET_WINDOW') {
      // 提前结束加注窗口
      this.enterFire()
    } else {
      throw new Error(`CONFIRM_BET illegal in ${this.phase}`)
    }
  }

  private onChargeStart(): void {
    // 亮灯后允许直接拉杆：先自动确认投注进入 FIRE，再开始蓄力
    if (this.phase === 'BET_WINDOW') {
      this.enterFire()
    }
    if (this.phase !== 'FIRE') {
      throw new Error(`CHARGE_START illegal in ${this.phase}`)
    }
    this.ctx.charging = true
    this.ctx.chargeStartTs = this.now()
    this.notify()
  }

  private onChargeEnd(power: number): void {
    this.requirePhase('FIRE')
    if (!this.ctx.charging) throw new Error('CHARGE_END without CHARGE_START')
    const p = Math.max(0, Math.min(1, power))
    // ★ 落点在此刻抽出（松手瞬间），物理全程只做表现
    this.ctx.targetLane = pickLane(
      this.rng,
      { mult: this.ctx.mult, power: p, mode: this.ctx.mode },
      this.cfg
    )
    this.ctx.charging = false
    this.ctx.physicsStartTs = this.now()
    this.setPhase('PHYSICS')
  }

  private onBumperHit(_index: number): void {
    this.ctx.bumperHits++
    this.notify()
  }

  private onLanded(lane: number): void {
    this.requirePhase('PHYSICS')
    if (lane !== this.ctx.targetLane) {
      throw new Error(`LANDED lane ${lane} !== target ${this.ctx.targetLane}`)
    }
    const settle: SettleResult = computeSettle(
      this.rng, this.ctx.betTotal, this.ctx.mult, lane, this.ctx.mode, this.cfg
    )
    this.ctx.isWin = settle.isWin
    if (settle.isWin) {
      this.ctx.comboCount++
      if (this.ctx.comboCount >= this.cfg.combo.feverThreshold) {
        this.ctx.feverActive = true
      }
      if (this.ctx.comboCount > 1 && settle.winBalls > 0) {
        const bonus = Math.floor(settle.winBalls * (this.ctx.comboCount - 1) * this.cfg.combo.bonusPerCombo)
        settle.winBalls += bonus
      }
    } else {
      this.ctx.comboCount = 0
      this.ctx.feverActive = false
    }
    this.ctx.lastSettle = settle
    this.ctx.settleStartTs = this.now()
    this.setPhase('SETTLE')
  }

  // ---------- 阶段进入 ----------

  private enterRollMult(animMs: number): void {
    this.ctx.mult = rollMult(this.rng, this.cfg)
    let lit = [...litLanesOf(this.ctx.mult, this.cfg)]
    if (this.ctx.feverActive && lit.length > 0) {
      const candidateNeighbors = [lit[0] - 1, lit[lit.length - 1] + 1].filter(
        (l) => l >= 0 && l < this.cfg.board.laneCount && lit.indexOf(l) < 0
      )
      if (candidateNeighbors.length > 0) {
        lit.push(candidateNeighbors[0])
        lit.sort((a, b) => a - b)
      }
    }
    this.ctx.litLanes = lit
    this.ctx.rollEndTs = this.now() + animMs
    this.setPhase('ROLL_MULT')
  }

  private enterBetWindow(nowMs: number): void {
    this.ctx.windowEndTs = nowMs + this.cfg.bet.windowMs
    this.setPhase('BET_WINDOW')
  }

  private enterFire(): void {
    this.setPhase('FIRE')
  }

  /** SETTLE → BONUS_CHECK（瞬时过渡）→ IDLE */
  private afterSettle(): void {
    this.setPhase('BONUS_CHECK')
    this.resetRound()
    this.setPhase('IDLE')
  }

  private resetRound(): void {
    this.ctx.betTotal = 0
    this.ctx.mult = 0
    this.ctx.litLanes = []
    this.ctx.targetLane = -1
    this.ctx.isWin = false
    this.ctx.charging = false
    this.ctx.bumperHits = 0
  }

  // ---------- 基础设施 ----------

  private requirePhase(p: Phase): void {
    if (this.phase !== p) throw new Error(`event illegal in ${this.phase} (expect ${p})`)
  }

  private setPhase(p: Phase): void {
    this.phase = p
    this.notify()
  }

  private notify(): void {
    this.version++
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i](this.phase, this.ctx)
    }
  }
}
