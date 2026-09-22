import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { CONFIG } from '../config/config'
import type { GameStore } from '../store/gameStore'
import { cardDefOf } from '../store/wallet'
import './CardPackModal.scss'

const RARITY_LABEL: Record<string, string> = { N: '普通', R: '稀有', SR: '超稀', SSR: '传说' }

/** 卡包/积分/统计 弹窗（收集线入口） */
export default function CardPackModal({ store, onClose }: { store: GameStore; onClose: () => void }) {
  const p = store.player
  const sustainCount = p.cards['sustain'] ?? 0
  const totalCards = Object.values(p.cards).reduce((a, b) => a + b, 0)

  const redeem = () => {
    if (store.redeem()) {
      Taro.showToast({ title: `续航卡兑换 +${cardDefOf('sustain')?.redeemBalls ?? 20} 珠`, icon: 'none' })
    } else {
      Taro.showToast({ title: '没有续航卡', icon: 'none' })
    }
  }

  const reset = () => {
    Taro.showModal({
      title: '重置存档',
      content: '弹珠/卡片/积分/能量全部清零，确定？',
      success: (res) => {
        if (res.confirm) {
          store.reset()
          onClose()
        }
      }
    })
  }

  return (
    <View className="cp-mask" onClick={onClose}>
      <View className="cp-card" onClick={(e) => e.stopPropagation()}>
        <View className="cp-title">🎴 我的卡包</View>

        <View className="cp-summary">
          <View className="cp-item">
            <Text className="cp-num">{totalCards}</Text>
            <Text className="cp-label">总卡数</Text>
          </View>
          <View className="cp-item">
            <Text className="cp-num">{p.points}</Text>
            <Text className="cp-label">积分</Text>
          </View>
          <View className="cp-item">
            <Text className="cp-num">{p.stats.rounds}</Text>
            <Text className="cp-label">总局数</Text>
          </View>
          <View className="cp-item">
            <Text className="cp-num">
              {p.stats.rounds ? Math.round((p.stats.wins / p.stats.rounds) * 100) : 0}%
            </Text>
            <Text className="cp-label">命中率</Text>
          </View>
        </View>

        <View className="cp-list">
          {CONFIG.cardPool.map((c) => {
            const n = p.cards[c.id] ?? 0
            return (
              <View key={c.id} className={`cp-row ${n === 0 ? 'none' : ''} r-${c.rarity}`}>
                <View className="cp-cardchip">{c.name}</View>
                <Text className="cp-rarity">{RARITY_LABEL[c.rarity]}</Text>
                <Text className="cp-detail">
                  {c.type === 'sustain' ? `兑${c.redeemBalls}珠` : `${c.points}积分`}
                </Text>
                <Text className="cp-count">×{n}</Text>
              </View>
            )
          })}
        </View>

        <View className="cp-actions">
          <View className={`cp-btn ${sustainCount === 0 ? 'disabled' : ''}`} onClick={redeem}>
            续航卡兑珠（{sustainCount}张）
          </View>
          <View className="cp-btn danger" onClick={reset}>
            重置存档
          </View>
        </View>
        <View className="cp-close" onClick={onClose}>
          关闭
        </View>
      </View>
    </View>
  )
}
