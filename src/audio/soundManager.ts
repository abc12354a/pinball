import Taro from '@tarojs/taro'

/**
 * 街机音效与触感管理器：
 * 采用 Web Audio 合成器 + 小程序触感震动（零网络资产开销，毫秒级响应）。
 * 极致健壮：支持微信小程序、H5、模拟器多环境安全降级，全方法异常吞吐与无声降级，绝不阻断业务。
 */

const PENTATONIC_FREQS = [523.25, 659.25, 783.99, 880.0, 1046.5, 1318.51]

class SoundManager {
  private ctx: any = null
  private enabled = true
  private hapticsEnabled = true

  constructor() {
    this.initAudioContext()
  }

  private initAudioContext(): void {
    try {
      if (typeof Taro !== 'undefined' && typeof (Taro as any).createWebAudioContext === 'function') {
        this.ctx = (Taro as any).createWebAudioContext()
      } else if (typeof (globalThis as any).wx !== 'undefined' && typeof (globalThis as any).wx.createWebAudioContext === 'function') {
        this.ctx = (globalThis as any).wx.createWebAudioContext()
      } else if (typeof window !== 'undefined') {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
        if (AudioCtx) {
          this.ctx = new AudioCtx()
        }
      }
    } catch {
      this.ctx = null
    }
  }

  setSoundEnabled(val: boolean): void {
    this.enabled = val
  }

  setHapticsEnabled(val: boolean): void {
    this.hapticsEnabled = val
  }

  isSoundEnabled(): boolean {
    return this.enabled
  }

  isHapticsEnabled(): boolean {
    return this.hapticsEnabled
  }

  private resumeCtx(): void {
    try {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume?.().catch?.(() => {})
      }
    } catch {}
  }

  /** 投币/加注音效：清脆的金币入槽声 */
  playCoin(): void {
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(987.77, now) // B5
      osc.frequency.setValueAtTime(1318.51, now + 0.08) // E6
      gain.gain.setValueAtTime(0.18, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.25)
    } catch {}
  }

  /** 弹珠碰钉音效：根据下落深度比 (0~1) 映射五音阶梯升调 */
  playBounce(depthFactor = 0.5): void {
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'triangle'

      const idx = Math.min(
        PENTATONIC_FREQS.length - 1,
        Math.max(0, Math.floor(depthFactor * PENTATONIC_FREQS.length))
      )
      const baseFreq = PENTATONIC_FREQS[idx] * (0.95 + Math.random() * 0.1)

      osc.frequency.setValueAtTime(baseFreq, now)
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, now + 0.04)
      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.05)
    } catch {}
  }

  /** 撞击黄金蘑菇钉：强弹性爆破混响声 */
  playBumper(): void {
    if (this.hapticsEnabled) {
      try {
        Taro.vibrateShort({ type: 'medium' })
      } catch {}
    }
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(440, now)
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12)
      gain.gain.setValueAtTime(0.28, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.3)
    } catch {}
  }

  /** 机械拉杆下拉时的齿轮棘轮卡滞音（Ratchet Click） */
  playRatchetClick(powerRatio = 0.5): void {
    if (this.hapticsEnabled) {
      try {
        Taro.vibrateShort({ type: 'light' })
      } catch {}
    }
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sawtooth'
      const freq = 400 + powerRatio * 600
      osc.frequency.setValueAtTime(freq, now)
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.02)
    } catch {}
  }

  /** 机械拉杆猛烈释放回弹声（CLACK-SNAP） */
  playPlungerRelease(): void {
    if (this.hapticsEnabled) {
      try {
        Taro.vibrateShort({ type: 'heavy' })
      } catch {}
    }
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime

      // 金属击发重低音
      const osc1 = this.ctx.createOscillator()
      const gain1 = this.ctx.createGain()
      osc1.type = 'triangle'
      osc1.frequency.setValueAtTime(160, now)
      osc1.frequency.exponentialRampToValueAtTime(40, now + 0.18)
      gain1.gain.setValueAtTime(0.35, now)
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
      osc1.connect(gain1)
      gain1.connect(this.ctx.destination)
      osc1.start(now)
      osc1.stop(now + 0.2)

      // 弹簧回弹高频杂音
      const osc2 = this.ctx.createOscillator()
      const gain2 = this.ctx.createGain()
      osc2.type = 'sawtooth'
      osc2.frequency.setValueAtTime(800, now)
      osc2.frequency.linearRampToValueAtTime(300, now + 0.12)
      gain2.gain.setValueAtTime(0.15, now)
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
      osc2.connect(gain2)
      gain2.connect(this.ctx.destination)
      osc2.start(now)
      osc2.stop(now + 0.14)
    } catch {}
  }

  /** 发射小球出膛音效 */
  playLaunch(): void {
    this.playPlungerRelease()
  }

  /** 投珠进道流珠音效 */
  playFeederRoll(): void {
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(600, now)
      osc.frequency.linearRampToValueAtTime(1200, now + 0.08)
      gain.gain.setValueAtTime(0.1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.12)
    } catch {}
  }

  /** 出球瀑布连续喷珠声 */
  playPayoutStream(count = 4): void {
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const actualCount = Math.min(count, 8)
      for (let i = 0; i < actualCount; i++) {
        const now = this.ctx.currentTime + i * 0.05
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(1400 + Math.random() * 400, now)
        gain.gain.setValueAtTime(0.09, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.04)
      }
    } catch {}
  }

  /** 翻牌风切声 */
  playCardFlip(): void {
    if (this.hapticsEnabled) {
      try {
        Taro.vibrateShort({ type: 'light' })
      } catch {}
    }
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(300, now)
      osc.frequency.exponentialRampToValueAtTime(1500, now + 0.15)
      gain.gain.setValueAtTime(0.18, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.2)
    } catch {}
  }

  /** SSR 锦鲤抽卡全屏爆鸣交响乐 */
  playSSRShine(): void {
    if (this.hapticsEnabled) {
      try {
        Taro.vibrateShort({ type: 'heavy' })
      } catch {}
    }
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]
      arpeggio.forEach((f, i) => {
        const now = (this.ctx?.currentTime ?? 0) + i * 0.08
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(f, now)
        gain.gain.setValueAtTime(0.24, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.42)
      })
    } catch {}
  }

  /** 倍数转盘跳动声（freqRatio 升调：滚动中随进度上扬） */
  playRollTick(freqRatio = 1): void {
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(1200 * freqRatio, now)
      gain.gain.setValueAtTime(0.06, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.03)
    } catch {}
  }

  /** 中奖胜利音效：三连音和弦 */
  playWin(): void {
    if (this.hapticsEnabled) {
      try {
        Taro.vibrateShort({ type: 'heavy' })
      } catch {}
    }
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const freqs = [523.25, 659.25, 783.99, 1046.5]
      freqs.forEach((f, idx) => {
        const now = (this.ctx?.currentTime ?? 0) + idx * 0.09
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(f, now)
        gain.gain.setValueAtTime(0.2, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.3)
      })
    } catch {}
  }

  /** 狂热 FEVER / 开心30秒触发警报 */
  playFever(): void {
    if (this.hapticsEnabled) {
      try {
        Taro.vibrateShort({ type: 'heavy' })
      } catch {}
    }
    if (!this.enabled) return
    try {
      this.resumeCtx()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(587.33, now)
      osc.frequency.linearRampToValueAtTime(880, now + 0.15)
      osc.frequency.linearRampToValueAtTime(587.33, now + 0.3)
      osc.frequency.linearRampToValueAtTime(1174.66, now + 0.45)
      gain.gain.setValueAtTime(0.22, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.6)
    } catch {}
  }

  /** 触发震动 */
  vibrate(type: 'light' | 'medium' | 'heavy' = 'light'): void {
    if (!this.hapticsEnabled) return
    try {
      Taro.vibrateShort({ type })
    } catch {}
  }
}

export const soundManager = new SoundManager()
