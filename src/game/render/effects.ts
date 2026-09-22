/**
 * 粒子对象池（零分配）：中奖爆闪、落道火花。
 */
const POOL_SIZE = 80

interface Particle {
  active: boolean
  x: number; y: number
  vx: number; vy: number
  life: number // 剩余寿命（秒）
  maxLife: number
  size: number
  color: string
}

export class ParticlePool {
  private pool: Particle[] = []

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 3, color: '#ffd76e'
      })
    }
  }

  /** 在 (x,y) 喷发 count 颗粒子 */
  burst(x: number, y: number, count: number, colors: string[] = ['#ffd76e', '#ff6b81', '#7ecbff']): void {
    let spawned = 0
    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i]
      if (p.active) continue
      const a = Math.random() * Math.PI * 2
      const speed = 60 + Math.random() * 160
      p.active = true
      p.x = x
      p.y = y
      p.vx = Math.cos(a) * speed
      p.vy = Math.sin(a) * speed - 60
      p.maxLife = 0.5 + Math.random() * 0.4
      p.life = p.maxLife
      p.size = 2 + Math.random() * 3
      p.color = colors[(Math.random() * colors.length) | 0]
      spawned++
    }
  }

  step(dt: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]
      if (!p.active) continue
      p.vy += 500 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.life -= dt
      if (p.life <= 0) p.active = false
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]
      if (!p.active) continue
      const alpha = Math.max(0, p.life / p.maxLife)
      ctx.globalAlpha = alpha
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}
