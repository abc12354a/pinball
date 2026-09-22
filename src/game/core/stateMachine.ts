import { CONFIG } from '../../config/config'
import { computeSettle, litLanesOf, pickLane, rollMult } from './lottery'
import type { RNG } from './rng'
import type { EventReward, GameEvent, GameMode, Phase, RoundContext, SettleResult } from './types'

/**
 * 一局状态机（规格书 8(1)）：
 * IDLE → READY → ROLL_MULT → BET_WINDOW → FIRE → PHYSICS → SETTLE → BONUS_CHECK → IDLE
 * 能量满：BONUS_CHECK → ROLL_MULT(短) → …（开心30秒免费子循环）
 * 任意状态 ← EVENT_INVITE 打断 → ONLINE_MINIGAME → 恢复快照
 *
 * 纯逻辑、无小程序依赖：
 * - 时间经 tick(nowMs) 注入（绝对时间戳，切后台回来仍准确）
 * - 钱包/能量持久化由外部监听者完成，机器只记录数值
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
const HAPPY_ROLL_ANIM_MS = 400

function freshCtx(mode: GameMode): RoundContext {
  return {
    betTotal: 0,
    mult: 0,
    litLanes: [],
    targetLane: -1,
    isWin: false,
    mode,
    happy: { active: false, endTime: 0 },
    energyLamps: 0,
    energyProgress: 0,
    charging: false,
    chargeStartTs: 0,
    rollEndTs: 0,
    windowEndTs: 0,
    physicsStartTs: 0,
    settleStartTs: 0,
    invite: null,
    snapshot: null,
    lastSettle: null,
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
      case 'LANDED':
        this.onLanded(e.lane)
        break
      case 'SETTLE_DONE':
        this.requirePhase('SETTLE')
        this.afterSettle()
        break
      case 'INVITE':
        this.onInvite(e.eventId)
        break
      case 'JOIN':
        this.onJoin()
        break
      case 'EVENT_DONE':
        this.onEventDone(e.reward)
        break
      case 'HAPPY_TIMEOUT':
        this.requirePhase('HAPPY30S')
        this.endHappy()
        break
    }
  }

  /** 时间推进：倒计时类状态转移（加注窗口/物理安全超时/报名/开心30秒） */
  tick(nowMs: number = this.now()): void {
    switch (this.phase) {
      case 'ROLL_MULT':
        if (nowMs >= this.ctx.rollEndTs) {
          // 开心30秒子循环：短动画后进待发射态（显示倒计时），无加注窗口
          if (this.ctx.happy.active) this.setPhase('HAPPY30S')
          else this.enterBetWindow(nowMs)
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
      case 'EVENT_INVITE':
        if (this.ctx.invite && nowMs >= this.ctx.invite.endTs) {
          if (this.ctx.invite.joined) this.setPhase('ONLINE_MINIGAME')
          else this.restoreSnapshot()
        }
        break
      case 'HAPPY30S':
        if (this.ctx.happy.active && nowMs >= this.ctx.happy.endTime) this.endHappy()
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
    if (this.phase === 'FIRE' || this.phase === 'HAPPY30S') {
      this.ctx.charging = true
      this.ctx.chargeStartTs = this.now()
      if (this.phase === 'HAPPY30S') this.setPhase('FIRE')
      else this.notify()
    } else {
      throw new Error(`CHARGE_START illegal in ${this.phase}`)
    }
  }

  private onChargeEnd(power: number): void {
    this.requirePhase('FIRE')
    if (!this.ctx.charging) throw new Error('CHARGE_END without CHARGE_START')
    const p = Math.max(0, Math.min(1, power))
    // ★ 落点在此刻抽出（松手瞬间），物理全程只做表现
    this.ctx.targetLane = pickLane(
      this.rng,
      { mult: this.ctx.mult, power: p, mode: this.ctx.mode, happy: this.ctx.happy.active },
      this.cfg
    )
    this.ctx.charging = false
    this.ctx.physicsStartTs = this.now()
    this.setPhase('PHYSICS')
  }

  private onLanded(lane: number): void {
    this.requirePhase('PHYSICS')
    if (lane !== this.ctx.targetLane) {
      throw new Error(`LANDED lane ${lane} !== target ${this.ctx.targetLane}`)
    }
    const effBet = this.ctx.happy.active ? this.cfg.energy.happyNominalBet : this.ctx.betTotal
    const settle: SettleResult = computeSettle(
      this.rng, effBet, this.ctx.mult, lane, this.ctx.mode, this.cfg
    )
    this.ctx.isWin = settle.isWin
    this.ctx.lastSettle = settle
    this.accumulateEnergy()
    this.ctx.settleStartTs = this.now()
    this.setPhase('SETTLE')
  }

  private onInvite(eventId: string): void {
    if (this.phase === 'EVENT_INVITE' || this.phase === 'ONLINE_MINIGAME') return
    const snap: RoundContext = { ...this.ctx, snapshot: null, invite: null, charging: false }
    this.ctx.snapshot = { phase: this.phase, ctx: snap }
    this.ctx.invite = { eventId, endTs: this.now() + this.cfg.events.signupMs, joined: false }
    this.setPhase('EVENT_INVITE')
  }

  private onJoin(): void {
    this.requirePhase('EVENT_INVITE')
    if (this.ctx.invite) this.ctx.invite.joined = true
    this.notify()
  }

  private onEventDone(reward?: EventReward): void {
    this.requirePhase('ONLINE_MINIGAME')
    this.restoreSnapshot()
    if (reward) {
      // 发奖数值挂到 lastSettle 之外的通道：由引擎监听者读取（见 GameEngine）
      this.pendingReward = reward
      this.notify()
      this.pendingReward = null
    }
  }

  /** 赛事奖励瞬时通道（onEventDone 通知期间可读） */
  pendingReward: EventReward | null = null

  // ---------- 阶段进入 ----------

  private enterRollMult(animMs: number): void {
    this.ctx.mult = rollMult(this.rng, this.cfg)
    this.ctx.litLanes = litLanesOf(this.ctx.mult, this.cfg)
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

  /** SETTLE → BONUS_CHECK 的自动裁决 */
  private afterSettle(): void {
    this.setPhase('BONUS_CHECK')
    const now = this.now()
    if (this.ctx.happy.active) {
      if (now < this.ctx.happy.endTime) {
        this.enterRollMult(HAPPY_ROLL_ANIM_MS)
      } else {
        this.endHappy()
      }
    } else if (this.ctx.energyLamps >= this.cfg.energy.lampCount) {
      // 能量满：消耗并进入开心30秒（下一局自动免费）
      this.ctx.energyLamps = 0
      this.ctx.energyProgress = 0
      this.ctx.happy = { active: true, endTime: now + this.cfg.energy.happyDurationMs }
      this.resetRound() // 清上一局投注（免费局无投注，UI 显示"免费"）
      this.enterRollMult(HAPPY_ROLL_ANIM_MS)
    } else {
      this.resetRound()
      this.setPhase('IDLE')
    }
  }

  private endHappy(): void {
    this.ctx.happy = { active: false, endTime: 0 }
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
  }

  private restoreSnapshot(): void {
    const snap = this.ctx.snapshot
    this.ctx.invite = null
    this.ctx.snapshot = null
    if (!snap) {
      this.resetRound()
      this.setPhase('IDLE')
      return
    }
    // 快照恢复：PHYSICS 中被打断的球由引擎 fast-forward（再 dispatch LANDED）
    this.ctx = snap.ctx
    this.setPhase(snap.phase)
  }

  // ---------- 能量 ----------

  private accumulateEnergy(): void {
    if (this.ctx.happy.active) return // 免费局不计能量
    const { ballsPerLamp, lampCount } = this.cfg.energy
    this.ctx.energyProgress += this.ctx.betTotal
    while (
      this.ctx.energyProgress >= ballsPerLamp &&
      this.ctx.energyLamps < lampCount
    ) {
      this.ctx.energyProgress -= ballsPerLamp
      this.ctx.energyLamps++
    }
    if (this.ctx.energyLamps >= lampCount) this.ctx.energyProgress = 0
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
