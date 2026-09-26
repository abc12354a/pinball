/**
 * 蒙特卡洛 RTP 验证（M3 起每个调参里程碑重跑）。
 *
 * 验证项：
 * 1. 各档倍数命中率 / EV / 出现占比
 * 2. 总 RTP（基础）
 * 3. 分力度 RTP —— 无"必胜力道"（5 档全部落在 ±0.03 带宽内）
 * 4. 落道频率 vs W2 —— 采样器与概率表一致性（误差 <1%）
 * 5. 卡片模式：命中率倍率、均卡/局
 *
 * 运行：npm run sim [-- --n 200000]
 */
import { CONFIG } from '../src/config/config'
import { mulberry32 } from '../src/game/core/rng'
import { computeSettle, isWin, pickLane, rollMult } from '../src/game/core/lottery'

const N = parseInt(process.argv.find((a, i, arr) => arr[i - 1] === '--n') ?? String(100000), 10)
const rng = mulberry32(20260921)

interface MultStat {
  count: number
  hits: number
  bet: number
  win: number
}

const multStats = new Map<number, MultStat>()
for (const m of CONFIG.mult.levels) multStats.set(m, { count: 0, hits: 0, bet: 0, win: 0 })

let totalBet = 0
let totalWin = 0
let totalCards = 0
const laneCounts = new Array(CONFIG.board.laneCount).fill(0)

// 分力度统计
const BANDS = 5
const bandBet = new Array(BANDS).fill(0)
const bandWin = new Array(BANDS).fill(0)

/** 打一局（返回本局投注/中奖，累加统计） */
function playRound(mode: 'ball' | 'card', band?: number): void {
  const bet = 5 * (1 + Math.floor(rng() * 4)) // 5/10/15/20 常见投注
  const mult = rollMult(rng)
  const power = band !== undefined ? (band + 0.5) / BANDS : 0.15 + rng() * 0.85
  const lane = pickLane(rng, { mult, power, mode })
  const settle = computeSettle(rng, bet, mult, lane, mode)
  const st = multStats.get(mult)!
  st.count++
  st.bet += bet
  if (settle.isWin) st.hits++
  if (mode === 'ball') st.win += settle.winBalls
  totalBet += bet
  totalWin += settle.winBalls
  totalCards += settle.cards
  if (band !== undefined) {
    bandBet[band] += bet
    bandWin[band] += settle.winBalls
  }
  if (mode === 'ball') laneCounts[lane]++
}

// ---------- 主循环 ----------
for (let i = 0; i < N; i++) playRound('ball')

console.log(`\n═══ 弹珠模式（N=${N}，基础 RTP） ═══`)
console.log('倍数 |  出现率 | 命中率 |   EV   | 局数')
for (const m of CONFIG.mult.levels) {
  const st = multStats.get(m)!
  const appear = st.count / N
  const hit = st.count ? st.hits / st.count : 0
  const ev = st.bet ? st.win / st.bet : 0
  console.log(
    ` ${String(m).padStart(2)}× | ${appear.toFixed(3).padStart(6)} | ${hit.toFixed(3).padStart(6)} | ${ev.toFixed(3).padStart(6)} | ${st.count}`
  )
}
const rtp = totalWin / totalBet
console.log(`\n总 RTP = ${rtp.toFixed(4)}（目标 ${CONFIG.targetRTP}±0.03）`)
console.log(`均卡/局 = ${(totalCards / N).toFixed(3)}`)

// ---------- 分力度 ----------
console.log(`\n═══ 分力度 RTP（防"必胜力道"） ═══`)
for (const st of multStats.values()) {
  st.count = 0; st.hits = 0; st.bet = 0; st.win = 0
}
let bBet = 0
let bWin = 0
const bandRtps: number[] = []
for (let b = 0; b < BANDS; b++) {
  for (let i = 0; i < Math.floor(N / BANDS); i++) playRound('ball', b)
  const r = bandWin[b] / bandBet[b]
  bandRtps.push(r)
  bBet += bandBet[b]
  bWin += bandWin[b]
  console.log(` 力度 ${(b / BANDS).toFixed(1)}–${((b + 1) / BANDS).toFixed(1)}: RTP = ${r.toFixed(4)}`)
}
const spread = Math.max(...bandRtps) - Math.min(...bandRtps)
console.log(` 力度间 RTP 极差 = ${spread.toFixed(4)}（应 < 0.06）`)

// ---------- 落道频率 vs W2 ----------
console.log(`\n═══ 落道频率 vs W2（采样一致性） ═══`)
const laneTotal = laneCounts.reduce((a, b) => a + b, 0)
const w2 = CONFIG.lanes.weights
const w2Sum = w2.reduce((a, b) => a + b, 0)
let maxErr = 0
for (let i = 0; i < laneCounts.length; i++) {
  const actual = laneCounts[i] / laneTotal
  const expect = w2[i] / w2Sum
  const err = Math.abs(actual - expect)
  if (err > maxErr) maxErr = err
  console.log(
    ` lane ${String(i).padStart(2)}: 实测 ${actual.toFixed(4)} | W2 ${expect.toFixed(4)} | Δ ${err.toFixed(4)}`
  )
}
console.log(` 最大偏差 = ${maxErr.toFixed(4)}（应 < 0.01）`)

// ---------- 卡片模式 ----------
console.log(`\n═══ 卡片模式（命中增益验证） ═══`)
let ballHit = 0
let cardHit = 0
const CN = N
for (let i = 0; i < CN; i++) {
  const mult = rollMult(rng)
  if (isWin(pickLane(rng, { mult, power: 0.5, mode: 'ball' }), mult)) ballHit++
  if (isWin(pickLane(rng, { mult, power: 0.5, mode: 'card' }), mult)) cardHit++
}
console.log(
  ` 弹珠模式命中率 ${((ballHit / CN) * 100).toFixed(1)}% → 卡片模式 ${((cardHit / CN) * 100).toFixed(1)}%（×${(cardHit / ballHit).toFixed(2)}，配置 boost=${CONFIG.card.cardModeRateBoost}，上限 0.95 封顶）`
)

console.log('\n✅ 模拟完成')
