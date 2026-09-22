import { StateMachine } from '../../game/core/stateMachine'
import { mulberry32 } from '../../game/core/rng'
import { CONFIG } from '../../config/config'
import { TournamentRunner } from '../tournaments'
import type { EventReward } from '../../game/core/types'

function setup(seed = 11) {
  const clock = { t: 1000 }
  const sm = new StateMachine({ rng: mulberry32(seed), now: () => clock.t })
  const runner = new TournamentRunner(sm, mulberry32(seed + 1))
  const rewards: EventReward[] = []
  sm.subscribe(() => {
    if (sm.pendingReward) rewards.push(sm.pendingReward)
  })
  /** 把主游戏推进到 BET_WINDOW（可被打断点） */
  const toBetWindow = () => {
    sm.dispatch({ t: 'INSERT', n: 5 })
    sm.dispatch({ t: 'CONFIRM_BET' })
    clock.t += CONFIG.mult.rollAnimMs + 1
    sm.tick()
  }
  return { sm, runner, clock, rewards, toBetWindow }
}

describe('赛事完整流程', () => {
  it('拍拍乐：邀请→报名→比赛→结算发奖→恢复主游戏', () => {
    const { sm, runner, clock, rewards, toBetWindow } = setup()
    toBetWindow()
    expect(sm.phase).toBe('BET_WINDOW')

    runner.startInvite('paipai', clock.t)
    expect(sm.phase).toBe('EVENT_INVITE')
    expect(runner.getSnapshot().state).toBe('invite')

    runner.join()
    expect(sm.ctx.invite?.joined).toBe(true)

    // 报名窗口结束 → 开赛
    clock.t += CONFIG.events.signupMs + 1
    sm.tick()
    expect(sm.phase).toBe('ONLINE_MINIGAME')
    runner.tick(clock.t)
    expect(runner.getSnapshot().state).toBe('playing')

    // 狂拍 60 下
    for (let i = 0; i < 60; i++) runner.tap()
    expect(runner.getSnapshot().score).toBe(60)

    // 比赛结束 → 结算 + 恢复
    clock.t += CONFIG.events.minigames.paipai.durationMs + 1
    runner.tick(clock.t)
    const snap = runner.getSnapshot()
    expect(snap.state).toBe('result')
    expect(snap.result).not.toBeNull()
    expect(rewards.length).toBe(1)
    expect(rewards[0].eventName).toBe('拍拍乐')
    // 恢复到被打断的 BET_WINDOW
    expect(sm.phase).toBe('BET_WINDOW')
    expect(sm.ctx.invite).toBeNull()

    runner.close()
    expect(runner.getSnapshot().state).toBe('idle')
  })

  it('未报名：邀请超时自动恢复，runner 回 idle', () => {
    const { sm, runner, clock, toBetWindow } = setup()
    toBetWindow()
    runner.startInvite('tug', clock.t)
    clock.t += CONFIG.events.signupMs + 1
    sm.tick()
    expect(sm.phase).toBe('BET_WINDOW')
    runner.tick(clock.t)
    expect(runner.getSnapshot().state).toBe('idle')
  })

  it('拔河比赛玩法可计分', () => {
    const { sm, runner, clock, toBetWindow } = setup()
    toBetWindow()
    runner.startInvite('tug', clock.t)
    runner.join()
    clock.t += CONFIG.events.signupMs + 1
    sm.tick()
    runner.tick(clock.t)
    expect(runner.getSnapshot().state).toBe('playing')
    runner.tap()
    runner.tap()
    expect(runner.getSnapshot().score).toBe(2)
    clock.t += CONFIG.events.minigames.tug.durationMs + 1
    runner.tick(clock.t)
    expect(runner.getSnapshot().state).toBe('result')
  })

  it('巅峰对决：蓄力发射→落道计分，球在空中不能再次蓄力', () => {
    const { sm, runner, clock, toBetWindow } = setup()
    toBetWindow()
    runner.startInvite('duel', clock.t)
    runner.join()
    clock.t += CONFIG.events.signupMs + 1
    sm.tick()
    runner.tick(clock.t)

    let launched: { lane: number; power: number } | null = null
    runner.onDuelLaunch = (lane, power) => {
      launched = { lane, power }
    }

    expect(runner.chargeStart()).toBe(true)
    expect(runner.chargeEnd(0.6)).toBe(true)
    expect(launched).not.toBeNull()
    expect(runner.getSnapshot().duelMult).toBeGreaterThan(0)

    // 球在空中：不允许再次蓄力
    expect(runner.chargeStart()).toBe(false)

    // 落道：亮灯命中则计分
    const mult = runner.getSnapshot().duelMult
    const lit = CONFIG.lanes.litPatternByMult[mult]
    runner.onDuelLanded(lit[0])
    expect(runner.getSnapshot().score).toBe(1)
    // 落道后可再蓄力
    expect(runner.chargeStart()).toBe(true)
  })

  it('幸运座位：开奖产生结果与奖励', () => {
    const { sm, runner, clock, rewards, toBetWindow } = setup(99)
    toBetWindow()
    runner.startInvite('lucky', clock.t)
    runner.join()
    clock.t += CONFIG.events.signupMs + 1
    sm.tick()
    runner.tick(clock.t)
    expect(runner.getSnapshot().state).toBe('playing')
    expect(runner.getSnapshot().luckySeats.length).toBe(2)

    clock.t += CONFIG.events.minigames.lucky.durationMs + 1
    runner.tick(clock.t)
    const snap = runner.getSnapshot()
    expect(snap.state).toBe('result')
    expect(rewards.length).toBe(1)
    expect(rewards[0].eventName).toBe('幸运座位')
    expect(sm.phase).toBe('BET_WINDOW')
  })

  it('非 idle 状态不会重复发起', () => {
    const { runner, clock, toBetWindow } = setup()
    toBetWindow()
    runner.startInvite('paipai', clock.t)
    runner.startInvite('duel', clock.t) // 应被忽略
    expect(runner.getSnapshot().id).toBe('paipai')
  })
})
