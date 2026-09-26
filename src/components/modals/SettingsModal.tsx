import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { GameStore } from '../../store/gameStore'
import { soundManager } from '../../audio/soundManager'
import './SettingsModal.scss'

interface SettingsModalProps {
  store: GameStore
  onClose: () => void
}

export default function SettingsModal({ store, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'settings' | 'guide'>('settings')
  const [soundOn, setSoundOn] = useState(soundManager.isSoundEnabled())
  const [hapticsOn, setHapticsOn] = useState(soundManager.isHapticsEnabled())

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    soundManager.setSoundEnabled(next)
    if (next) soundManager.playCoin()
  }

  const toggleHaptics = () => {
    const next = !hapticsOn
    setHapticsOn(next)
    soundManager.setHapticsEnabled(next)
    if (next) soundManager.vibrate('medium')
  }

  const handleResetData = () => {
    Taro.showModal({
      title: '重置游戏存档',
      content: '弹珠、卡片、积分及任务进度将全部清零，确定？',
      confirmColor: '#ff4d5e',
      success: (res) => {
        if (res.confirm) {
          store.reset()
          Taro.showToast({ title: '已恢复新机状态', icon: 'none' })
          onClose()
        }
      }
    })
  }

  return (
    <View className="arcade-modal-mask" onClick={onClose}>
      <View className="arcade-modal-card" onClick={(e) => e.stopPropagation()}>
        <View className="modal-header">
          <View className="modal-title">
            <Text>⚙️</Text>
            <Text>设置与规则指南</Text>
          </View>
          <View className="modal-close-btn" onClick={onClose}>
            ×
          </View>
        </View>

        <View className="modal-tabs">
          <View
            className={`modal-tab-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            系统设置
          </View>
          <View
            className={`modal-tab-item ${activeTab === 'guide' ? 'active' : ''}`}
            onClick={() => setActiveTab('guide')}
          >
            玩法秘籍
          </View>
        </View>

        <View className="modal-content-scroll">
          {activeTab === 'settings' && (
            <View className="settings-list">
              <View className="setting-row">
                <Text className="sr-label">街机音效</Text>
                <View className={`toggle-switch ${soundOn ? 'on' : ''}`} onClick={toggleSound}>
                  <View className="toggle-knob" />
                </View>
              </View>

              <View className="setting-row">
                <Text className="sr-label">按键触感震动</Text>
                <View className={`toggle-switch ${hapticsOn ? 'on' : ''}`} onClick={toggleHaptics}>
                  <View className="toggle-knob" />
                </View>
              </View>

              <View className="setting-row" style={{ marginTop: '20px' }}>
                <Text className="sr-label" style={{ color: '#ff6b81' }}>重置全部存档</Text>
                <View
                  className="modal-btn"
                  style={{
                    width: '160px',
                    height: '56px',
                    borderRadius: '28px',
                    background: 'rgba(255, 77, 94, 0.2)',
                    borderColor: '#ff4d5e',
                    color: '#ff4d5e',
                    fontSize: '22px'
                  }}
                  onClick={handleResetData}
                >
                  清空数据
                </View>
              </View>
            </View>
          )}

          {activeTab === 'guide' && (
            <View className="guide-section">
              <View className="guide-block">
                <Text className="gb-title">1. 投珠与倍数轮盘</Text>
                <Text className="gb-text">
                  5 颗起投，单局上限 50 颗。投珠后点击【START】摇出 2×~10× 倍数。倍数确定后亮灯轨道点亮，此时可直接下拉拉杆发射，也可在 6 秒加注窗口期内继续追加下注！
                </Text>
                <View className="paytable-grid">
                  <View className="pt-col">
                    <Text className="pt-mult">2×</Text>
                    <Text className="pt-lights">亮 4 灯</Text>
                  </View>
                  <View className="pt-col">
                    <Text className="pt-mult">4×</Text>
                    <Text className="pt-lights">亮 3 灯</Text>
                  </View>
                  <View className="pt-col">
                    <Text className="pt-mult">6×</Text>
                    <Text className="pt-lights">亮 2 灯</Text>
                  </View>
                  <View className="pt-col">
                    <Text className="pt-mult">8×</Text>
                    <Text className="pt-lights">亮 1 灯</Text>
                  </View>
                  <View className="pt-col">
                    <Text className="pt-mult">10×</Text>
                    <Text className="pt-lights">亮 1 灯</Text>
                  </View>
                </View>
              </View>

              <View className="guide-block">
                <Text className="gb-title">2. 黄金弹性钉与 Combo 狂热</Text>
                <Text className="gb-text">
                  钉板中区设有 2 颗黄金蘑菇钉，弹珠撞击将触发强力回弹并获得 +1 弹珠奖励！连续中奖触发 COMBO 加成，达成 3 连胜进入【FEVER 狂热模式】，下局保底额外点亮 1 盏轨道灯！
                </Text>
              </View>

              <View className="guide-block">
                <Text className="gb-title">3. 两种产出模式</Text>
                <Text className="gb-text">
                  ⚪【弹珠模式】：命中亮灯即返还 投注×倍数 弹珠，适合积累弹珠资产；
                  🎴【卡片模式】：命中率大幅提升 3 倍！命中后直接抽取稀有积分卡与续航卡，收集全套图鉴兑换外观！
                </Text>
              </View>
            </View>
          )}
        </View>

        <View className="modal-footer">
          <View className="modal-btn primary" onClick={onClose}>
            明白
          </View>
        </View>
      </View>
    </View>
  )
}
