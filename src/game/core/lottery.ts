import { CONFIG, type CardDef } from '../../config/config'
import type { GameMode, SettleResult } from './types'
import type { RNG } from './rng'

/**
 * 概率核心：纯函数，无副作用。
 * 与 scripts/simulate.ts 共用 —— 调难度只改 CONFIG，不改这里。
 *
 * 三层分离（规格书 8(2)）：
 *   倍数抽取 rollMult（W1）
 *   落道抽取 pickLane（W2 + 蓄力偏移 + 卡片模式增益）
 *   亮灯位 litLanesOf（W3）→ 命中判定 isWin
 */

/** 加权随机取索引 */
export function weightedPick(rng: RNG, weights: readonly number[]): number {
  let total = 0
  for (let i = 0; i < weights.length; i++) total += weights[i]
  let r = rng() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}

/** 倍数抽取：从 2/4/6/8/10 五档按 W1 加权随机 */
export function rollMult(rng: RNG, cfg: typeof CONFIG = CONFIG): number {
  return cfg.mult.levels[weightedPick(rng, cfg.mult.weights)]
}

/** W3：该倍数下亮灯的轨道索引 */
export function litLanesOf(mult: number, cfg: typeof CONFIG = CONFIG): number[] {
  return cfg.lanes.litPatternByMult[mult] ?? []
}

/** 命中判定：落道 ∈ 亮灯轨道 */
export function isWin(lane: number, mult: number, cfg: typeof CONFIG = CONFIG): boolean {
  return litLanesOf(mult, cfg).indexOf(lane) >= 0
}

export interface PickLaneOpts {
  mult: number
  /** 蓄力力度 [0,1]：满力偏中心、弱力偏边缘（对称小幅） */
  power: number
  mode: GameMode
}

/**
 * 落道抽取 —— 在松手（CHARGE_END）瞬间调用，结果写入 ctx.targetLane。
 *
 * 权重合成：基础表（W2）× 蓄力偏移（中心权重 ×(1 + powerBiasMax·(2·power-1))，对称小幅 ≤12%）
 * 卡片模式增益用分组混合实现：命中率精确 ×boost（亮灯权重直接相乘是边际递减的，
 * 达不到规格书"得中率高 2-6 倍"），组内仍按相对权重分布，保证视觉落点一致。
 */
export function pickLane(
  rng: RNG,
  opts: PickLaneOpts,
  cfg: typeof CONFIG = CONFIG
): number {
  const base = cfg.lanes.weights
  const n = base.length
  const lit = litLanesOf(opts.mult, cfg)
  const bias = cfg.lanes.powerBiasMax * (2 * opts.power - 1)
  const center = (n - 1) / 2

  const weights: number[] = new Array(n)
  let litTotal = 0
  let offTotal = 0
  for (let i = 0; i < n; i++) {
    // i 越靠中心 (1-d) 越大：power>0.5 抬中心，power<0.5 压中心
    const d = Math.abs(i - center) / center
    const w = base[i] * (1 + bias * (1 - d))
    weights[i] = w
    if (lit.indexOf(i) >= 0) litTotal += w
    else offTotal += w
  }

  if (opts.mode === 'card' && lit.length > 0 && litTotal > 0) {
    const H = litTotal / (litTotal + offTotal)
    const boosted = Math.min(H * cfg.card.cardModeRateBoost, 0.95)
    return pickInGroup(rng, weights, lit, rng() < boosted)
  }
  return weightedPick(rng, weights)
}

/** 组内抽取：inLit=true 在亮灯轨道内、false 在熄灯轨道内，按相对权重 */
function pickInGroup(rng: RNG, weights: number[], lit: number[], inLit: boolean): number {
  if (!inLit && offTotalOf(weights, lit) === 0) inLit = true // 无熄灯轨可落时兜底
  let total = 0
  for (let i = 0; i < weights.length; i++) {
    if ((lit.indexOf(i) >= 0) === inLit) total += weights[i]
  }
  let r = rng() * total
  for (let i = 0; i < weights.length; i++) {
    if ((lit.indexOf(i) >= 0) !== inLit) continue
    r -= weights[i]
    if (r < 0) return i
  }
  return inLit ? lit[0] : 0
}

function offTotalOf(weights: number[], lit: number[]): number {
  let t = 0
  for (let i = 0; i < weights.length; i++) {
    if (lit.indexOf(i) < 0) t += weights[i]
  }
  return t
}

/**
 * 结算（规格书第三、五节）：
 * - 弹珠模式：winBalls = bet × mult（未中 0）；出卡 = min(floor(winBalls/30), 5)
 * - 卡片模式：命中不退珠，按卡池权重抽 1..maxDraw 张
 */
export function computeSettle(
  rng: RNG,
  bet: number,
  mult: number,
  lane: number,
  mode: GameMode,
  cfg: typeof CONFIG = CONFIG
): SettleResult {
  const win = isWin(lane, mult, cfg)
  if (!win) {
    return { isWin: false, winBalls: 0, cards: 0, cardIds: [] }
  }
  if (mode === 'card') {
    const count = 1 + Math.floor(rng() * cfg.card.cardModeMaxDraw)
    const cardIds: string[] = []
    for (let i = 0; i < count; i++) cardIds.push(drawCard(rng, cfg.cardPool).id)
    return { isWin: true, winBalls: 0, cards: count, cardIds }
  }
  const winBalls = bet * mult
  const cards = Math.min(Math.floor(winBalls / cfg.card.perCard), cfg.card.maxCardsPerRound)
  return { isWin: true, winBalls, cards, cardIds: [] }
}

/** 卡池抽卡：{分值/类型/稀有度/权重} 配置表 */
export function drawCard(rng: RNG, pool: readonly CardDef[] = CONFIG.cardPool): CardDef {
  const idx = weightedPick(rng, pool.map((c) => c.weight))
  return pool[idx]
}
