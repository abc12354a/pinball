import { PlinkoWorld } from '../world'
import { createBoard } from '../../render/board'

const layout = createBoard()

describe('PlinkoWorld 物理', () => {
  it('无引导模式：所有球都能落道（不卡死）', () => {
    const world = new PlinkoWorld(layout)
    for (let i = 0; i < 300; i++) {
      world.setTargetLane(-1)
      world.launch(0.15 + Math.random() * 0.85)
      let s = 0
      while (world.state === 'flying' && s < 3000) {
        world.step(1 / 120)
        s++
      }
      expect(world.state).toBe('landed')
      expect(world.landedLane).toBeGreaterThanOrEqual(0)
      expect(world.landedLane).toBeLessThan(12)
    }
  })

  it('引导模式：落点始终等于目标轨道（概率主导的核心保证）', () => {
    const world = new PlinkoWorld(layout)
    for (let i = 0; i < 600; i++) {
      const target = i % 12
      world.setTargetLane(target)
      world.launch(0.15 + Math.random() * 0.85)
      let s = 0
      while (world.state === 'flying' && s < 3000) {
        world.step(1 / 120)
        s++
      }
      expect(world.state).toBe('landed')
      expect(world.landedLane).toBe(target)
    }
  })

  it('reset 后回到 idle 且无残留目标', () => {
    const world = new PlinkoWorld(layout)
    world.setTargetLane(5)
    world.launch(0.5)
    world.reset()
    expect(world.state).toBe('idle')
    expect(world.target).toBe(-1)
  })
})
