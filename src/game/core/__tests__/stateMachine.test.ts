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
})

describe('能量与开心30秒', () => {
  it('投珠累积能量：30颗（默认每盏25）→ 1盏余5', () => {
    const { sm, clock } = makeMachine()
    playRound(sm, clock, 15)
    expect(sm.ctx.energyLamps).toBe(0)
    expect(sm.ctx.energyProgress).toBe(15)
    playRound(sm, clock, 15)
    expect(sm.ctx.energyLamps).toBe(1)
    expect(sm.ctx.energyProgress).toBe(5)
  })

  it('能量满 → BONUS_CHECK 自动进入开心30秒，免费弹射按名义注结算', () => {
    const { sm, clock } = makeMachine()
    // 快速攒满能量：直接种状态（单元测试白盒）
    sm.ctx.energyLamps = CONFIG.energy.lampCount - 1
    sm.ctx.energyProgress = CONFIG.energy.ballsPerLamp - 5
    playRound(sm, clock, 5) // +5 进度 → 满 5 盏 → BONUS_CHECK 触发
    expect(sm.ctx.happy.active).toBe(true)
    expect(sm.phase).toBe('ROLL_MULT') // 短动画后进入免费循环
    expect(sm.ctx.betTotal).toBe(0) // 免费局无投注

    // 推进动画 → HAPPY30S 待发射态（无加注窗口）
    clock.t += 500
    sm.tick()
    expect(sm.phase).toBe('HAPPY30S')

    // 免费弹射一轮：中 8× 应按名义注 5 结算 → 40 珠
    sm.dispatch({ t: 'CHARGE_START' })
    sm.dispatch({ t: 'CHARGE_END', power: 0.5 })
    sm.dispatch({ t: 'LANDED', lane: sm.ctx.targetLane })
    if (sm.ctx.lastSettle && sm.ctx.lastSettle.isWin) {
      // 名义注 2：winBalls ∈ {4,8,12,16,20}
      expect([4, 8, 12, 16, 20]).toContain(sm.ctx.lastSettle.winBalls)
    } else {
      expect(sm.ctx.lastSettle).toEqual({ isWin: false, winBalls: 0, cards: 0, cardIds: [] })
    }
    sm.dispatch({ t: 'SETTLE_DONE' })
    // 时间未到 → 继续下一发
    expect(sm.phase).toBe('ROLL_MULT')
  })

  it('开心30秒到时（HAPPY30S 待发射态 tick）→ 清能量回 IDLE', () => {
    const { sm, clock } = makeMachine()
    sm.ctx.energyLamps = CONFIG.energy.lampCount
    playRound(sm, clock, 5)
    expect(sm.ctx.happy.active).toBe(true)
    // 打完免费局回到 ROLL_MULT，推进到 HAPPY30S 待发射态
    clock.t += 500
    sm.tick()
    expect(sm.phase).toBe('HAPPY30S')
    sm.dispatch({ t: 'CHARGE_START' })
    sm.dispatch({ t: 'CHARGE_END', power: 0.5 })
    sm.dispatch({ t: 'LANDED', lane: sm.ctx.targetLane })
    sm.dispatch({ t: 'SETTLE_DONE' })
    clock.t += 500
    sm.tick()
    expect(sm.phase).toBe('HAPPY30S')
    clock.t += CONFIG.energy.happyDurationMs // 到时
    sm.tick()
    expect(sm.phase).toBe('IDLE')
    expect(sm.ctx.happy.active).toBe(false)
    expect(sm.ctx.energyLamps).toBe(0)
  })

  it('免费局不计能量', () => {
    const { sm, clock } = makeMachine()
    sm.ctx.energyLamps = CONFIG.energy.lampCount
    playRound(sm, clock, 5)
    // happy 中打一发
    clock.t += 500
    sm.tick()
    sm.dispatch({ t: 'CHARGE_START' })
    sm.dispatch({ t: 'CHARGE_END', power: 0.5 })
    sm.dispatch({ t: 'LANDED', lane: sm.ctx.targetLane })
    sm.dispatch({ t: 'SETTLE_DONE' })
    expect(sm.ctx.energyLamps).toBe(0)
    expect(sm.ctx.energyProgress).toBe(0)
  })
})

describe('赛事打断与恢复', () => {
  it('INVITE 打断 BET_WINDOW → 未报名 → 恢复原状态', () => {
    const { sm, clock } = makeMachine()
    sm.dispatch({ t: 'INSERT', n: 5 })
    sm.dispatch({ t: 'CONFIRM_BET' })
    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()
    expect(sm.phase).toBe('BET_WINDOW')
    const betBefore = sm.ctx.betTotal
    const multBefore = sm.ctx.mult

    sm.dispatch({ t: 'INVITE', eventId: 'paipai' })
    expect(sm.phase).toBe('EVENT_INVITE')

    clock.t += CONFIG.events.signupMs + 1
    sm.tick()
    expect(sm.phase).toBe('BET_WINDOW') // 快照恢复
    expect(sm.ctx.betTotal).toBe(betBefore)
    expect(sm.ctx.mult).toBe(multBefore)
    expect(sm.ctx.invite).toBeNull()
  })

  it('JOIN 后进入 ONLINE_MINIGAME，EVENT_DONE 恢复', () => {
    const { sm, clock } = makeMachine()
    sm.dispatch({ t: 'INSERT', n: 5 })
    sm.dispatch({ t: 'CONFIRM_BET' })
    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()

    sm.dispatch({ t: 'INVITE', eventId: 'tug' })
    sm.dispatch({ t: 'JOIN' })
    expect(sm.ctx.invite && sm.ctx.invite.joined).toBe(true)

    clock.t += CONFIG.events.signupMs + 1
    sm.tick()
    expect(sm.phase).toBe('ONLINE_MINIGAME')

    let rewarded = false
    const off = sm.subscribe(() => {
      if (sm.pendingReward) rewarded = true
    })
    sm.dispatch({ t: 'EVENT_DONE', reward: { balls: 60, cards: 3, rank: 1, eventName: '拔河比赛' } })
    expect(sm.phase).toBe('BET_WINDOW')
    expect(rewarded).toBe(true)
    off()
  })

  it('PHYSICS 中被打断：恢复到 PHYSICS，引擎可再 dispatch LANDED', () => {
    const { sm, clock } = makeMachine()
    sm.dispatch({ t: 'INSERT', n: 5 })
    sm.dispatch({ t: 'CONFIRM_BET' })
    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()
    clock.t += CONFIG.bet.windowMs + 1
    sm.tick()
    sm.dispatch({ t: 'CHARGE_START' })
    sm.dispatch({ t: 'CHARGE_END', power: 0.5 })
    expect(sm.phase).toBe('PHYSICS')
    const target = sm.ctx.targetLane

    sm.dispatch({ t: 'INVITE', eventId: 'lucky' })
    clock.t += CONFIG.events.signupMs + 1
    sm.tick() // 未报名 → 直接恢复
    expect(sm.phase).toBe('PHYSICS')
    expect(sm.ctx.targetLane).toBe(target)
    sm.dispatch({ t: 'LANDED', lane: target }) // 引擎 fast-forward
    expect(sm.phase).toBe('SETTLE')
  })
})
