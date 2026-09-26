/**
 * GameEngine 冒烟测试（mock canvas + rAF + Taro）：
 * 驱动一整局 IDLE→INSERT→CONFIRM_BET→FIRE→PHYSICS→SETTLE，
 * 捕获运行时异常（定位开发者工具中"无法显示/卡死"的崩溃点）。
 */
import { GameEngine } from '../src/game/GameEngine'

// ---------- mock canvas ----------
function makeCtx(): any {
  const gradient = { addColorStop: () => {} }
  const ctx: any = {}
  const noop = () => {}
  const props = [
    'save', 'restore', 'setTransform', 'fillRect', 'clearRect', 'beginPath', 'arc', 'fill',
    'stroke', 'translate', 'rotate', 'scale', 'fillText', 'moveTo', 'lineTo', 'closePath',
    'quadraticCurveTo', 'arcTo', 'ellipse', 'rect', 'clip', 'drawImage', 'strokeText',
    'setLineDash', 'measureText'
  ]
  for (const p of props) ctx[p] = noop
  ctx.createLinearGradient = () => gradient
  ctx.createRadialGradient = () => gradient
  return ctx
}

let rafQueue: FrameRequestCallback[] = []
const canvas: any = {
  width: 750,
  height: 1120,
  getContext: () => makeCtx(),
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    return rafQueue.length
  },
  cancelAnimationFrame: () => {}
}

/** 模拟帧泵：16ms/帧，跑满 ms 毫秒 */
function pumpFrames(ms: number): void {
  const deadline = Date.now() + ms
  let virtual = Date.now()
  while (Date.now() < deadline) {
    const q = rafQueue
    rafQueue = []
    if (q.length === 0) break
    for (const cb of q) {
      virtual += 16
      cb(virtual)
    }
  }
}

describe('GameEngine 整局冒烟', () => {
  test('启动 → 一整局 → 结算不崩溃', () => {
    const engine = new GameEngine(canvas, 375, 560, {
      getMode: () => 'ball'
    } as any)
    engine.start()
    pumpFrames(300)
    expect(engine.sm.phase).toBe('IDLE')

    engine.sm.dispatch({ t: 'INSERT', n: 5 })
    expect(engine.sm.phase).toBe('READY')
    engine.sm.dispatch({ t: 'CONFIRM_BET' })
    pumpFrames(2000) // ROLL_MULT 1.5s → BET_WINDOW
    expect(['BET_WINDOW', 'FIRE']).toContain(engine.sm.phase)

    if (engine.sm.phase === 'BET_WINDOW') {
      engine.sm.dispatch({ t: 'CONFIRM_BET' })
    }
    pumpFrames(100)
    expect(engine.sm.phase).toBe('FIRE')

    engine.launchWithPower(0.7)
    pumpFrames(12000) // 物理安全超时 8s + 结算动画

    expect(['IDLE', 'SETTLE', 'BONUS_CHECK']).toContain(engine.sm.phase)
    engine.destroy()
  })
})
