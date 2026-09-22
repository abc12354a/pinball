/** Canvas 2D 节点的最小结构类型（规避小程序类型包依赖） */
export interface CanvasLike {
  width: number
  height: number
  getContext(type: '2d'): CanvasRenderingContext2D
  requestAnimationFrame(cb: (timestamp: number) => void): number
  cancelAnimationFrame(id: number): void
}

/**
 * GameLoop —— 基于 canvas.requestAnimationFrame 的主循环。
 * - 跟随屏幕刷新率，切后台自动暂停（小程序 rAF 特性）
 * - dt 钳制 50ms：恢复前台时的补偿帧不产生时间跳变
 * - start/stop 可重入
 */
export class GameLoop {
  private rafId = 0
  private lastTs = 0
  private running = false

  constructor(
    private canvas: CanvasLike,
    private tick: (dtMs: number, nowMs: number) => void
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTs = 0
    const frame = (ts: number) => {
      if (!this.running) return
      if (this.lastTs === 0) this.lastTs = ts
      const dt = Math.min(ts - this.lastTs, 50)
      this.lastTs = ts
      this.tick(dt, Date.now())
      this.rafId = this.canvas.requestAnimationFrame(frame)
    }
    this.rafId = this.canvas.requestAnimationFrame(frame)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.canvas.cancelAnimationFrame(this.rafId)
  }

  get isRunning(): boolean {
    return this.running
  }
}
