import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { CONFIG, type CardDef } from '../../config/config'
import { soundManager } from '../../audio/soundManager'
import './CardRevealModal.scss'

export interface CardRevealModalProps {
  cardIds: string[]
  onClose: () => void
}

export default function CardRevealModal({ cardIds, onClose }: CardRevealModalProps) {
  const [flipped, setFlipped] = useState<boolean[]>(() => cardIds.map(() => false))
  const [packOpened, setPackOpened] = useState(false)

  const cards: CardDef[] = cardIds.map(
    (id) => CONFIG.cardPool.find((c) => c.id === id) ?? {
      id,
      name: '神秘卡片',
      type: 'base',
      points: 1,
      redeemBalls: 0,
      rarity: 'N',
      weight: 0
    }
  )

  // 进场自动触发卡包开启音效
  useEffect(() => {
    const timer = setTimeout(() => {
      setPackOpened(true)
      soundManager.playCardFlip()
    }, 350)
    return () => clearTimeout(timer)
  }, [])

  const handleFlipCard = (index: number) => {
    if (flipped[index]) return
    const next = [...flipped]
    next[index] = true
    setFlipped(next)

    const card = cards[index]
    if (card.rarity === 'SSR') {
      soundManager.playSSRShine()
      try {
        Taro.vibrateShort({ type: 'heavy' })
      } catch {}
    } else if (card.rarity === 'SR') {
      soundManager.playSSRShine()
      try {
        Taro.vibrateShort({ type: 'medium' })
      } catch {}
    } else {
      soundManager.playCardFlip()
      try {
        Taro.vibrateShort({ type: 'light' })
      } catch {}
    }
  }

  const handleFlipAll = () => {
    let delay = 0
    cards.forEach((card, idx) => {
      if (!flipped[idx]) {
        setTimeout(() => {
          setFlipped((prev) => {
            const next = [...prev]
            next[idx] = true
            return next
          })
          if (card.rarity === 'SSR' || card.rarity === 'SR') {
            soundManager.playSSRShine()
          } else {
            soundManager.playCardFlip()
          }
        }, delay)
        delay += 140
      }
    })
  }

  const allFlipped = flipped.every(Boolean)
  const hasSSR = cards.some((c) => c.rarity === 'SSR')

  return (
    <View className="card-reveal-modal">
      <View className="crm-backdrop" onClick={allFlipped ? onClose : handleFlipAll} />

      <View className="crm-container">
        {/* 顶部标题区 */}
        <View className="crm-header">
          <Text className="crm-title">
            {hasSSR ? '✨ 欧气爆发！传说卡降临 ✨' : '🎴 获得新卡片'}
          </Text>
          <Text className="crm-sub">点击卡片逐张翻开，探索稀有卡面！</Text>
        </View>

        {/* 3D 卡牌陈列台 */}
        <View className={`cards-stage ${packOpened ? 'pack-ready' : 'pack-closed'}`}>
          {cards.map((card, idx) => {
            const isFlipped = flipped[idx]
            const isSSR = card.rarity === 'SSR'
            const isSR = card.rarity === 'SR'
            return (
              <View
                key={idx}
                className={`card-3d-wrapper ${isFlipped ? 'flipped' : ''} rarity-${card.rarity.toLowerCase()}`}
                onClick={() => handleFlipCard(idx)}
              >
                <View className="card-inner">
                  {/* 卡牌背面 */}
                  <View className="card-face card-back">
                    <View className="back-emboss">
                      <View className="back-gem">🔮</View>
                      <Text className="back-text">PINBALL</Text>
                      <View className="back-sub">TAP TO FLIP</View>
                    </View>
                  </View>

                  {/* 卡牌正面 */}
                  <View className={`card-face card-front ${card.rarity.toLowerCase()}`}>
                    {/* SSR / SR 光环特效 */}
                    {(isSSR || isSR) && <View className="holo-sheen" />}

                    <View className="card-badge">
                      <Text className="badge-text">{card.rarity}</Text>
                    </View>

                    <View className="card-art">
                      <Text className="art-emoji">
                        {card.id === 'legend'
                          ? '👑'
                          : card.id === 'epic'
                            ? '⚡'
                            : card.id === 'lucky'
                              ? '🍀'
                              : card.id === 'sustain'
                                ? '🔋'
                                : '⭐'}
                      </Text>
                    </View>

                    <View className="card-meta">
                      <Text className="card-name">{card.name}</Text>
                      <Text className="card-desc">
                        {card.points > 0 ? `+${card.points} 积分` : `兑换 +${card.redeemBalls} 珠`}
                      </Text>
                    </View>

                    {card.rarity === 'SSR' && <View className="ssr-burst-rays" />}
                  </View>
                </View>
              </View>
            )
          })}
        </View>

        {/* 底部操作区 */}
        <View className="crm-actions">
          {!allFlipped ? (
            <View className="crm-btn crm-btn-secondary" onClick={handleFlipAll}>
              全部翻开
            </View>
          ) : (
            <View className="crm-btn crm-btn-primary" onClick={onClose}>
              收下卡片
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
