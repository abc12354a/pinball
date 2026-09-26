/** 游戏阶段（规格书 8(1) 状态机） */
export type Phase =
  | 'IDLE' // 待机/投珠
  | 'READY' // ≥5 珠，可按开始
  | 'ROLL_MULT' // 倍数滚动动画
  | 'BET_WINDOW' // 亮灯 + 加注倒计时
  | 'FIRE' // 拉杆蓄力/发射
  | 'PHYSICS' // 钉板滚动（表现层，落点已定）
  | 'SETTLE' // 落道判定 → 退珠/出卡结算动画
  | 'BONUS_CHECK' // 结算后的瞬时过渡

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
  /** 蓄力子状态 */
  charging: boolean
  chargeStartTs: number
  /** 各阶段截止时间戳（ms，Date.now() 口径） */
  rollEndTs: number
  windowEndTs: number
  physicsStartTs: number
  settleStartTs: number
  /** 最近一次结算结果 */
  lastSettle: SettleResult | null
  /** 连击数（连续中奖） */
  comboCount: number
  /** 狂热模式（连续 3 次中奖触发） */
  feverActive: boolean
  /** 本局黄金钉撞击次数 */
  bumperHits: number
  /** 局序号（每按一次开始 +1） */
  roundSeq: number
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
  /** 撞击黄金弹性钉 */
  | { t: 'BUMPER_HIT'; index: number }
  /** 母球落道（lane 必须等于 targetLane） */
  | { t: 'LANDED'; lane: number }
  /** 结算动画完成 */
  | { t: 'SETTLE_DONE' }
