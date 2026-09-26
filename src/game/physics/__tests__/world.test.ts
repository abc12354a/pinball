import { PlinkoWorld, SINK_DEPTH } from '../world'
import { createBoard } from '../../render/board'

const layout = createBoard()

describe('PlinkoWorld 物理', () => {
  it('无引导模式：所有球都能落道（不卡死）', () => {
    const world = new PlinkoWorld(layout)
    for (let i = 0; i < 300; i++) {
      world.setTargetLane(-1)
      world.launch(0.15 + Math.random() * 0.85)
      let s = 0
      while ((world.state === 'flying' || world.state === 'sinking') && s < 3000) {
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
      while ((world.state === 'flying' || world.state === 'sinking') && s < 3000) {
        world.step(1 / 120)
        s++
      }
      expect(world.state).toBe('landed')
      expect(world.landedLane).toBe(target)
    }
  })

  it('沉入过渡无瞬移：过传感器线时位置/速度连续', () => {
    const world = new PlinkoWorld(layout)
    world.setTargetLane(3)
    world.launch(0.6)
    let prevBx = world.bx
    let prevBvy = world.bvy
    let crossed = false
    let s = 0
    while ((world.state === 'flying' || world.state === 'sinking') && s < 3000) {
      world.step(1 / 120)
      if (world.state === 'sinking' && !crossed) {
        crossed = true
        // 进入沉入的那一步：单步横向位移小量（无瞬移）、竖速仅小幅缓降（无急刹）
        expect(Math.abs(world.bx - prevBx)).toBeLessThan(4)
        expect(prevBvy - world.bvy).toBeLessThan(Math.max(20, prevBvy * 0.2))
      }
      prevBx = world.bx
      prevBvy = world.bvy
      s++
    }
    expect(crossed).toBe(true)
    expect(world.state).toBe('landed')
    expect(world.landedLane).toBe(3)
  })

  it('落道经过沉入口袋：先 sinking 再 landed，轨道不变', () => {
    const world = new PlinkoWorld(layout)
    let sawSinking = false
    world.onLanded = (lane) => {
      expect(lane).toBe(5)
      expect(world.state).toBe('landed')
    }
    world.setTargetLane(5)
    world.launch(0.5)
    let s = 0
    while ((world.state === 'flying' || world.state === 'sinking') && s < 3000) {
      world.step(1 / 120)
      if (world.state === 'sinking') sawSinking = true
      s++
    }
    expect(sawSinking).toBe(true)
    expect(world.state).toBe('landed')
    expect(world.landedLane).toBe(5)
    expect(world.by).toBe(layout.lanes.landY + SINK_DEPTH)
  })

  it('reset 后回到 idle 且无残留目标', () => {
    const world = new PlinkoWorld(layout)
    world.setTargetLane(5)
    world.launch(0.5)
    world.reset()
    expect(world.state).toBe('idle')
    expect(world.target).toBe(-1)
  })

  // 自适应高度（V2 棋盘撑满）：钳制两端高度下引导仍必须收敛到目标轨
  for (const h of [480, 640]) {
    it(`自适应高度 h=${h}：引导落点始终等于目标轨道`, () => {
      const adaptive = createBoard(h)
      expect(adaptive.height).toBe(h)
      const world = new PlinkoWorld(adaptive)
      for (let i = 0; i < 200; i++) {
        const target = i % 12
        world.setTargetLane(target)
        world.launch(0.15 + Math.random() * 0.85)
        let s = 0
        while ((world.state === 'flying' || world.state === 'sinking') && s < 3000) {
          world.step(1 / 120)
          s++
        }
        expect(world.state).toBe('landed')
        expect(world.landedLane).toBe(target)
      }
    })
  }
})
