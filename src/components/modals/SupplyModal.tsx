import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { CONFIG } from '../../config/config'
import type { GameStore } from '../../store/gameStore'
import { soundManager } from '../../audio/soundManager'
import './SupplyModal.scss'

interface SupplyModalProps {
  store: GameStore
  onClose: () => void
}

export default function SupplyModal({ store, onClose }: SupplyModalProps) {
  const p = store.player
  const isRescueEligible = p.balls <= CONFIG.rescue.minBallsTrigger && p.dailyRescuesLeft > 0

  const handleRescue = () => {
    if (store.claimRescue()) {
      soundManager.playWin()
      Taro.showToast({ title: `老板请客：+${CONFIG.rescue.ballsGiven} 弹珠！`, icon: 'none' })
    } else {
      Taro.showToast({ title: '当前暂不满足救济金领取条件', icon: 'none' })
    }
  }

  const handleRefill = (n: number) => {
    store.refill(n)
    soundManager.playCoin()
    Taro.showToast({ title: `补给到账 +${n} 弹珠`, icon: 'none' })
  }

  return (
    <View className="arcade-modal-mask" onClick={onClose}>
      <View className="arcade-modal-card" onClick={(e) => e.stopPropagation()}>
        <View className="modal-header">
          <View className="modal-title">
            <Text>🛍️</Text>
            <Text>弹珠补给与救济站</Text>
          </View>
          <View className="modal-close-btn" onClick={onClose}>
            ×
          </View>
        </View>

        <View className="modal-content-scroll">
          <View className="supply-grid">
            <View className={`supply-box ${isRescueEligible ? 'highlight' : ''}`}>
              <View className="sb-left">
                <Text className="sb-icon">🆘</Text>
                <View className="sb-info">
                  <Text className="sb-title">老板请客救济金</Text>
                  <Text className="sb-desc">
                    弹珠少于 5 颗时可领 · 今日剩余 {p.dailyRescuesLeft} 次
                  </Text>
                </View>
              </View>
              <View
                className={`sb-btn primary ${isRescueEligible ? '' : 'disabled'}`}
                onClick={handleRescue}
              >
                +100 珠
              </View>
            </View>

            <View className="supply-box">
              <View className="sb-left">
                <Text className="sb-icon">☕</Text>
                <View className="sb-info">
                  <Text className="sb-title">休闲补充装</Text>
                  <Text className="sb-desc">自娱体验免充值补给</Text>
                </View>
              </View>
              <View className="sb-btn" onClick={() => handleRefill(100)}>
                +100 珠
              </View>
            </View>

            <View className="supply-box">
              <View className="sb-left">
                <Text className="sb-icon">📦</Text>
                <View className="sb-info">
                  <Text className="sb-title">大号补给箱</Text>
                  <Text className="sb-desc">尽兴畅玩加倍痛快</Text>
                </View>
              </View>
              <View className="sb-btn" onClick={() => handleRefill(300)}>
                +300 珠
              </View>
            </View>

            <View className="supply-box">
              <View className="sb-left">
                <Text className="sb-icon">💎</Text>
                <View className="sb-info">
                  <Text className="sb-title">千珠狂欢包</Text>
                  <Text className="sb-desc">满仓弹珠尽情下注</Text>
                </View>
              </View>
              <View className="sb-btn" onClick={() => handleRefill(1000)}>
                +1000 珠
              </View>
            </View>
          </View>
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
