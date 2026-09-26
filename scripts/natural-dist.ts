/**
 * M2 验证：无引导自然落道分布测量。
 *
 * 用途：PlinkoWorld 不设 targetLane（纯物理、无引导）发射 N 球，
 * 统计 12 轨落点直方图 → 该分布即 W2 初值的"实测回填源"。
 * 使引导只需修正小偏差，避免穿帮（见计划"防穿帮关键"）。
 *
 * 运行：npm run dist        （tsx scripts/natural-dist.ts）
 */
import { PlinkoWorld } from '../src/game/physics/world'
import { createBoard } from '../src/game/render/board'

const N = parseInt(process.argv[2] ?? '3000', 10)

const layout = createBoard()
const world = new PlinkoWorld(layout)

const counts = new Array(layout.lanes.count).fill(0)
let steps = 0
let maxSteps = 0

for (let i = 0; i < N; i++) {
  // 力度均匀覆盖 [0.15, 1]，模拟真实玩家的蓄力分布
  const power = 0.15 + Math.random() * 0.85
  world.setTargetLane(-1) // 无引导 = 自然模式
  world.launch(power)
  let s = 0
  while ((world.state === 'flying' || world.state === 'sinking') && s < 5000) {
    world.step(1 / 120)
    s++
  }
  if (world.state !== 'landed') {
    console.error(`球 ${i} 未落道（${s} 步），物理卡死！`)
    process.exit(1)
  }
  counts[world.landedLane]++
  steps += s
  if (s > maxSteps) maxSteps = s
}

const total = counts.reduce((a, b) => a + b, 0)
console.log(`\n=== 无引导自然分布（N=${N}） ===`)
console.log('lane:  ' + counts.map((_, i) => String(i).padStart(5)).join(''))
console.log('cnt:   ' + counts.map((c) => String(c).padStart(5)).join(''))
console.log('freq:  ' + counts.map((c) => (c / total).toFixed(3).padStart(5)).join(''))
console.log('\nW2 回填候选（归一到整数，总和≈108 保持现表量级）：')
const raw = counts.map((c) => c / total)
const sumRaw = raw.reduce((a, b) => a + b, 0)
console.log('       [' + raw.map((f) => Math.max(1, Math.round((f / sumRaw) * 108))).join(', ') + ']')
console.log(`\n平均步数 ${steps / N}，最大步数 ${maxSteps}（步长 1/120s）`)
