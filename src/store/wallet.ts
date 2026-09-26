import { CONFIG, type CardDef } from '../config/config'
import type { GameMode, RoundContext, SettleResult } from '../game/core/types'

/**
 * 玩家钱包（纯数据，持久化由 persist.ts 承担）：
 * 弹珠余额、产出模式、卡包、积分、统计。
 */

export interface PlayerStats {
  rounds: number
  wins: number
  totalBet: number
  totalWin: number
  totalCards: number
}

export interface MissionProgress {
  progress: number
  claimed: boolean
}

export interface PlayerState {
  version: 1
  balls: number
  mode: GameMode
  /** 卡包：cardId → 持有数 */
  cards: Record<string, number>
  /** 积分（卡片面值累计，礼品兑换用） */
  points: number
  /** 已解锁母球皮肤列表 */
  unlockedSkins: string[]
  /** 当前装配母球皮肤 ID */
  activeSkin: string
  /** 每日任务进度: missionId -> progress */
  dailyMissions: Record<string, MissionProgress>
  /** 成就进度: achId -> progress */
  achievements: Record<string, MissionProgress>
  /** 最后签到/活跃日期 YYYY-MM-DD */
  lastLoginDate: string
  /** 当日剩余救济金次数 */
  dailyRescuesLeft: number
  /** 机师称号 */
  title: string
  stats: PlayerStats
}

function getTodayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function createPlayer(): PlayerState {
  const initialMissions: Record<string, MissionProgress> = {}
  CONFIG.missions.forEach((m) => {
    initialMissions[m.id] = { progress: m.id === 'daily_login' ? 1 : 0, claimed: false }
  })

  const initialAchievements: Record<string, MissionProgress> = {}
  CONFIG.achievements.forEach((a) => {
    initialAchievements[a.id] = { progress: 0, claimed: false }
  })

  return {
    version: 1,
    balls: CONFIG.wallet.initialBalls,
    mode: 'ball',
    cards: {},
    points: 0,
    unlockedSkins: ['default'],
    activeSkin: 'default',
    dailyMissions: initialMissions,
    achievements: initialAchievements,
    lastLoginDate: getTodayString(),
    dailyRescuesLeft: CONFIG.rescue.dailyLimit,
    title: '弹珠新秀',
    stats: { rounds: 0, wins: 0, totalBet: 0, totalWin: 0, totalCards: 0 }
  }
}

export function checkDailyReset(p: PlayerState): void {
  const today = getTodayString()
  if (p.lastLoginDate !== today) {
    p.lastLoginDate = today
    p.dailyRescuesLeft = CONFIG.rescue.dailyLimit
    p.dailyMissions = {}
    CONFIG.missions.forEach((m) => {
      p.dailyMissions[m.id] = { progress: m.id === 'daily_login' ? 1 : 0, claimed: false }
    })
  }
}

export function cardDefOf(id: string): CardDef | undefined {
  return CONFIG.cardPool.find((c) => c.id === id)
}

/** 结算入账：退珠 + 抽到的卡 + 任务与成就更新 */
export function applySettle(p: PlayerState, r: SettleResult, ctx: RoundContext): void {
  p.balls += r.winBalls
  p.stats.rounds++
  if (r.isWin) p.stats.wins++
  p.stats.totalBet += ctx.betTotal
  p.stats.totalWin += r.winBalls
  p.stats.totalCards += r.cards
  for (const id of r.cardIds) {
    p.cards[id] = (p.cards[id] ?? 0) + 1
    const def = cardDefOf(id)
    if (def) p.points += def.points
  }

  // 任务进度更新
  checkDailyReset(p)
  if (p.dailyMissions['daily_bet']) {
    p.dailyMissions['daily_bet'].progress += ctx.betTotal
  }
  if (r.isWin && p.dailyMissions['daily_win']) {
    p.dailyMissions['daily_win'].progress += 1
  }

  // 成就进度更新
  if (r.isWin && p.achievements['first_win']) {
    p.achievements['first_win'].progress = 1
  }
  if (ctx.betTotal >= 50 && p.achievements['high_roller']) {
    p.achievements['high_roller'].progress = 50
  }
  if (r.winBalls >= 100 && p.achievements['big_jackpot']) {
    p.achievements['big_jackpot'].progress = Math.max(p.achievements['big_jackpot'].progress, r.winBalls)
  }
  if (ctx.comboCount >= 3 && p.achievements['fever_master']) {
    p.achievements['fever_master'].progress = 3
  }
  if (r.cardIds.includes('legend') && p.achievements['koi_blessing']) {
    p.achievements['koi_blessing'].progress = 1
  }

  // 机师称号晋升计算
  if (p.stats.rounds >= 50 || p.points >= 500) {
    p.title = '传奇机皇'
  } else if (p.stats.rounds >= 20 || p.points >= 200) {
    p.title = '黄金机师'
  } else if (p.stats.rounds >= 5 || p.points >= 50) {
    p.title = '熟练机手'
  }
}

/** 续航卡兑珠：1 张换 redeemBalls 颗 */
export function redeemSustain(p: PlayerState): boolean {
  const have = p.cards['sustain'] ?? 0
  if (have <= 0) return false
  p.cards['sustain'] = have - 1
  p.balls += cardDefOf('sustain')?.redeemBalls ?? 20
  return true
}

/** 领取每日任务奖励 */
export function claimMission(p: PlayerState, id: string): boolean {
  checkDailyReset(p)
  const m = p.dailyMissions[id]
  const def = CONFIG.missions.find((x) => x.id === id)
  if (!m || !def || m.claimed || m.progress < def.target) return false
  m.claimed = true
  p.balls += def.rewardBalls
  p.points += def.rewardPoints
  return true
}

/** 领取成就奖励 */
export function claimAchievement(p: PlayerState, id: string): boolean {
  const a = p.achievements[id]
  const def = CONFIG.achievements.find((x) => x.id === id)
  if (!a || !def || a.claimed || a.progress < def.target) return false
  a.claimed = true
  p.balls += def.rewardBalls
  p.points += def.rewardPoints
  return true
}

/** 领取低保救济金 */
export function claimRescue(p: PlayerState): boolean {
  checkDailyReset(p)
  if (p.balls > CONFIG.rescue.minBallsTrigger || p.dailyRescuesLeft <= 0) return false
  p.balls += CONFIG.rescue.ballsGiven
  p.dailyRescuesLeft--
  return true
}

/** 购买母球皮肤 */
export function buySkin(p: PlayerState, skinId: string): boolean {
  const def = CONFIG.shop.skins.find((s) => s.id === skinId)
  if (!def || p.unlockedSkins.includes(skinId)) return false
  if (p.points < def.price) return false
  p.points -= def.price
  p.unlockedSkins.push(skinId)
  p.activeSkin = skinId
  return true
}

/** 装配母球皮肤 */
export function equipSkin(p: PlayerState, skinId: string): boolean {
  if (!p.unlockedSkins.includes(skinId)) return false
  p.activeSkin = skinId
  return true
}

/** 积分购买弹珠包 */
export function buyBallPack(p: PlayerState, packId: string): boolean {
  const def = CONFIG.shop.packs.find((x) => x.id === packId)
  if (!def || p.points < def.costPoints) return false
  p.points -= def.costPoints
  p.balls += def.balls
  return true
}

/** 补充弹珠（调试/模拟"买珠"入口） */
export function addBalls(p: PlayerState, n: number): void {
  p.balls += n
}
