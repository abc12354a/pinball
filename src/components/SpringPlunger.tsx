import { useState, useRef, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { soundManager } from '../audio/soundManager'
import './SpringPlunger.scss'

export interface SpringPlungerProps {
  active: boolean
  onLaunch: (power: number) => void
}

const MAX_DRAG_PX = 85
const NUM_LEDS = 8
const RATCHET_STEPS = 8

export default function SpringPlunger({ active, onLaunch }: SpringPlungerProps) {
  const [pullDist, setPullDist] = useState(0)
  const [isPulling, setIsPulling] = useState(false)
  const [isSnapping, setIsSnapping] = useState(false)
  const startYRef = useRef(0)
  const lastRatchetRef = useRef(0)

  const power = Math.min(1, pullDist / MAX_DRAG_PX)

  const handleTouchStart = useCallback(
    (e: any) => {
      if (!active) return
      const touch = e.touches?.[0]
      if (!touch) return
      startYRef.current = touch.clientY
      lastRatchetRef.current = 0
      setIsPulling(true)
      setIsSnapping(false)
    },
    [active]
  )

  const handleTouchMove = useCallback(
    (e: any) => {
      if (!active || !isPulling) return
      const touch = e.touches?.[0]
      if (!touch) return
      const dy = Math.max(0, Math.min(MAX_DRAG_PX, touch.clientY - startYRef.current))
      setPullDist(dy)

      // 棘轮齿顿挫感与音效
      const currentPower = dy / MAX_DRAG_PX
      const step = Math.floor(currentPower * RATCHET_STEPS)
      if (step > lastRatchetRef.current) {
        lastRatchetRef.current = step
        soundManager.playRatchetClick(currentPower)
        try {
          Taro.vibrateShort({ type: 'light' })
        } catch {}
      }
    },
    [active, isPulling]
  )

  const handleTouchEnd = useCallback(() => {
    if (!active || !isPulling) return
    setIsPulling(false)

    const finalPower = Math.min(1, pullDist / MAX_DRAG_PX)
    if (finalPower >= 0.15) {
      // 触发发射
      onLaunch(finalPower)
      soundManager.playPlungerRelease()
    } else if (pullDist < 10) {
      // 单击快捷发射（默认70%力道）
      onLaunch(0.7)
      soundManager.playPlungerRelease()
    }

    // 机械弹簧回弹与过冲震颤
    setIsSnapping(true)
    setPullDist(0)
    setTimeout(() => {
      setIsSnapping(false)
    }, 280)
  }, [active, isPulling, pullDist, onLaunch])

  // 纯 CSS 计算弹簧压缩高度（从 85px 压缩至 22px）
  const springHeight = Math.max(22, 85 - pullDist * 0.72)

  return (
    <View
      className={`spring-plunger-widget ${active ? 'active' : 'disabled'} ${
        isSnapping ? 'snapping' : ''
      }`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* 刻度张力指示灯 (8 段 LED) */}
      <View className="led-gauge-column">
        {Array.from({ length: NUM_LEDS }).map((_, idx) => {
          // 自底向上点亮：第 0 段是底部
          const ledIndexFromBottom = NUM_LEDS - 1 - idx
          const threshold = ledIndexFromBottom / NUM_LEDS
          const isLit = active && power > threshold
          const isHigh = idx < 2
          const isMid = idx >= 2 && idx < 5
          return (
            <View
              key={idx}
              className={`led-segment ${isLit ? 'lit' : ''} ${
                isHigh ? 'danger' : isMid ? 'warn' : 'ok'
              }`}
            />
          )
        })}
      </View>

      {/* 机械筒身与弹簧室 */}
      <View className="plunger-chamber">
        <View className="plunger-casing">
          {/* 金属拉杆轴 */}
          <View
            className="plunger-shaft"
            style={{
              transform: `translateY(${pullDist}px)`
            }}
          />

          {/* 3D 机械弹簧组 (纯 View 椭圆圈层叠，100% 兼容微信小程序 WXML 模板引擎) */}
          <View
            className="plunger-spring-chamber"
            style={{
              height: `${springHeight}px`
            }}
          >
            {Array.from({ length: 6 }).map((_, idx) => (
              <View key={idx} className="spring-coil-unit" />
            ))}
          </View>

          {/* 底部抓握球形手柄 / 拉杆旋钮 */}
          <View
            className={`plunger-knob ${isPulling ? 'pulling' : ''}`}
            style={{
              transform: `translateY(${pullDist}px)`
            }}
          >
            <View className="knob-highlight" />
            <View className="knob-ring" />
            <Text className="knob-label">
              {active ? (power > 0 ? `${Math.round(power * 100)}%` : 'PULL') : 'LOCK'}
            </Text>
          </View>
        </View>
      </View>

      {/* 提示文案 */}
      <View className="plunger-text-hint">
        {active ? (power > 0 ? '松手发射' : '下拉蓄力') : '待命中'}
      </View>
    </View>
  )
}
