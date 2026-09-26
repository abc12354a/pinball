/**
 * 特效系统（零分配）：
 * 1. ScreenShake：基于 Trauma 心理物理学衰减模型的屏幕微震动
 * 2. ParticlePool：中奖爆炸微粒、碰钉碰撞火花、全屏礼花纸屑 (Confetti)
 * 3. FloatingTextPool：浮动跳字（+1 珠、暴击、COMBO 等）
 * 4. PayoutHopper：中奖瀑布喷珠动效
 */

export class ScreenShake {
  private trauma = 0
  private time = 0
  offsetX = 0
  offsetY = 0
  angle = 0

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  step(dt: number): void {
    if (this.trauma > 0) {
      this.time += dt * 35
      this.trauma = Math.max(0, this.trauma - dt * 2.2)
      // 非线性震动感：shake = trauma ^ 2
      const shake = this.trauma * this.trauma
      const maxOffset = 7
      this.offsetX = (Math.sin(this.time * 1.1) + Math.cos(this.time * 2.3)) * 0.5 * maxOffset * shake
      this.offsetY = (Math.cos(this.time * 1.3) + Math.sin(this.time * 1.9)) * 0.5 * maxOffset * shake
      this.angle = Math.sin(this.time * 1.7) * 0.03 * shake
    } else {
      this.offsetX = 0
      this.offsetY = 0
      this.angle = 0
    }
  }
}

const POOL_SIZE = 120

interface Particle {
  active: boolean
  x: number; y: number
  vx: number; vy: number
  life: number
  maxLife: number
  size: number
  color: string
  isSpark?: boolean
  isConfetti?: boolean
  rot?: number
  vRot?: number
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

  /** 普通爆炸粒子 */
  burst(x: number, y: number, count: number, colors: string[] = ['#ffd76e', '#ff6b81', '#7ecbff']): void {
    let spawned = 0
    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i]
      if (p.active) continue
      const a = Math.random() * Math.PI * 2
      const speed = 60 + Math.random() * 160
      p.active = true
      p.isSpark = false
      p.isConfetti = false
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

  /** 碰钉微火花 */
  spark(x: number, y: number, nx: number, ny: number, count = 4): void {
    let spawned = 0
    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i]
      if (p.active) continue
      const spread = (Math.random() - 0.5) * 1.4
      // 沿法线方向略带散射
      const a = Math.atan2(ny, nx) + spread
      const speed = 80 + Math.random() * 140
      p.active = true
      p.isSpark = true
      p.isConfetti = false
      p.x = x + nx * 2
      p.y = y + ny * 2
      p.vx = Math.cos(a) * speed
      p.vy = Math.sin(a) * speed
      p.maxLife = 0.15 + Math.random() * 0.12
      p.life = p.maxLife
      p.size = 1.5 + Math.random() * 2
      p.color = Math.random() > 0.3 ? '#fff4b8' : '#ff9f43'
      spawned++
    }
  }

  /** 全屏礼花彩带 (Confetti) */
  confetti(width: number, count = 35): void {
    let spawned = 0
    const colors = ['#ffd76e', '#ff6b81', '#7ecbff', '#b983ff', '#55efc4', '#fff']
    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i]
      if (p.active) continue
      p.active = true
      p.isSpark = false
      p.isConfetti = true
      p.x = Math.random() * width
      p.y = -10 - Math.random() * 40
      p.vx = (Math.random() - 0.5) * 90
      p.vy = 100 + Math.random() * 150
      p.rot = Math.random() * Math.PI
      p.vRot = (Math.random() - 0.5) * 8
      p.maxLife = 1.6 + Math.random() * 0.8
      p.life = p.maxLife
      p.size = 4 + Math.random() * 4
      p.color = colors[(Math.random() * colors.length) | 0]
      spawned++
    }
  }

  step(dt: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]
      if (!p.active) continue
      if (p.isSpark) {
        p.x += p.vx * dt
        p.y += p.vy * dt
      } else if (p.isConfetti) {
        p.x += (p.vx + Math.sin(p.life * 5) * 30) * dt
        p.y += p.vy * dt
        p.rot = (p.rot ?? 0) + (p.vRot ?? 0) * dt
      } else {
        p.vy += 500 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
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

      if (p.isConfetti) {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot ?? 0)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8)
        ctx.restore()
      } else {
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (p.isSpark ? alpha : 1), 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }
}

interface FloatingText {
  active: boolean
  text: string
  x: number; y: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

export class FloatingTextPool {
  private pool: FloatingText[] = []

  constructor() {
    for (let i = 0; i < 20; i++) {
      this.pool.push({
        active: false, text: '', x: 0, y: 0, vy: 0, life: 0, maxLife: 1, color: '#ffd76e', size: 18
      })
    }
  }

  spawn(text: string, x: number, y: number, color = '#ffd76e', size = 18): void {
    for (let i = 0; i < this.pool.length; i++) {
      const t = this.pool[i]
      if (t.active) continue
      t.active = true
      t.text = text
      t.x = x
      t.y = y
      t.vy = -60
      t.maxLife = 0.9
      t.life = t.maxLife
      t.color = color
      t.size = size
      return
    }
  }

  step(dt: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const t = this.pool[i]
      if (!t.active) continue
      t.y += t.vy * dt
      t.life -= dt
      if (t.life <= 0) t.active = false
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.textAlign = 'center'
    for (let i = 0; i < this.pool.length; i++) {
      const t = this.pool[i]
      if (!t.active) continue
      const alpha = Math.max(0, t.life / t.maxLife)
      const scale = 1 + (1 - alpha) * 0.3
      ctx.globalAlpha = alpha
      ctx.font = `bold ${Math.round(t.size * scale)}px sans-serif`
      ctx.fillStyle = t.color
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 6
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.restore()
  }
}

interface HopperBall {
  active: boolean
  x: number; y: number
  vx: number; vy: number
  life: number
  /** 出场延迟（秒）：鱼贯喷出的排队间隔 */
  delay: number
}

export class PayoutHopper {
  private balls: HopperBall[] = []

  constructor() {
    for (let i = 0; i < 64; i++) {
      this.balls.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, delay: 0 })
    }
  }

  spawnFromLane(startX: number, startY: number, count = 12): void {
    let spawned = 0
    for (let i = 0; i < this.balls.length && spawned < count; i++) {
      const b = this.balls[i]
      if (b.active) continue
      b.active = true
      b.x = startX + (Math.random() - 0.5) * 14
      b.y = startY
      b.vx = (Math.random() - 0.5) * 110 - 25 // 微右向：滚向右下出珠口
      b.vy = -(60 + Math.random() * 70) // 小上抛，从口袋"蹦"出
      b.life = 1.5 + Math.random() * 0.9
      b.delay = spawned * 0.045
      spawned++
    }
  }

  step(dt: number, floorY: number): void {
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i]
      if (!b.active) continue
      if (b.delay > 0) {
        b.delay -= dt
        continue
      }
      b.vy += 800 * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.y >= floorY) {
        b.y = floorY
        b.vy = -b.vy * 0.35
        b.vx *= 0.92 // 落地摩擦
      }
      if (b.y >= floorY - 1) b.vx *= Math.max(0, 1 - 1.5 * dt) // 贴地滚动衰减
      b.life -= dt
      if (b.life <= 0) b.active = false
    }
  }

  draw(ctx: CanvasRenderingContext2D, radius = 7): void {
    ctx.save()
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i]
      if (!b.active || b.delay > 0) continue
      const g = ctx.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, radius)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.5, '#ffd76e')
      g.addColorStop(1, '#ff9f43')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(b.x, b.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}
