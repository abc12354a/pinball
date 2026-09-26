import { PlinkoWorld } from '../src/game/physics/world'
import { createBoard } from '../src/game/render/board'

const layout = createBoard()
const world = new PlinkoWorld(layout)
let rngState = 12345
const rand = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
  return rngState / 0x7fffffff
}

for (let i = 0; i < 3000; i++) {
  const power = 0.15 + rand() * 0.85
  world.setTargetLane(-1)
  world.launch(power)
  let s = 0
  while ((world.state === 'flying' || world.state === 'sinking') && s < 3000) {
    world.step(1 / 120)
    s++
  }
  if (world.state !== 'landed') {
    console.log(`ball ${i} power=${power.toFixed(2)} STUCK steps=${s}`)
    for (let k = 0; k < 12; k++) {
      if (k % 4 === 0) console.log(`  +${k}: pos(${world.bx.toFixed(1)}, ${world.by.toFixed(1)}) vel(${world.bvx.toFixed(1)}, ${world.bvy.toFixed(1)})`)
      world.step(1 / 120)
    }
    break
  }
}
console.log('done')
