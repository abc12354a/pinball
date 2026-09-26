import { View, Text } from '@tarojs/components'
import type { PlayerState } from '../store/wallet'
import { CONFIG } from '../config/config'
import './TopHeader.scss'

export interface TopHeaderProps {
  player: PlayerState
  onOpenCards: () => void
  onOpenMissions: () => void
  onOpenSupply: () => void
  onOpenSettings: () => void
}

export default function TopHeader({
  player,
  onOpenCards,
  onOpenMissions,
  onOpenSupply,
  onOpenSettings
}: TopHeaderProps) {
  // 检查是否有未领取的任务或成就
  const hasUnclaimedMissions =
    CONFIG.missions.some((m) => {
      const p = player.dailyMissions[m.id]
      return p && !p.claimed && p.progress >= m.target
    }) ||
    CONFIG.achievements.some((a) => {
      const p = player.achievements[a.id]
      return p && !p.claimed && p.progress >= a.target
    })

  return (
    <View className="top-header">
      <View className="header-top-row">
        <View className="pilot-badge" onClick={onOpenMissions}>
          <View className="avatar">👾</View>
          <View className="pilot-info">
            <Text className="pilot-title">{player.title || '弹珠机师'}</Text>
            <Text className="pilot-sub">Lv.{Math.max(1, Math.floor(player.stats.rounds / 5) + 1)} · 弹珠堂</Text>
          </View>
        </View>

        <View className="header-assets-row">
          <View className="asset-capsule" onClick={onOpenSupply}>
            <View className="capsule-main">
              <Text className="asset-icon">🟡</Text>
              <Text className="asset-val">{player.balls}</Text>
            </View>
            <View className="asset-add">+</View>
          </View>

          <View className="asset-capsule" onClick={onOpenCards}>
            <View className="capsule-main">
              <Text className="asset-icon">💎</Text>
              <Text className="asset-val">{player.points}</Text>
            </View>
          </View>
        </View>

        <View className="header-nav">
          <View className="nav-icon-btn" onClick={onOpenCards}>
            🎴
          </View>
          <View className="nav-icon-btn" onClick={onOpenMissions}>
            🎯
            {hasUnclaimedMissions && <View className="red-dot" />}
          </View>
          <View className="nav-icon-btn" onClick={onOpenSupply}>
            🛍️
          </View>
          <View className="nav-icon-btn" onClick={onOpenSettings}>
            ⚙️
          </View>
        </View>
      </View>
    </View>
  )
}
