import { mulberry32 } from '../rng'
import {
  computeSettle,
  drawCard,
  isWin,
  litLanesOf,
  pickLane,
  rollMult,
  weightedPick
} from '../lottery'
import { CONFIG } from '../../../config/config'

const rng = mulberry32(42)

describe('weightedPick', () => {
  it('按权重分布取样（大样本频率误差 < 2%）', () => {
    const n = 100000
    const counts = [0, 0, 0]
    const weights = [1, 2, 7]
    for (let i = 0; i < n; i++) counts[weightedPick(rng, weights)]++
    expect(counts[0] / n).toBeCloseTo(0.1, 1)
    expect(counts[1] / n).toBeCloseTo(0.2, 1)
    expect(counts[2] / n).toBeCloseTo(0.7, 1)
  })

  it('单元素与零权重', () => {
    expect(weightedPick(rng, [5])).toBe(0)
    expect(weightedPick(rng, [0, 3])).toBe(1)
  })
})

describe('rollMult / litLanesOf / isWin（W1/W3）', () => {
  it('只产出五档倍数', () => {
    for (let i = 0; i < 1000; i++) {
      expect(CONFIG.mult.levels).toContain(rollMult(rng))
    }
  })

  it('标准版亮灯数：2×→4灯 4×→3灯 6×→2灯 8×/10×→1灯', () => {
    expect(litLanesOf(2).length).toBe(4)
    expect(litLanesOf(4).length).toBe(3)
    expect(litLanesOf(6).length).toBe(2)
    expect(litLanesOf(8).length).toBe(1)
    expect(litLanesOf(10).length).toBe(1)
  })

  it('命中判定 = 落道 ∈ 亮灯轨道', () => {
    expect(isWin(2, 2)).toBe(true)
    expect(isWin(0, 2)).toBe(false)
    expect(isWin(1, 8)).toBe(true)
    expect(isWin(8, 10)).toBe(true)
  })
})

describe('computeSettle（规格书第五节边界）', () => {
  it('投5中8× → 退40珠、1张卡', () => {
    const r = computeSettle(rng, 5, 8, 1, 'ball')
    expect(r).toEqual({ isWin: true, winBalls: 40, cards: 1, cardIds: [] })
  })

  it('投15中10× → 退150珠、5张拉满', () => {
    const r = computeSettle(rng, 15, 10, 8, 'ball')
    expect(r.winBalls).toBe(150)
    expect(r.cards).toBe(5)
  })

  it('投5中4× → 退20珠、0张（不足30）', () => {
    const r = computeSettle(rng, 5, 4, 6, 'ball')
    expect(r.winBalls).toBe(20)
    expect(r.cards).toBe(0)
  })

  it('投50中2× → 退100珠、封顶5张（floor(100/30)=3）', () => {
    const r = computeSettle(rng, 50, 2, 4, 'ball')
    expect(r.winBalls).toBe(100)
    expect(r.cards).toBe(3)
  })

  it('未中奖 → 零返还', () => {
    const r = computeSettle(rng, 15, 10, 0, 'ball')
    expect(r).toEqual({ isWin: false, winBalls: 0, cards: 0, cardIds: [] })
  })

  it('卡片模式：命中不退珠、抽 1..3 张池内卡', () => {
    for (let i = 0; i < 200; i++) {
      const r = computeSettle(rng, 5, 6, 9, 'card')
      expect(r.winBalls).toBe(0)
      expect(r.cards).toBeGreaterThanOrEqual(1)
      expect(r.cards).toBeLessThanOrEqual(CONFIG.card.cardModeMaxDraw)
      for (const id of r.cardIds) {
        expect(CONFIG.cardPool.some((c) => c.id === id)).toBe(true)
      }
    }
  })
})

describe('pickLane（W2 + 蓄力偏移 + 卡片模式增益）', () => {
  it('卡片模式提升亮灯轨道命中率（约 ×boost）', () => {
    const n = 200000
    let base = 0
    let boosted = 0
    for (let i = 0; i < n; i++) {
      if (isWin(pickLane(rng, { mult: 8, power: 0.5, mode: 'ball', happy: false }), 8)) base++
      if (isWin(pickLane(rng, { mult: 8, power: 0.5, mode: 'card', happy: false }), 8)) boosted++
    }
    const ratio = boosted / base
    expect(ratio).toBeGreaterThan(CONFIG.card.cardModeRateBoost - 0.25)
    expect(ratio).toBeLessThan(CONFIG.card.cardModeRateBoost + 0.25)
  })

  it('满力偏中心、弱力偏边缘（对称小幅）', () => {
    const n = 200000
    const centerStart = 4
    const centerEnd = 7
    let full = 0
    let weak = 0
    for (let i = 0; i < n; i++) {
      const a = pickLane(rng, { mult: 2, power: 1, mode: 'ball', happy: false })
      const b = pickLane(rng, { mult: 2, power: 0, mode: 'ball', happy: false })
      if (a >= centerStart && a <= centerEnd) full++
      if (b >= centerStart && b <= centerEnd) weak++
    }
    expect(full).toBeGreaterThan(weak) // 满力落中心段更多
    const delta = (full - weak) / n
    expect(delta).toBeLessThan(0.15) // 偏移幅度受 powerBiasMax 约束
  })

  it('开心30秒使用独立落道权重', () => {
    const n = 100000
    let edge = 0
    for (let i = 0; i < n; i++) {
      const lane = pickLane(rng, { mult: 2, power: 0.5, mode: 'ball', happy: true })
      if (lane === 0 || lane === 11) edge++
    }
    // happyLaneWeights 边缘权重 5/84 高于 W2 的 4/108
    expect(edge / n).toBeGreaterThan(0.05)
  })
})

describe('drawCard（卡池）', () => {
  it('按权重抽卡且只出池内卡', () => {
    for (let i = 0; i < 1000; i++) {
      const c = drawCard(rng)
      expect(CONFIG.cardPool).toContain(c)
    }
  })
})
