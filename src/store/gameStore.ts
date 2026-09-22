import { useSyncExternalStore } from 'react'
import { CONFIG } from '../config/config'
import type { StateMachine } from '../game/core/stateMachine'
import type { EventReward, RoundContext, SettleResult } from '../game/core/types'
import { applyReward, applySettle, createPlayer, redeemSustain, type PlayerState } from './wallet'
import { loadPlayer, savePlayer } from './persist'

/**
 * GameStore —— 钱包/模式/持久化的单一出口，桥接状态机 ↔ React。
 * 性能铁律：游戏 tick 内零通知（状态机只在相位转移/事件时 notify，均为低频）。
 */

export interface GameSnapshot {
  version: number
  player: PlayerState
}

export class GameStore {
  player: PlayerState
  private sm: StateMachine | null = null
  private listeners: (() => void)[] = []
  private snap: GameSnapshot
  private snapVersion = 0

  constructor(initial?: PlayerState) {
    this.player = initial ?? loadPlayer()
    this.snap = { version: 0, player: this.player }
  }

  /** 绑定状态机（页面挂载时）：恢复能量镜像并订阅变化 */
  attach(sm: StateMachine): () => void {
    this.sm = sm
    sm.ctx.energyLamps = this.player.energyLamps
    sm.ctx.energyProgress = this.player.energyProgress
    return sm.subscribe((_phase, ctx) => {
      this.player.energyLamps = ctx.energyLamps
      this.player.energyProgress = ctx.energyProgress
      this.commit()
    })
  }

  /** 引擎 onSettle 回调 */
  handleSettle = (r: SettleResult, ctx: RoundContext): void => {
    applySettle(this.player, r, ctx)
    this.commit()
  }

  /** 赛事奖励（引擎 pendingReward 通道） */
  handleReward = (reward: EventReward): void => {
    applyReward(this.player, reward)
    this.commit()
  }

  /** 投珠：余额/上限校验通过才扣款并派发 INSERT */
  insert(n: number): { ok: boolean; reason?: string } {
    if (this.player.balls < n) return { ok: false, reason: '弹珠不足' }
    const betTotal = this.sm?.ctx.betTotal ?? 0
    if (betTotal + n > CONFIG.bet.max) return { ok: false, reason: `单局上限${CONFIG.bet.max}颗` }
    if (this.sm) this.sm.dispatch({ t: 'INSERT', n })
    this.player.balls -= n
    this.commit()
    return { ok: true }
  }

  /** 模式切换：仅待机/已投注阶段允许 */
  toggleMode(): boolean {
    if (!this.sm) return false
    const p = this.sm.phase
    if (p !== 'IDLE' && p !== 'READY') return false
    this.player.mode = this.player.mode === 'ball' ? 'card' : 'ball'
    this.commit()
    return true
  }

  /** 续航卡兑珠 */
  redeem(): boolean {
    const ok = redeemSustain(this.player)
    if (ok) this.commit()
    return ok
  }

  /** 补珠（模拟"买珠"入口：自娱版免费补给） */
  refill(n = 100): void {
    this.player.balls += n
    this.commit()
  }

  /** 重置存档（调试入口） */
  reset(): void {
    this.player = createPlayer()
    if (this.sm) {
      this.sm.ctx.energyLamps = 0
      this.sm.ctx.energyProgress = 0
    }
    this.commit()
  }

  getSnapshot = (): GameSnapshot => this.snap

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.push(fn)
    return () => {
      const i = this.listeners.indexOf(fn)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  private commit(): void {
    savePlayer(this.player)
    this.snapVersion++
    this.snap = { version: this.snapVersion, player: this.player }
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i]()
  }
}

/** React 绑定 */
export function useGameStore(store: GameStore): GameSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
