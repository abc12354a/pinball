import { useEffect, useReducer, useRef, useState } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { Canvas, View } from '@tarojs/components'
import { GameEngine } from '../../game/GameEngine'
import { useCanvasNode } from '../../game/hooks/useCanvasNode'
import { GameStore, useGameStore } from '../../store/gameStore'
import TopHeader from '../../components/TopHeader'
import ControlPanel from '../../components/ControlPanel'
import CardShopModal from '../../components/modals/CardShopModal'
import MissionsModal from '../../components/modals/MissionsModal'
import SupplyModal from '../../components/modals/SupplyModal'
import SettingsModal from '../../components/modals/SettingsModal'
import CardRevealModal from '../../components/modals/CardRevealModal'
import SpringPlunger from '../../components/SpringPlunger'
import { CONFIG } from '../../config/config'
import { soundManager } from '../../audio/soundManager'
import { markTouch, mouseProps } from '../../utils/pointer'
import './index.scss'

export default function GamePage() {
  const canvasInfo = useCanvasNode('gameCanvas')
  const storeRef = useRef<GameStore | null>(null)
  if (!storeRef.current) storeRef.current = new GameStore()
  const store = storeRef.current
  const snap = useGameStore(store)
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // 二级菜单状态
  const [showCardShop, setShowCardShop] = useState(false)
  const [showMissions, setShowMissions] = useState(false)
  const [showSupply, setShowSupply] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [revealingCards, setRevealingCards] = useState<string[] | null>(null)

  const engineRef = useRef<GameEngine | null>(null)

  useDidShow(() => engineRef.current?.resume())
  useDidHide(() => engineRef.current?.pause())

  useEffect(() => {
    if (!canvasInfo) return
    const engine = new GameEngine(canvasInfo.canvas, canvasInfo.width, canvasInfo.height, {
      onSettle: (result, roundCtx) => {
        store.handleSettle(result, roundCtx)
        if (result.cardIds && result.cardIds.length > 0) {
          setTimeout(() => {
            setRevealingCards(result.cardIds)
          }, 850)
        }
      },
      onBumperReward: store.handleBumperReward,
      getMode: () => store.player.mode
    })
    engineRef.current = engine

    // 应用当前装配的母球皮肤
    const activeSkinDef = CONFIG.shop.skins.find((s) => s.id === store.player.activeSkin)
    if (activeSkinDef) {
      engine.setBallSkin(activeSkinDef.color, activeSkinDef.glow)
    }

    const offStore = store.attach(engine.sm)
    engine.start()
    const offSm = engine.sm.subscribe(forceUpdate)

    return () => {
      offSm()
      offStore()
      engine.destroy()
      engineRef.current = null
    }
  }, [canvasInfo?.canvas, canvasInfo?.width, canvasInfo?.height])

  const sm = engineRef.current?.sm
  const ctx = sm?.ctx
  const player = snap.player

  const insert = (n: number) => {
    const r = store.insert(n)
    if (!r.ok) {
      Taro.showToast({ title: r.reason ?? '无法投珠', icon: 'none' })
    } else {
      engineRef.current?.triggerFeeder(n)
    }
  }

  const toggleMode = () => {
    if (!store.toggleMode()) {
      Taro.showToast({ title: '本局开局后无法切换模式', icon: 'none' })
    } else {
      soundManager.vibrate('light')
    }
  }

  const handleEquipSkin = (color: string, glow: string) => {
    engineRef.current?.setBallSkin(color, glow)
  }

  return (
    <View className="game-page">
      <TopHeader
        player={player}
        onOpenCards={() => setShowCardShop(true)}
        onOpenMissions={() => setShowMissions(true)}
        onOpenSupply={() => setShowSupply(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <View className="board-wrap">
        <Canvas
          type="2d"
          id="gameCanvas"
          className="board-canvas"
          disableScroll={process.env.TARO_ENV !== 'h5'}
          onTouchStart={() => {
            markTouch()
            engineRef.current?.handleTouchStart()
          }}
          onTouchEnd={() => {
            markTouch()
            engineRef.current?.handleTouchEnd()
          }}
          {...mouseProps({
            down: () => engineRef.current?.handleTouchStart(),
            up: () => engineRef.current?.handleTouchEnd()
          })}
        />
        <SpringPlunger
          active={sm?.phase === 'FIRE' || sm?.phase === 'BET_WINDOW'}
          onLaunch={(power) => engineRef.current?.launchWithPower(power)}
        />
      </View>

      <ControlPanel
        phase={sm?.phase ?? 'IDLE'}
        mult={ctx?.mult ?? 0}
        betTotal={ctx?.betTotal ?? 0}
        mode={player.mode}
        canStart={sm?.canStart ?? false}
        feverActive={ctx?.feverActive ?? false}
        comboCount={ctx?.comboCount ?? 0}
        lastSettle={ctx?.lastSettle ?? null}
        onInsert={insert}
        onConfirmBet={() => sm?.dispatch({ t: 'CONFIRM_BET' })}
        onToggleMode={toggleMode}
        onFire={(power) => engineRef.current?.launchWithPower(power ?? 0.7)}
      />

      {showCardShop && (
        <CardShopModal
          store={store}
          onClose={() => setShowCardShop(false)}
          onEquipSkin={handleEquipSkin}
        />
      )}

      {showMissions && (
        <MissionsModal store={store} onClose={() => setShowMissions(false)} />
      )}

      {showSupply && (
        <SupplyModal store={store} onClose={() => setShowSupply(false)} />
      )}

      {showSettings && (
        <SettingsModal store={store} onClose={() => setShowSettings(false)} />
      )}

      {revealingCards && revealingCards.length > 0 && (
        <CardRevealModal
          cardIds={revealingCards}
          onClose={() => setRevealingCards(null)}
        />
      )}
    </View>
  )
}
