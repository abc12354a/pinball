import { View, Text } from '@tarojs/components'
import type { Phase, SettleResult, GameMode } from '../game/core/types'
import { soundManager } from '../audio/soundManager'
import './ControlPanel.scss'

const PHASE_TITLES: Record<Phase, string> = {
  IDLE: '投珠开局（5颗起）',
  READY: '就绪！请按【开始】',
  ROLL_MULT: '倍数滚轮抽取中…',
  BET_WINDOW: '已亮灯！可直接拉杆或加注',
  FIRE: '按住机台蓄力/松手发射',
  PHYSICS: '弹珠翻滚中…',
  SETTLE: '落道结算中…',
  BONUS_CHECK: '核算中…'
}

export interface ControlPanelProps {
  phase: Phase
  mult: number
  betTotal: number
  mode: GameMode
  canStart: boolean
  feverActive: boolean
  comboCount: number
  lastSettle: SettleResult | null
  onInsert: (n: number) => void
  onConfirmBet: () => void
  onToggleMode: () => void
  onFire: (power?: number) => void
}

export default function ControlPanel({
  phase,
  mult,
  betTotal,
  mode,
  canStart,
  feverActive,
  comboCount,
  lastSettle,
  onInsert,
  onConfirmBet,
  onToggleMode,
  onFire
}: ControlPanelProps) {
  const isFirePhase = phase === 'FIRE' || phase === 'BET_WINDOW'

  const handleChipClick = (amount: number) => {
    soundManager.playCoin()
    onInsert(amount)
  }

  const handleActionClick = () => {
    if (isFirePhase) {
      // FIRE/BET_WINDOW 均可直接发射（后者由引擎自动确认投注）
      soundManager.playLaunch()
      onFire(0.7) // 默认标准力道发射
      return
    }
    if (canStart) {
      soundManager.playCoin()
      onConfirmBet()
    }
  }

  let buttonText = '开始'
  let buttonClass = 'start-trigger-btn'

  if (isFirePhase) {
    buttonText = '🚀 发射'
    buttonClass += ' fire-btn'
  } else if (canStart) {
    buttonText = 'START'
    buttonClass += ' pulse'
  } else {
    buttonClass += ' disabled'
  }

  return (
    <View className="control-panel">
      <View className="cp-status-row">
        <View className="phase-badge">{PHASE_TITLES[phase] || '准备就绪'}</View>
        {feverActive && <View className="fever-badge">🔥 FEVER 连中加成中</View>}
        {!feverActive && comboCount > 1 && (
          <View className="fever-badge">⚡ COMBO ×{comboCount}</View>
        )}
        {mult > 0 && <Text className="mult-display">{mult}×</Text>}
      </View>

      <View className="cp-bet-row">
        <View className="bet-info">
          <Text className="bet-label">当前下注</Text>
          <Text className="bet-num">{betTotal} 颗</Text>
        </View>

        <View className="chips-group">
          <View className="chip-btn" onClick={() => handleChipClick(5)}>
            +5
          </View>
          <View className="chip-btn" onClick={() => handleChipClick(10)}>
            +10
          </View>
          <View className="chip-btn" onClick={() => handleChipClick(20)}>
            +20
          </View>
          <View className="chip-btn max" onClick={() => handleChipClick(50)}>
            MAX
          </View>
        </View>
      </View>

      <View className="cp-actions-row">
        <View className="mode-switch-btn" onClick={onToggleMode}>
          <Text className="mode-title">{mode === 'ball' ? '⚪ 弹珠模式' : '🎴 卡片模式'}</Text>
          <Text className="mode-desc">{mode === 'ball' ? '高额退珠' : '高命中抽卡'}</Text>
        </View>

        <View className={buttonClass} onClick={handleActionClick}>
          {buttonText}
        </View>
      </View>

      {lastSettle && (
        <View className="settle-feedback-row">
          {lastSettle.isWin
            ? `🎉 中奖！+${lastSettle.winBalls} 弹珠 ${lastSettle.cards > 0 ? `/ +${lastSettle.cards} 卡片` : ''}`
            : '未命中亮灯轨道，继续加油！'}
        </View>
      )}
    </View>
  )
}
