import { CONFIG } from '../config/config'
import type { TournamentId } from './tournaments'

/** 赛事轮换顺序 */
const ROTATION: TournamentId[] = ['paipai', 'tug', 'duel', 'lucky']

/**
 * 赛事调度器：定时轮换触发（基于绝对时间戳，切后台不漂移）。
 * canFire 为假（赛事进行中/邀请中）时顺延 5s 重试。
 */
export class EventScheduler {
  private nextAt: number
  private idx = 0

  constructor(
    startMs: number,
    private periodMs: number = CONFIG.events.periodMs,
    private firstDelayMs: number = CONFIG.events.firstDelayMs
  ) {
    this.nextAt = startMs + firstDelayMs
  }

  tick(nowMs: number, canFire: () => boolean, fire: (id: TournamentId) => void): void {
    if (nowMs < this.nextAt) return
    if (!canFire()) {
      this.nextAt = nowMs + 5000
      return
    }
    fire(ROTATION[this.idx % ROTATION.length])
    this.idx++
    this.nextAt = nowMs + this.periodMs
  }
}
