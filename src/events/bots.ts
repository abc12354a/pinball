import type { RNG } from '../game/core/rng'

/** 假玩家（机器人模拟联机，无真实后端） */
export interface BotEntry {
  name: string
  score: number
  isPlayer?: boolean
}

const NAME_POOL = [
  '快乐小猪', '弹珠大神', '摩兔', '塔比星球', '小锦鲤', '弹了个猪',
  '追风少年', '甜甜圈', '爆珠王', '默默攒卡', '阿宝', '夜猫子',
  '幸运星', '隔壁老王', '一键三连', '奶茶不加冰', '熊猫眼', '风一样的TA',
  '弹珠学徒', '中路钉子王'
]

export function makeBotNames(rng: RNG, count: number): string[] {
  const pool = NAME_POOL.slice()
  const names: string[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length)
    names.push(pool.splice(idx, 1)[0])
  }
  return names
}

/**
 * 生成假玩家分段分数：均匀铺在 [lo, hi]，玩家实际分插入后排名自然形成
 */
export function makeBotScores(rng: RNG, count: number, lo: number, hi: number): number[] {
  const scores: number[] = []
  for (let i = 0; i < count; i++) {
    const t = (i + rng() * 0.8) / count
    scores.push(Math.round(lo + t * (hi - lo)))
  }
  return scores
}
