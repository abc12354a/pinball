import { StateMachine } from '../stateMachine'
import { mulberry32 } from '../rng'
import { CONFIG } from '../../../config/config'
import type { Phase } from '../types'

/** 可控时钟 + 固定种子，测试全流程确定性推进 */
function makeMachine(seed = 7, cfg = CONFIG) {
  const clock = { t: 1000 }
  const sm = new StateMachine({
    rng: mulberry32(seed),
    now: () => clock.t,
    cfg
  })
  const phases: Phase[] = []
  sm.subscribe((p) => phases.push(p))
  return { sm, clock, phases }
}

/** 走完一局：INSERT n → 开始 → 过动画 → 过加注窗 → 蓄力发射 → 落道结算 */
function playRound(
  sm: StateMachine,
  clock: { t: number },
  bet: number,
  power = 0.6
): void {
  sm.dispatch({ t: 'INSERT', n: bet })
  sm.dispatch({ t: 'CONFIRM_BET' })
  clock.t += CONFIG.mult.rollAnimMs + 10
  sm.tick() // ROLL_MULT → BET_WINDOW
  clock.t += CONFIG.bet.windowMs + 10
  sm.tick() // BET_WINDOW → FIRE
  sm.dispatch({ t: 'CHARGE_START' })
  clock.t += 500
  sm.dispatch({ t: 'CHARGE_END', power })
  clock.t += 3000
  sm.tick() // 物理安全超时不需要：直接 LANDED
  sm.dispatch({ t: 'LANDED', lane: sm.ctx.targetLane })
  sm.dispatch({ t: 'SETTLE_DONE' })
}

describe('一局核心流程', () => {
  it('IDLE→READY→…→SETTLE→IDLE 全环', () => {
    const { sm, clock } = makeMachine()
    expect(sm.phase).toBe('IDLE')

    sm.dispatch({ t: 'INSERT', n: 3 })
    expect(sm.phase).toBe('IDLE') // 不足 5 颗不能开局

    sm.dispatch({ t: 'INSERT', n: 2 })
    expect(sm.phase).toBe('READY')
    expect(sm.ctx.betTotal).toBe(5)

    sm.dispatch({ t: 'CONFIRM_BET' })
    expect(sm.phase).toBe('ROLL_MULT')
    expect(CONFIG.mult.levels).toContain(sm.ctx.mult)
    expect(sm.ctx.litLanes.length).toBeGreaterThan(0)

    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()
    expect(sm.phase).toBe('BET_WINDOW')

    // 加注窗口内继续投珠
    sm.dispatch({ t: 'INSERT', n: 5 })
    expect(sm.ctx.betTotal).toBe(10)

    clock.t += CONFIG.bet.windowMs + 1
    sm.tick()
    expect(sm.phase).toBe('FIRE')

    sm.dispatch({ t: 'CHARGE_START' })
    expect(sm.ctx.charging).toBe(true)
    sm.dispatch({ t: 'CHARGE_END', power: 0.7 })
    expect(sm.phase).toBe('PHYSICS')
    expect(sm.ctx.targetLane).toBeGreaterThanOrEqual(0)
    expect(sm.ctx.charging).toBe(false)

    sm.dispatch({ t: 'LANDED', lane: sm.ctx.targetLane })
    expect(sm.phase).toBe('SETTLE')
    expect(sm.ctx.lastSettle).not.toBeNull()

    sm.dispatch({ t: 'SETTLE_DONE' })
    expect(sm.phase).toBe('IDLE')
    expect(sm.ctx.betTotal).toBe(0)
  })

  it('非法转移直接 throw', () => {
    const { sm } = makeMachine()
    expect(() => sm.dispatch({ t: 'CONFIRM_BET' })).toThrow()
    expect(() => sm.dispatch({ t: 'CHARGE_END', power: 1 })).toThrow()
    expect(() => sm.dispatch({ t: 'SETTLE_DONE' })).toThrow()

    const { sm: sm2 } = makeMachine()
    sm2.dispatch({ t: 'INSERT', n: 5 })
    expect(() => sm2.dispatch({ t: 'CHARGE_START' })).toThrow() // READY 不能直接蓄力
  })

  it('LANDED 与预定落点不符 → throw（完整性）', () => {
    const { sm, clock } = makeMachine()
    sm.dispatch({ t: 'INSERT', n: 5 })
    sm.dispatch({ t: 'CONFIRM_BET' })
    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()
    clock.t += CONFIG.bet.windowMs + 1
    sm.tick()
    sm.dispatch({ t: 'CHARGE_START' })
    sm.dispatch({ t: 'CHARGE_END', power: 0.5 })
    const wrong = (sm.ctx.targetLane + 1) % 12
    expect(() => sm.dispatch({ t: 'LANDED', lane: wrong })).toThrow()
  })

  it('PHYSICS 安全超时：tick 强制按预定落点结算', () => {
    const { sm, clock } = makeMachine()
    sm.dispatch({ t: 'INSERT', n: 5 })
    sm.dispatch({ t: 'CONFIRM_BET' })
    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()
    clock.t += CONFIG.bet.windowMs + 1
    sm.tick()
    sm.dispatch({ t: 'CHARGE_START' })
    sm.dispatch({ t: 'CHARGE_END', power: 0.5 })
    clock.t += 9000
    sm.tick()
    expect(sm.phase).toBe('SETTLE')
  })

  it('投珠阶段之外 INSERT 被忽略', () => {
    const { sm, clock } = makeMachine()
    playRound(sm, clock, 5) // 打一局到 IDLE
    // FIRE/PHYSICS 中投珠无效：再开一局验证
    sm.dispatch({ t: 'INSERT', n: 5 })
    sm.dispatch({ t: 'CONFIRM_BET' })
    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()
    clock.t += CONFIG.bet.windowMs + 1
    sm.tick()
    expect(sm.phase).toBe('FIRE')
    sm.dispatch({ t: 'INSERT', n: 5 })
    expect(sm.ctx.betTotal).toBe(5)
  })

  it('投注封顶：betTotal ≤ max', () => {
    const { sm } = makeMachine()
    sm.dispatch({ t: 'INSERT', n: 40 })
    sm.dispatch({ t: 'INSERT', n: 40 })
    expect(sm.ctx.betTotal).toBe(CONFIG.bet.max)
  })

  it('BET_WINDOW 中直接拉杆：自动确认 → FIRE 蓄力 → 发射', () => {
    const { sm, clock } = makeMachine()
    sm.dispatch({ t: 'INSERT', n: 5 })
    sm.dispatch({ t: 'CONFIRM_BET' })
    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()
    expect(sm.phase).toBe('BET_WINDOW')

    sm.dispatch({ t: 'CHARGE_START' }) // 不等窗口超时直接蓄力
    expect(sm.phase).toBe('FIRE')
    expect(sm.ctx.charging).toBe(true)
    expect(sm.ctx.betTotal).toBe(5) // 投注保留

    sm.dispatch({ t: 'CHARGE_END', power: 0.6 })
    expect(sm.phase).toBe('PHYSICS')
  })
})
