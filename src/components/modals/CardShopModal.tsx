import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { CONFIG } from '../../config/config'
import type { GameStore } from '../../store/gameStore'
import { cardDefOf } from '../../store/wallet'
import { soundManager } from '../../audio/soundManager'
import './CardShopModal.scss'

interface CardShopModalProps {
  store: GameStore
  onClose: () => void
  onEquipSkin?: (color: string, glow: string) => void
}

const CARD_EMOJIS: Record<string, string> = {
  base: '🃏',
  sustain: '🔋',
  lucky: '🍀',
  epic: '💎',
  legend: '🎏'
}

export default function CardShopModal({ store, onClose, onEquipSkin }: CardShopModalProps) {
  const [activeTab, setActiveTab] = useState<'album' | 'synergy' | 'shop'>('album')
  const p = store.player
  const sustainCount = p.cards['sustain'] ?? 0

  const handleRedeem = () => {
    if (store.redeem()) {
      soundManager.playCoin()
      Taro.showToast({
        title: `续航卡兑换 +${cardDefOf('sustain')?.redeemBalls ?? 20} 珠`,
        icon: 'none'
      })
    } else {
      Taro.showToast({ title: '暂无可用续航卡', icon: 'none' })
    }
  }

  const handleBuySkin = (skinId: string) => {
    const skin = CONFIG.shop.skins.find((s) => s.id === skinId)
    if (!skin) return
    if (store.buySkin(skinId)) {
      soundManager.playCoin()
      Taro.showToast({ title: `成功解锁 ${skin.name}`, icon: 'none' })
      onEquipSkin?.(skin.color, skin.glow)
    } else {
      Taro.showToast({ title: '积分不足', icon: 'none' })
    }
  }

  const handleEquipSkin = (skinId: string) => {
    const skin = CONFIG.shop.skins.find((s) => s.id === skinId)
    if (!skin) return
    if (store.equipSkin(skinId)) {
      soundManager.vibrate('light')
      Taro.showToast({ title: `已换装 ${skin.name}`, icon: 'none' })
      onEquipSkin?.(skin.color, skin.glow)
    }
  }

  const handleBuyPack = (packId: string) => {
    const pack = CONFIG.shop.packs.find((x) => x.id === packId)
    if (!pack) return
    if (store.buyBallPack(packId)) {
      soundManager.playCoin()
      Taro.showToast({ title: `兑换成功 +${pack.balls} 弹珠`, icon: 'none' })
    } else {
      Taro.showToast({ title: '积分不足', icon: 'none' })
    }
  }

  return (
    <View className="arcade-modal-mask" onClick={onClose}>
      <View className="arcade-modal-card" onClick={(e) => e.stopPropagation()}>
        <View className="modal-header">
          <View className="modal-title">
            <Text>🎴</Text>
            <Text>卡牌工坊与商城</Text>
          </View>
          <View className="modal-close-btn" onClick={onClose}>
            ×
          </View>
        </View>

        <View className="modal-tabs">
          <View
            className={`modal-tab-item ${activeTab === 'album' ? 'active' : ''}`}
            onClick={() => setActiveTab('album')}
          >
            卡牌图鉴
          </View>
          <View
            className={`modal-tab-item ${activeTab === 'synergy' ? 'active' : ''}`}
            onClick={() => setActiveTab('synergy')}
          >
            收集羁绊
          </View>
          <View
            className={`modal-tab-item ${activeTab === 'shop' ? 'active' : ''}`}
            onClick={() => setActiveTab('shop')}
          >
            积分商城
          </View>
        </View>

        <View className="modal-content-scroll">
          {activeTab === 'album' && (
            <View>
              <View className="card-album-grid">
                {CONFIG.cardPool.map((c) => {
                  const count = p.cards[c.id] ?? 0
                  return (
                    <View
                      key={c.id}
                      className={`album-card-item r-${c.rarity} ${count === 0 ? 'locked' : ''}`}
                    >
                      <View className={`card-rarity-pill r-${c.rarity}`}>{c.rarity}</View>
                      <Text className="card-emoji">{CARD_EMOJIS[c.id] || '🎴'}</Text>
                      <Text className="card-name">{c.name}</Text>
                      <Text className="card-effect">
                        {c.type === 'sustain' ? `可兑换 ${c.redeemBalls} 珠` : `面值 +${c.points} 积分`}
                      </Text>
                      <View className="card-count-badge">拥有: {count}</View>
                    </View>
                  )
                })}
              </View>

              {sustainCount > 0 && (
                <View className="modal-footer" style={{ marginTop: '16px', padding: 0 }}>
                  <View className="modal-btn gold" onClick={handleRedeem}>
                    续航卡兑换弹珠（{sustainCount} 张可用）
                  </View>
                </View>
              )}
            </View>
          )}

          {activeTab === 'synergy' && (
            <View className="synergy-list">
              <View className={`synergy-card ${(p.cards['sustain'] ?? 0) > 0 ? 'active' : ''}`}>
                <Text className="syn-icon">🔋</Text>
                <View className="syn-info">
                  <Text className="syn-title">续航补给线</Text>
                  <Text className="syn-desc">拥有续航卡，随时兑换 20 颗应急弹珠</Text>
                </View>
                <Text className={`syn-tag ${(p.cards['sustain'] ?? 0) > 0 ? 'active' : ''}`}>
                  {(p.cards['sustain'] ?? 0) > 0 ? '已激活' : '未解锁'}
                </Text>
              </View>

              <View className={`synergy-card ${(p.cards['lucky'] ?? 0) > 0 ? 'active' : ''}`}>
                <Text className="syn-icon">🍀</Text>
                <View className="syn-info">
                  <Text className="syn-title">幸运光环</Text>
                  <Text className="syn-desc">拥有幸运卡，提升卡片模式抽卡品质加成</Text>
                </View>
                <Text className={`syn-tag ${(p.cards['lucky'] ?? 0) > 0 ? 'active' : ''}`}>
                  {(p.cards['lucky'] ?? 0) > 0 ? '已激活' : '未解锁'}
                </Text>
              </View>

              <View className={`synergy-card ${(p.cards['legend'] ?? 0) > 0 ? 'active' : ''}`}>
                <Text className="syn-icon">🎏</Text>
                <View className="syn-info">
                  <Text className="syn-title">锦鲤降世</Text>
                  <Text className="syn-desc">拥有 SSR 锦鲤卡，中奖获得专属全屏金光特效</Text>
                </View>
                <Text className={`syn-tag ${(p.cards['legend'] ?? 0) > 0 ? 'active' : ''}`}>
                  {(p.cards['legend'] ?? 0) > 0 ? '已激活' : '未解锁'}
                </Text>
              </View>
            </View>
          )}

          {activeTab === 'shop' && (
            <View>
              <Text className="shop-section-title">母球炫彩外观</Text>
              <View className="shop-grid">
                {CONFIG.shop.skins.map((skin) => {
                  const unlocked = p.unlockedSkins.includes(skin.id)
                  const isEquipped = p.activeSkin === skin.id
                  return (
                    <View key={skin.id} className="shop-card">
                      <View
                        className="skin-preview"
                        style={{
                          background: `radial-gradient(circle at 35% 35%, #fff, ${skin.color} 50%, ${skin.glow} 100%)`,
                          boxShadow: `0 0 16px ${skin.glow}`
                        }}
                      />
                      <Text className="item-name">{skin.name}</Text>
                      <Text className="item-cost">{unlocked ? '已拥有' : `${skin.price} 积分`}</Text>
                      {unlocked ? (
                        <View
                          className={`buy-btn ${isEquipped ? 'equipped' : ''}`}
                          onClick={() => !isEquipped && handleEquipSkin(skin.id)}
                        >
                          {isEquipped ? '装配中' : '使用'}
                        </View>
                      ) : (
                        <View
                          className={`buy-btn ${p.points < skin.price ? 'disabled' : ''}`}
                          onClick={() => handleBuySkin(skin.id)}
                        >
                          购买
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>

              <Text className="shop-section-title">弹珠积分兑换</Text>
              <View className="shop-grid">
                {CONFIG.shop.packs.map((pack) => (
                  <View key={pack.id} className="shop-card">
                    <Text style={{ fontSize: '32px', margin: '8px 0' }}>🎁</Text>
                    <Text className="item-name">{pack.name}</Text>
                    <Text className="item-cost">
                      +{pack.balls} 弹珠 ({pack.costPoints} 积分)
                    </Text>
                    <View
                      className={`buy-btn ${p.points < pack.costPoints ? 'disabled' : ''}`}
                      onClick={() => handleBuyPack(pack.id)}
                    >
                      兑换
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        <View className="modal-footer">
          <View className="modal-btn primary" onClick={onClose}>
            完成
          </View>
        </View>
      </View>
    </View>
  )
}
