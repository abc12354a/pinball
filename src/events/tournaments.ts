import { CONFIG } from '../config/config'
import { isWin, litLanesOf, pickLane, rollMult } from '../game/core/lottery'
import type { RNG } from '../game/core/rng'
import type { StateMachine } from '../game/core/stateMachine'
import type { EventReward } from '../game/core/types'
import { makeBotNames, makeBotScores, type BotEntry } from './bots'

/**
 * 机器人赛事系统（规格书第六节，全店联机的本地模拟版）：
 * - 定时轮换 4 种玩法：拍拍乐(10s拼手速) / 拔河(30s狂按) / 巅峰对决(30s免费弹射) / 幸运座位(随机)
 * - 经状态机 EVENT_INVITE → ONLINE_MINIGAME → EVENT_DONE 打断/恢复主游戏
 * - 假玩家分数分段生成，玩家实时排名，Top3 + 参与奖
 *
 * 巅峰对决的弹射：直接驱动 PlinkoWorld（不经状态机），命中亮灯道计分。
 */

export type TournamentId = 'paipai' | 'tug' | 'duel' | 'lucky'
export type TourState = 'idle' | 'invite' | 'playing' | 'result'

export interface TournamentSnapshot {
  version: number
  state: TourState
  id: TournamentId
  name: string
  /** 报名/游玩剩余毫秒 */
  leftMs: number
  /** 玩家当前分（拍打数 / 命中数） */
  score: number
  /** 决斗当前倍数（0=未roll） */
  duelMult: number
  board: BotEntry[]
  result: { rank: number; total: number; rewardText: string } | null
  luckySeats: number[]
  playerSeat: number
}

export class TournamentRunner {
  private sm: StateMachine
  private rng: RNG
  private listeners: (() => void)[] = []
  private snap: TournamentSnapshot
  private snapVersion = 0

  private state: TourState = 'idle'
  private id: TournamentId = 'paipai'
  private endTs = 0
  private score = 0
  private botNames: string[] = []
  private botFinal: number[] = []
  private result: TournamentSnapshot['result'] = null
  private luckySeats: number[] = []
  private charging = false
  private chargeStartTs = 0
  /** 决斗当前发：倍数 + 亮灯（null = 可发射下一发） */
  private duelShot: { mult: number } | null = null

  constructor(sm: StateMachine, rng: RNG) {
    this.sm = sm
    this.rng = rng
    this.snap = this.freshSnap()
  }

  private freshSnap(): TournamentSnapshot {
    return {
      version: 0,
      state: 'idle',
      id: 'paipai',
      name: '',
      leftMs: 0,
      score: 0,
      duelMult: 0,
      board: [],
      result: null,
      luckySeats: [],
      playerSeat: 1
    }
  }

  // ---------- 生命周期 ----------

  /** 调度器触发：发赛事邀请（打断主游戏，快照在状态机内保存） */
  startInvite(id: TournamentId, nowMs: number): void {
    if (this.state !== 'idle') return
    this.id = id
    this.state = 'invite'
    this.endTs = nowMs + CONFIG.events.signupMs
    this.score = 0
    this.result = null
    this.duelShot = null
    this.luckySeats = []
    this.botNames = makeBotNames(this.rng, CONFIG.events.botCount)
    this.sm.dispatch({ t: 'INVITE', eventId: id })
    this.commit()
  }

  /** 玩家点报名 */
  join(): void {
    if (this.state !== 'invite') return
    this.sm.dispatch({ t: 'JOIN' })
  }

  /** 引擎每帧调用 */
  tick(nowMs: number): void {
    if (this.state === 'invite') {
      if (this.sm.phase === 'ONLINE_MINIGAME') {
        this.state = 'playing'
        this.endTs = nowMs + CONFIG.events.minigames[this.id].durationMs
        this.score = 0
        this.rollBots()
        if (this.id === 'lucky') this.rollLuckySeats()
        this.commit()
      } else if (this.sm.phase !== 'EVENT_INVITE') {
        // 未报名，主流程已恢复
        this.state = 'idle'
        this.commit()
      }
      return
    }
    if (this.state !== 'playing') return
    if (nowMs >= this.endTs) this.finish()
  }

  private rollBots(): void {
    const { botCount } = CONFIG.events
    if (this.id === 'tug') this.botFinal = makeBotScores(this.rng, botCount, 40, 170)
    else if (this.id === 'paipai') this.botFinal = makeBotScores(this.rng, botCount, 25, 95)
    else if (this.id === 'duel') this.botFinal = makeBotScores(this.rng, botCount, 1, 6)
    else this.botFinal = new Array(botCount).fill(0)
  }

  private rollLuckySeats(): void {
    const total = CONFIG.events.botCount + 1
    const seats: number[] = []
    while (seats.length < 2) {
      const s = 1 + Math.floor(this.rng() * total)
      if (seats.indexOf(s) < 0) seats.push(s)
    }
    this.luckySeats = seats
  }

  private finish(): void {
    const rewards = CONFIG.events.rewards
    let rank: number
    let reward: EventReward
    let rewardText: string

    if (this.id === 'lucky') {
      const won = this.luckySeats.indexOf(1) >= 0
      if (won) {
        rank = 1
        reward = { balls: rewards[0].balls, cards: rewards[0].cards, rank, eventName: '幸运座位' }
        rewardText = `🎉 幸运座位被抽中！+${rewards[0].balls}珠 +${rewards[0].cards}卡`
      } else {
        rank = 99
        const p = CONFIG.events.participateReward
        reward = { balls: p.balls, cards: p.cards, rank, eventName: '幸运座位' }
        rewardText = `未抽中（开奖座位 ${this.luckySeats.join(' / ')} 号），参与奖 +${p.balls}珠`
      }
    } else {
      const board = this.finalBoard()
      rank = board.findIndex((e) => e.isPlayer) + 1
      if (rank <= rewards.length) {
        const r = rewards[rank - 1]
        reward = { balls: r.balls, cards: r.cards, rank, eventName: this.nameOf() }
        rewardText = `第${rank}名：+${r.balls}珠 +${r.cards}卡`
      } else {
        const p = CONFIG.events.participateReward
        reward = { balls: p.balls, cards: p.cards, rank, eventName: this.nameOf() }
        rewardText = `第${rank}名，参与奖 +${p.balls}珠`
      }
    }

    this.state = 'result'
    this.result = { rank, total: CONFIG.events.botCount + 1, rewardText }
    // EVENT_DONE：状态机恢复主游戏快照，奖励经 pendingReward 通道由引擎转发给 store
    this.sm.dispatch({ t: 'EVENT_DONE', reward })
    this.commit()
  }

  /** 玩家关闭结算弹窗 */
  close(): void {
    if (this.state !== 'result') return
    this.state = 'idle'
    this.result = null
    this.commit()
  }

  // ---------- 输入 ----------

  /** 拍打类（拍拍乐/拔河）：点一下计一分 */
  tap(): void {
    if (this.state !== 'playing') return
    if (this.id === 'paipai' || this.id === 'tug') {
      this.score++
      this.commit()
    }
  }

  /** 巅峰对决：按住蓄力（引擎在 ONLINE_MINIGAME 期间路由触摸到这） */
  chargeStart(): boolean {
    if (this.state !== 'playing' || this.id !== 'duel' || this.duelShot) return false
    this.charging = true
    this.chargeStartTs = Date.now()
    return true
  }

  chargeEnd(power: number): boolean {
    if (!this.charging || this.id !== 'duel') return false
    this.charging = false
    const mult = rollMult(this.rng)
    const lane = pickLane(this.rng, { mult, power, mode: 'ball', happy: false })
    this.duelShot = { mult }
    this.onDuelLaunch?.(lane, power)
    this.commit()
    return true
  }

  /** 引擎注入：决斗发射（驱动 PlinkoWorld） */
  onDuelLaunch: ((targetLane: number, power: number) => void) | null = null

  /** 决斗落道计分（引擎路由 world.onLanded 到此） */
  onDuelLanded(lane: number): void {
    if (this.state !== 'playing' || this.id !== 'duel' || !this.duelShot) return
    if (isWin(lane, this.duelShot.mult)) this.score++
    this.duelShot = null
    this.commit()
  }

  /** 决斗亮灯轨（渲染层展示用） */
  get duelLitLanes(): number[] {
    return this.duelShot ? litLanesOf(this.duelShot.mult) : []
  }

  get isCharging(): boolean {
    return this.charging
  }

  get chargePower(): number {
    if (!this.charging) return 0
    const held = Date.now() - this.chargeStartTs
    const period = 1600
    const ph = (held % period) / (period / 2)
    return Math.max(0, Math.min(1, ph <= 1 ? ph : 2 - ph))
  }

  // ---------- 排行 ----------

  private finalBoard(): BotEntry[] {
    const board: BotEntry[] = this.botNames.map((name, i) => ({
      name,
      score: this.botFinal[i] ?? 0
    }))
    board.push({ name: '我', score: this.score, isPlayer: true })
    board.sort((a, b) => b.score - a.score)
    return board
  }

  private liveBoard(): BotEntry[] {
    const total = Math.max(1, CONFIG.events.minigames[this.id].durationMs)
    const prog = Math.max(0, Math.min(1, 1 - (this.endTs - Date.now()) / total))
    const board: BotEntry[] = this.botNames.map((name, i) => ({
      name,
      score: Math.round((this.botFinal[i] ?? 0) * prog)
    }))
    board.push({ name: '我', score: this.score, isPlayer: true })
    board.sort((a, b) => b.score - a.score)
    return board
  }

  private nameOf(): string {
    return CONFIG.events.minigames[this.id].name
  }

  // ---------- React 绑定 ----------

  getSnapshot = (): TournamentSnapshot => this.snap

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.push(fn)
    return () => {
      const i = this.listeners.indexOf(fn)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  private commit(): void {
    this.snapVersion++
    this.snap = {
      version: this.snapVersion,
      state: this.state,
      id: this.id,
      name: this.nameOf(),
      leftMs:
        this.state === 'invite' || this.state === 'playing'
          ? Math.max(0, this.endTs - Date.now())
          : 0,
      score: this.score,
      duelMult: this.duelShot?.mult ?? 0,
      board: this.state === 'playing' ? this.liveBoard() : this.finalBoard(),
      result: this.result,
      luckySeats: this.luckySeats,
      playerSeat: 1
    }
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i]()
  }
}
