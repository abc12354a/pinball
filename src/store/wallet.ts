import { CONFIG, type CardDef } from '../config/config'
import type { EventReward, GameMode, RoundContext, SettleResult } from '../game/core/types'

/**
 * 玩家钱包（纯数据，持久化由 persist.ts 承担）：
 * 弹珠余额、产出模式、卡包、积分、统计。
 * 能量 authoritative 在状态机 ctx，这里只存镜像供恢复。
 */

export interface PlayerStats {
  rounds: number
  wins: number
  totalBet: number
  totalWin: number
  totalCards: number
  happyRounds: number
}

export interface PlayerState {
  version: 1
  balls: number
  mode: GameMode
  /** 卡包：cardId → 持有数 */
  cards: Record<string, number>
  /** 积分（卡片面值累计，礼品兑换用） */
  points: number
  /** 能量镜像（恢复状态机用） */
  energyLamps: number
  energyProgress: number
  stats: PlayerStats
}

export function createPlayer(): PlayerState {
  return {
    version: 1,
    balls: CONFIG.wallet.initialBalls,
    mode: 'ball',
    cards: {},
    points: 0,
    energyLamps: 0,
    energyProgress: 0,
    stats: { rounds: 0, wins: 0, totalBet: 0, totalWin: 0, totalCards: 0, happyRounds: 0 }
  }
}

export function cardDefOf(id: string): CardDef | undefined {
  return CONFIG.cardPool.find((c) => c.id === id)
}

/** 结算入账：退珠 + 抽到的卡（面值积分；续航卡按张数存，可兑珠） */
export function applySettle(p: PlayerState, r: SettleResult, ctx: RoundContext): void {
  p.balls += r.winBalls
  p.stats.rounds++
  if (r.isWin) p.stats.wins++
  if (ctx.happy.active) {
    p.stats.happyRounds++
  } else {
    p.stats.totalBet += ctx.betTotal
  }
  p.stats.totalWin += r.winBalls
  p.stats.totalCards += r.cards
  for (const id of r.cardIds) {
    p.cards[id] = (p.cards[id] ?? 0) + 1
    const def = cardDefOf(id)
    if (def) p.points += def.points
  }
}

/** 赛事奖励入账 */
export function applyReward(p: PlayerState, reward: EventReward): void {
  p.balls += reward.balls
  for (let i = 0; i < reward.cards; i++) {
    // 赛事发的基础卡按积分卡计
    p.cards['base'] = (p.cards['base'] ?? 0) + 1
    p.points += cardDefOf('base')?.points ?? 1
  }
  p.stats.totalCards += reward.cards
}

/** 续航卡兑珠：1 张换 redeemBalls 颗 */
export function redeemSustain(p: PlayerState): boolean {
  const have = p.cards['sustain'] ?? 0
  if (have <= 0) return false
  p.cards['sustain'] = have - 1
  p.balls += cardDefOf('sustain')?.redeemBalls ?? 20
  return true
}

/** 补充弹珠（调试/模拟"买珠"入口） */
export function addBalls(p: PlayerState, n: number): void {
  p.balls += n
}
