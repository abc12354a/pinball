/**
 * 弹珠堂 · 全部数值的单一来源（单一数值源）
 *
 * 概率/结算/模拟脚本（scripts/simulate.ts）共用本文件。
 * 调难度只改这里，不改逻辑代码。
 *
 * 三张核心概率表（对应规格书"真相"三条）：
 * - W1 mult.weights      倍数加权随机（不是均匀随机）
 * - W2 lanes.weights     每条轨道独立落球权重（中间高、边缘低，可调难度）
 * - W3 lanes.litPatternByMult 每档倍数亮几道、亮哪几道（灯位可放低权重轨道）
 */

/** 卡片定义：{卡面ID, 类型, 分值, 稀有度, 掉落权重}（规格书第五节） */
export interface CardDef {
  id: string
  name: string
  /** base=积分卡(分值) sustain=续航卡(兑弹珠) lucky/epic/legend=高价值积分卡 */
  type: 'base' | 'sustain' | 'lucky' | 'epic' | 'legend'
  points: number
  /** 续航卡可直接兑换的弹珠数 */
  redeemBalls: number
  rarity: 'N' | 'R' | 'SR' | 'SSR'
  weight: number
}

export const CONFIG = {
  /** 设计基准：钉板逻辑坐标宽 375（Canvas 用逻辑坐标，dpr 由渲染层处理） */
  board: {
    width: 375,
    height: 560,
    laneCount: 12
  },

  /** 投注：下限 5 颗起投，加注步长/上限（规格书：上限常见 50/60/99，可配） */
  bet: {
    min: 5,
    step: 5,
    max: 50,
    default: 5,
    /** 亮灯后的加注窗口（ms） */
    windowMs: 6000
  },

  /** 倍数抽取：五档 + W1 权重表（规格书真相1：加权随机） */
  mult: {
    levels: [2, 4, 6, 8, 10] as const,
    /** W1：2×:40 4×:28 6×:18 8×:9 10×:5 */
    weights: [40, 28, 18, 9, 5],
    /** ROLL_MULT 相位动画时长（ms） */
    rollAnimMs: 1500
  },

  /** 落道与亮灯 */
  lanes: {
    /**
     * W2：每条轨道独立落球权重 —— M2 实测"无引导自然分布"回填（N=5000）。
     * 右侧偏高是发射口在右 + 弱力早落的物理事实，与"力度偏移"手感一致。
     * 改钉板布局必须重跑 scripts/natural-dist.ts 回填本表。
     */
    weights: [7, 10, 8, 7, 6, 8, 8, 8, 7, 11, 16, 12],
    /**
     * W3：各档倍数亮灯位（lane 索引 0..11）。
     * 标准版灯数：2×亮4灯、4×亮3灯、6×亮2灯、8×/10×亮1灯。
     * 按回填 W2 手算 EV：2×=0.70 / 4×=0.96 / 6×=0.94 / 8×=0.74 / 10×=0.65，
     * 加权 RTP≈0.82（simulate.ts 精调）。
     */
    litPatternByMult: {
      2: [2, 4, 7, 10],
      4: [3, 6, 9],
      6: [4, 9],
      8: [1],
      10: [8]
    } as Record<number, number[]>,
    /**
     * 蓄力对落点的最大偏移幅度（对称、小幅）。
     * 满力偏向中心轨道、弱力偏向边缘（手感来源），最终落点仍由 W2 主导。
     */
    powerBiasMax: 0.12
  },

  /** 出卡（弹珠模式）：每满 30 颗出 1 张，单局封顶 5 张 */
  card: {
    perCard: 30,
    maxCardsPerRound: 5,
    /** 卡片模式命中倍率（规格书：比弹珠模式高 2-6 倍，默认 3） */
    cardModeRateBoost: 3,
    /** 卡片模式命中后抽 1..maxDraw 张 */
    cardModeMaxDraw: 3
  },

  /** 卡池（卡片模式抽卡 + 集卡线） */
  cardPool: [
    { id: 'base', name: '积分卡', type: 'base', points: 1, redeemBalls: 0, rarity: 'N', weight: 70 },
    { id: 'sustain', name: '续航卡', type: 'sustain', points: 0, redeemBalls: 20, rarity: 'N', weight: 12 },
    { id: 'lucky', name: '幸运卡', type: 'lucky', points: 3, redeemBalls: 0, rarity: 'R', weight: 10 },
    { id: 'epic', name: '稀有卡', type: 'epic', points: 10, redeemBalls: 0, rarity: 'SR', weight: 6 },
    { id: 'legend', name: '锦鲤卡', type: 'legend', points: 50, redeemBalls: 0, rarity: 'SSR', weight: 2 }
  ] as CardDef[],

  /** 能量条与开心30秒 */
  energy: {
    lampCount: 5,
    /** 每投多少颗弹珠亮 1 盏 */
    ballsPerLamp: 25,
    happyDurationMs: 30_000,
    /**
     * 开心30秒内每次免费弹射的名义注（按此结算退珠）。
     * 免费收益计入总 RTP：名义注×发数×EV ≈ +0.04，压在目标内（M3 模拟实测）。
     */
    happyNominalBet: 2,
    /**
     * 开心30秒独立落道权重（免费局降命中率，防总 RTP 暴涨）：
     * 质量向 W3 少用的轨道（0/5/10/11）偏移 → 亮灯位命中率下降。
     */
    happyLaneWeights: [16, 6, 5, 5, 4, 14, 5, 4, 4, 6, 16, 17]
  },

  /** 机器人模拟赛事（无真联机，假玩家 + 本地排行榜） */
  events: {
    /** 首场赛事延迟（ms）：进场先玩主循环，稍后再被打断 */
    firstDelayMs: 45_000,
    /** 赛事循环周期（ms）：到点弹报名邀请 */
    periodMs: 5 * 60 * 1000,
    /** 报名窗口（ms） */
    signupMs: 10_000,
    minigames: {
      paipai: { name: '拍拍乐', durationMs: 10_000 },   // 拼手速：限时拍打开始键
      tug: { name: '拔河比赛', durationMs: 30_000 },     // 拼手速：对抗系统阈值
      duel: { name: '巅峰对决', durationMs: 30_000 },    // 免费弹射比命中数
      lucky: { name: '幸运座位', durationMs: 8_000 }     // 随机抽座位，纯随机
    },
    /** 假玩家数量 */
    botCount: 8,
    /** 名次奖励（Top3 弹珠 + 卡；参与奖） */
    rewards: [
      { balls: 60, cards: 3 },
      { balls: 35, cards: 2 },
      { balls: 20, cards: 1 }
    ],
    participateReward: { balls: 5, cards: 0 }
  },

  /** 新玩家初始弹珠（模拟"买珠"入口前的体验额度） */
  wallet: {
    initialBalls: 100
  },

  /** 物理（表现层，不影响落点概率） */
  physics: {
    /** 固定步长（秒）：1/120 子步进，每帧封顶 4 子步 */
    fixedDt: 1 / 120,
    maxSubSteps: 4,
    /** 重力（逻辑坐标 px/s²） */
    gravity: 900,
    /** 钉子碰撞恢复系数 */
    pegRestitution: 0.52,
    /** 墙/分道壁恢复系数 */
    wallRestitution: 0.35,
    /** 碰撞后速度微扰比例（视觉自然感） */
    jitter: 0.04,
    /** 末段引导：球过最后2排钉下方后开始渐进导向目标轨道 */
    guideK: 26,
    guideDamp: 5.5
  },

  /** 目标综合 RTP（含开心30秒免费收益，模拟脚本校验用） */
  targetRTP: 0.85
} as const

export type GameConfig = typeof CONFIG
