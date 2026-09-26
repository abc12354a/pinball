import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { CONFIG } from '../../config/config'
import type { GameStore } from '../../store/gameStore'
import { soundManager } from '../../audio/soundManager'
import './MissionsModal.scss'

interface MissionsModalProps {
  store: GameStore
  onClose: () => void
}

export default function MissionsModal({ store, onClose }: MissionsModalProps) {
  const [activeTab, setActiveTab] = useState<'daily' | 'achieve'>('daily')
  const p = store.player

  const handleClaimMission = (id: string) => {
    if (store.claimMission(id)) {
      soundManager.playCoin()
      Taro.showToast({ title: '领取成功！', icon: 'none' })
    }
  }

  const handleClaimAchievement = (id: string) => {
    if (store.claimAchievement(id)) {
      soundManager.playWin()
      Taro.showToast({ title: '成就达成！', icon: 'none' })
    }
  }

  const winRate = p.stats.rounds > 0 ? Math.round((p.stats.wins / p.stats.rounds) * 100) : 0

  return (
    <View className="arcade-modal-mask" onClick={onClose}>
      <View className="arcade-modal-card" onClick={(e) => e.stopPropagation()}>
        <View className="modal-header">
          <View className="modal-title">
            <Text>🎯</Text>
            <Text>任务与成就中心</Text>
          </View>
          <View className="modal-close-btn" onClick={onClose}>
            ×
          </View>
        </View>

        <View className="modal-tabs">
          <View
            className={`modal-tab-item ${activeTab === 'daily' ? 'active' : ''}`}
            onClick={() => setActiveTab('daily')}
          >
            每日任务
          </View>
          <View
            className={`modal-tab-item ${activeTab === 'achieve' ? 'active' : ''}`}
            onClick={() => setActiveTab('achieve')}
          >
            荣耀成就
          </View>
        </View>

        <View className="modal-content-scroll">
          <View className="pilot-summary-card">
            <View className="psc-avatar">👾</View>
            <View className="psc-info">
              <Text className="psc-title">{p.title || '弹珠机师'}</Text>
              <Text className="psc-sub">Lv.{Math.max(1, Math.floor(p.stats.rounds / 5) + 1)} · 弹珠堂</Text>
            </View>
            <View className="psc-stats">
              <View className="stat-col">
                <Text className="val">{p.stats.rounds}</Text>
                <Text className="lbl">总局数</Text>
              </View>
              <View className="stat-col">
                <Text className="val">{winRate}%</Text>
                <Text className="lbl">胜率</Text>
              </View>
            </View>
          </View>

          {activeTab === 'daily' && (
            <View className="mission-list">
              {CONFIG.missions.map((m) => {
                const prog = p.dailyMissions[m.id] ?? { progress: 0, claimed: false }
                const isReady = !prog.claimed && prog.progress >= m.target
                const percent = Math.min(100, Math.round((prog.progress / m.target) * 100))

                return (
                  <View key={m.id} className="mission-card">
                    <View className="mc-info">
                      <Text className="mc-name">{m.name}</Text>
                      <Text className="mc-desc">{m.desc}</Text>
                      <View className="mc-bar-wrap">
                        <View className="mc-bar-fill" style={{ width: `${percent}%` }} />
                      </View>
                      <Text className="mc-prog-text">
                        进度: {Math.min(prog.progress, m.target)} / {m.target}
                      </Text>
                    </View>
                    <View className="mc-action">
                      <Text className="mc-rewards">+{m.rewardBalls} 珠</Text>
                      {prog.claimed ? (
                        <View className="mc-claim-btn claimed">已领</View>
                      ) : isReady ? (
                        <View className="mc-claim-btn" onClick={() => handleClaimMission(m.id)}>
                          领取
                        </View>
                      ) : (
                        <View className="mc-claim-btn disabled">未达成</View>
                      )}
                    </View>
                  </View>
                )
              })}
            </View>
          )}

          {activeTab === 'achieve' && (
            <View className="mission-list">
              {CONFIG.achievements.map((a) => {
                const prog = p.achievements[a.id] ?? { progress: 0, claimed: false }
                const isReady = !prog.claimed && prog.progress >= a.target
                const percent = Math.min(100, Math.round((prog.progress / a.target) * 100))

                return (
                  <View key={a.id} className="mission-card">
                    <View className="mc-info">
                      <Text className="mc-name">{a.name}</Text>
                      <Text className="mc-desc">{a.desc}</Text>
                      <View className="mc-bar-wrap">
                        <View className="mc-bar-fill" style={{ width: `${percent}%` }} />
                      </View>
                      <Text className="mc-prog-text">
                        进度: {Math.min(prog.progress, a.target)} / {a.target}
                      </Text>
                    </View>
                    <View className="mc-action">
                      <Text className="mc-rewards">+{a.rewardBalls} 珠</Text>
                      {prog.claimed ? (
                        <View className="mc-claim-btn claimed">已解锁</View>
                      ) : isReady ? (
                        <View className="mc-claim-btn" onClick={() => handleClaimAchievement(a.id)}>
                          领取
                        </View>
                      ) : (
                        <View className="mc-claim-btn disabled">未达成</View>
                      )}
                    </View>
                  </View>
                )
              })}
            </View>
          )}
        </View>

        <View className="modal-footer">
          <View className="modal-btn primary" onClick={onClose}>
            关闭
          </View>
        </View>
      </View>
    </View>
  )
}
