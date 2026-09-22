/** 游戏阶段（规格书 8(1) 状态机 + HAPPY30S 扩展） */
export type Phase =
  | 'IDLE' // 待机/投珠
  | 'READY' // ≥5 珠，可按开始
  | 'ROLL_MULT' // 倍数滚动动画
  | 'BET_WINDOW' // 亮灯 + 加注倒计时
  | 'FIRE' // 拉杆蓄力/发射
  | 'PHYSICS' // 钉板滚动（表现层，落点已定）
  | 'SETTLE' // 落道判定 → 退珠/出卡结算动画
  | 'BONUS_CHECK' // 能量判定：满灯 → 开心30秒
  | 'HAPPY30S' // 开心30秒：免费弹射子循环的待发射态
  | 'EVENT_INVITE' // 联机（机器人）赛事报名弹窗
  | 'ONLINE_MINIGAME' // 赛事进行中

/** 产出模式：弹珠（退珠）⇄ 卡片（直接抽卡） */
export type GameMode = 'ball' | 'card'

export interface SettleResult {
  isWin: boolean
  /** 中奖退珠数 = bet × mult（含本金），未中为 0 */
  winBalls: number
  /** 出卡数 */
  cards: number
  /** 卡片模式抽到的卡面 ID 列表 */
  cardIds: string[]
}

export interface HappyState {
  active: boolean
  /** 结束时间戳（ms），inactive 时为 0 */
  endTime: number
}

/** 一局上下文（机器内当前投注/倍数/亮灯/落点等） */
export interface RoundContext {
  /** 本局已投注总颗数（IDLE/READY/BET_WINDOW 累计） */
  betTotal: number
  /** 本局倍数，0 = 未 roll */
  mult: number
  /** 本局亮灯轨道索引 */
  litLanes: number[]
  /** 松手瞬间抽出的落点，-1 = 未抽 */
  targetLane: number
  isWin: boolean
  /** 本局使用的模式（按开始时锁定） */
  mode: GameMode
  /** 开心30秒状态 */
  happy: HappyState
  /** 能量：已亮灯数 + 当前盏内进度（颗） */
  energyLamps: number
  energyProgress: number
  /** 蓄力子状态 */
  charging: boolean
  chargeStartTs: number
  /** 各阶段截止时间戳（ms，Date.now() 口径） */
  rollEndTs: number
  windowEndTs: number
  physicsStartTs: number
  settleStartTs: number
  /** 赛事邀请 */
  invite: { eventId: string; endTs: number; joined: boolean } | null
  /** 赛事打断时的快照（phase + ctx 浅拷贝），EVENT_DONE 后恢复 */
  snapshot: { phase: Phase; ctx: RoundContext } | null
  /** 最近一次结算结果 */
  lastSettle: SettleResult | null
  /** 局序号（每按一次开始 +1） */
  roundSeq: number
}

export interface EventReward {
  balls: number
  cards: number
  rank: number
  eventName: string
}

export type GameEvent =
  /** 投珠 n 颗（IDLE/READY/BET_WINDOW 有效，其余忽略） */
  | { t: 'INSERT'; n: number }
  /** 按开始（READY）/ 跳过加注倒计时（BET_WINDOW） */
  | { t: 'CONFIRM_BET' }
  /** 加注窗口倒计时到点（tick 触发） */
  | { t: 'WINDOW_TIMEOUT' }
  /** 按下拉杆开始蓄力 */
  | { t: 'CHARGE_START' }
  /** 松手，power ∈ [0,1]；此刻抽出落点 */
  | { t: 'CHARGE_END'; power: number }
  /** 母球落道（lane 必须等于 targetLane） */
  | { t: 'LANDED'; lane: number }
  /** 结算动画完成 */
  | { t: 'SETTLE_DONE' }
  /** 赛事邀请（eventId 对应 events.minigames 配置） */
  | { t: 'INVITE'; eventId: string }
  /** 玩家点击报名 */
  | { t: 'JOIN' }
  /** 赛事结束（发奖由引擎侧监听 applyReward 完成） */
  | { t: 'EVENT_DONE'; reward?: EventReward }
  /** 开心30秒到时（tick 触发） */
  | { t: 'HAPPY_TIMEOUT' }
