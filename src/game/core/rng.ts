/**
 * 可注入种子的 RNG（mulberry32）。
 * 模拟脚本与真机共用同一实现，保证蒙特卡洛结论可迁移。
 */
export type RNG = () => number // [0, 1)

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 真机默认：随机种子 */
export function createRng(seed?: number): RNG {
  return mulberry32(seed ?? ((Math.random() * 0xffffffff) >>> 0))
}
