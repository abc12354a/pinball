import { useEffect, useReducer, useRef, useState } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { Canvas, View, Text } from '@tarojs/components'
import { GameEngine } from '../../game/GameEngine'
import { useCanvasNode } from '../../game/hooks/useCanvasNode'
import { GameStore, useGameStore } from '../../store/gameStore'
import TournamentModal from '../../components/TournamentModal'
import CardPackModal from '../../components/CardPackModal'
import type { TournamentRunner } from '../../events/tournaments'
import { CONFIG } from '../../config/config'
import type { Phase } from '../../game/core/types'
import './index.scss'

const PHASE_LABEL: Record<Phase, string> = {
  IDLE: '投珠开局（5颗起）',
  READY: '按【开始】摇倍数',
  ROLL_MULT: '倍数滚动中…',
  BET_WINDOW: '亮灯！可加注',
  FIRE: '按住画布蓄力，松手发射',
  PHYSICS: '滚动中…',
  SETTLE: '结算中…',
  BONUS_CHECK: '…',
  HAPPY30S: '🎉 开心30秒：免费连发！',
  EVENT_INVITE: '赛事邀请',
  ONLINE_MINIGAME: '赛事进行中'
}

export default function GamePage() {
  const canvasInfo = useCanvasNode('gameCanvas')
  const storeRef = useRef<GameStore | null>(null)
  if (!storeRef.current) storeRef.current = new GameStore()
  const store = storeRef.current
  const snap = useGameStore(store)
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const [happyLeft, setHappyLeft] = useState(0)
  const [runner, setRunner] = useState<TournamentRunner | null>(null)
  const [showCards, setShowCards] = useState(false)
  const engineRef = useRef<GameEngine | null>(null)

  useDidShow(() => engineRef.current?.resume())
  useDidHide(() => engineRef.current?.pause())

  useEffect(() => {
    if (!canvasInfo) return
    const engine = new GameEngine(canvasInfo.canvas, canvasInfo.width, canvasInfo.height, {
      onSettle: store.handleSettle,
      onReward: store.handleReward,
      getMode: () => store.player.mode
    })
    engineRef.current = engine
    setRunner(engine.tournament)
    const offStore = store.attach(engine.sm)
    engine.start()
    const offSm = engine.sm.subscribe(forceUpdate)
    return () => {
      offSm()
      offStore()
      engine.destroy()
      engineRef.current = null
      setRunner(null)
    }
  }, [canvasInfo?.canvas, canvasInfo?.width, canvasInfo?.height])

  // 开心30秒倒计时（秒级，非帧级）
  useEffect(() => {
    const sm = engineRef.current?.sm
    if (!sm?.ctx.happy.active) {
      setHappyLeft(0)
      return
    }
    const tick = () => setHappyLeft(Math.max(0, Math.ceil((sm.ctx.happy.endTime - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [snap.version, engineRef.current?.sm?.ctx.happy.active])

  const sm = engineRef.current?.sm
  const ctx = sm?.ctx
  const player = snap.player

  const insert = (n: number) => {
    const r = store.insert(n)
    if (!r.ok) Taro.showToast({ title: r.reason ?? '无法投珠', icon: 'none' })
  }

  const toggleMode = () => {
    if (!store.toggleMode()) {
      Taro.showToast({ title: '本局结束后才能切换', icon: 'none' })
    }
  }

  const refill = () => {
    Taro.showModal({
      title: '补充弹珠',
      content: '模拟买珠：免费补给 100 颗，继续游玩？',
      success: (res) => {
        if (res.confirm) {
          store.refill(100)
          Taro.showToast({ title: '+100 珠', icon: 'none' })
        }
      }
    })
  }

  return (
    <View className="game-page">
      <View className="board-wrap">
        <Canvas
          type="2d"
          id="gameCanvas"
          className="board-canvas"
          disableScroll
          onTouchStart={() => engineRef.current?.handleTouchStart()}
          onTouchEnd={() => engineRef.current?.handleTouchEnd()}
        />
        {happyLeft > 0 && <View className="happy-badge">🎉 免费连发 {happyLeft}s</View>}
      </View>

      <View className="hud">
        <View className="hud-row hud-status">
          <Text className="phase">{canvasInfo ? PHASE_LABEL[sm?.phase ?? 'IDLE'] : '加载中…'}</Text>
          {ctx && ctx.mult > 0 && <Text className="mult">{ctx.mult}×</Text>}
        </View>
        <View className="hud-row">
          <View className="stat">
            <Text className="stat-num">{player.balls}</Text>
            <Text className="stat-label">弹珠</Text>
          </View>
          <View className="stat">
            <Text className="stat-num">{ctx?.betTotal ?? 0}</Text>
            <Text className="stat-label">已投注</Text>
          </View>
          <View className="stat">
            <Text className="stat-num">{player.points}</Text>
            <Text className="stat-label">积分</Text>
          </View>
          <View className="stat" onClick={() => setShowCards(true)}>
            <Text className="stat-num">
              {Object.values(player.cards).reduce((a, b) => a + b, 0)}
            </Text>
            <Text className="stat-label">卡包 ›</Text>
          </View>
        </View>
        <View className="hud-row energy-row">
          <Text className="energy-label">能量</Text>
          <View className="lamps">
            {Array.from({ length: CONFIG.energy.lampCount }).map((_, i) => (
              <View
                key={i}
                className={`lamp ${i < (ctx?.energyLamps ?? 0) ? 'on' : ''}`}
              />
            ))}
          </View>
          <Text className="energy-hint">
            {(ctx?.energyLamps ?? 0) >= CONFIG.energy.lampCount ? '即将免费连发！' : '满灯触发开心30秒'}
          </Text>
        </View>
        <View className="hud-row hud-actions">
          <View
            className={`btn primary ${sm?.canStart ? '' : 'disabled'}`}
            onClick={() => sm?.dispatch({ t: 'CONFIRM_BET' })}
          >
            开始
          </View>
          <View className="btn" onClick={() => insert(5)}>
            投5珠
          </View>
          <View className="btn" onClick={() => insert(20)}>
            投20珠
          </View>
          <View className={`btn mode-${player.mode}`} onClick={toggleMode}>
            {player.mode === 'ball' ? '弹珠模式' : '卡片模式'}
          </View>
          <View className="btn" onClick={refill}>
            补珠
          </View>
        </View>
        {ctx?.lastSettle && (
          <View className="hud-row settle">
            {ctx.lastSettle.isWin
              ? `中奖 +${ctx.lastSettle.winBalls}珠 / ${ctx.lastSettle.cards}卡`
              : '未中奖'}
          </View>
        )}
      </View>

      {runner && <TournamentModal runner={runner} />}
      {showCards && <CardPackModal store={store} onClose={() => setShowCards(false)} />}
    </View>
  )
}
