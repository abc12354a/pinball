import { useSyncExternalStore } from 'react'
import { CONFIG } from '../config/config'
import type { StateMachine } from '../game/core/stateMachine'
import type { RoundContext, SettleResult } from '../game/core/types'
import {
  applySettle,
  buyBallPack,
  buySkin,
  claimAchievement,
  claimMission,
  claimRescue,
  createPlayer,
  equipSkin,
  redeemSustain,
  type PlayerState
} from './wallet'
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

  /** 绑定状态机（页面挂载时）：insert/toggleMode 需要读写机器 */
  attach(sm: StateMachine): () => void {
    this.sm = sm
    return () => {
      if (this.sm === sm) this.sm = null
    }
  }

  /** 引擎 onSettle 回调 */
  handleSettle = (r: SettleResult, ctx: RoundContext): void => {
    applySettle(this.player, r, ctx)
    this.commit()
  }

  /** 黄金钉微奖励 */
  handleBumperReward = (balls: number): void => {
    this.player.balls += balls
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

  /** 领取每日任务 */
  claimMission(id: string): boolean {
    const ok = claimMission(this.player, id)
    if (ok) this.commit()
    return ok
  }

  /** 领取成就 */
  claimAchievement(id: string): boolean {
    const ok = claimAchievement(this.player, id)
    if (ok) this.commit()
    return ok
  }

  /** 领取低保救济金 */
  claimRescue(): boolean {
    const ok = claimRescue(this.player)
    if (ok) this.commit()
    return ok
  }

  /** 购买母球皮肤 */
  buySkin(skinId: string): boolean {
    const ok = buySkin(this.player, skinId)
    if (ok) this.commit()
    return ok
  }

  /** 装配母球皮肤 */
  equipSkin(skinId: string): boolean {
    const ok = equipSkin(this.player, skinId)
    if (ok) this.commit()
    return ok
  }

  /** 积分购买弹珠包 */
  buyBallPack(packId: string): boolean {
    const ok = buyBallPack(this.player, packId)
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
