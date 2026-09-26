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

  /** 特殊机关：黄金弹性蘑菇钉 */
  bumpers: {
    restitution: 0.75,
    rewardBalls: 1,
    radius: 6
  },

  /** 连击与狂热 (Fever) */
  combo: {
    feverThreshold: 3,
    bonusPerCombo: 0.05
  },

  /** 每日任务与成就定义 */
  missions: [
    { id: 'daily_login', name: '每日报到', desc: '进入弹珠堂签到打卡', target: 1, rewardBalls: 30, rewardPoints: 5 },
    { id: 'daily_bet', name: '小试身手', desc: '今日累计投珠 20 颗', target: 20, rewardBalls: 25, rewardPoints: 5 },
    { id: 'daily_win', name: '百步穿杨', desc: '今日累计中奖 3 次', target: 3, rewardBalls: 40, rewardPoints: 10 }
  ],

  achievements: [
    { id: 'first_win', name: '首开得胜', desc: '赢得任意一局弹珠奖励', target: 1, rewardBalls: 50, rewardPoints: 10 },
    { id: 'high_roller', name: '豪掷千金', desc: '单局加注达到 50 颗封顶', target: 50, rewardBalls: 60, rewardPoints: 15 },
    { id: 'big_jackpot', name: '超级大奖', desc: '单局中奖获得超过 100 颗弹珠', target: 100, rewardBalls: 100, rewardPoints: 30 },
    { id: 'fever_master', name: '连胜狂徒', desc: '达成 3 连胜进入 FEVER 狂热状态', target: 3, rewardBalls: 80, rewardPoints: 25 },
    { id: 'koi_blessing', name: '锦鲤降世', desc: '抽中最高稀有度 SSR 锦鲤卡', target: 1, rewardBalls: 200, rewardPoints: 100 }
  ],

  /** 救济金机制 */
  rescue: {
    minBallsTrigger: 5,
    ballsGiven: 100,
    dailyLimit: 3
  },

  /** 积分商城 */
  shop: {
    skins: [
      { id: 'default', name: '经典银光', price: 0, color: '#a8dcff', glow: '#5aa8e8' },
      { id: 'gold', name: '黄金彗星', price: 60, color: '#ffd76e', glow: '#ff9f43' },
      { id: 'neon', name: '赛博霓虹', price: 120, color: '#ff6b81', glow: '#ff4d5e' },
      { id: 'void', name: '暗夜紫晶', price: 180, color: '#d8b4fe', glow: '#a855f7' }
    ],
    packs: [
      { id: 'pack_100', name: '百珠补给箱', balls: 100, costPoints: 20 },
      { id: 'pack_300', name: '豪华弹珠包', balls: 300, costPoints: 50 }
    ]
  },

  /** 目标基础 RTP（开心30秒删除后实测回填：0.827，模拟脚本校验用） */
  targetRTP: 0.83
} as const

export type GameConfig = typeof CONFIG
