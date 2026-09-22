import { useEffect, useReducer } from 'react'
import { useSyncExternalStore } from 'react'
import { View, Text } from '@tarojs/components'
import type { TournamentRunner, TournamentSnapshot } from '../events/tournaments'
import './TournamentModal.scss'

const GAME_DESC: Record<string, string> = {
  paipai: '10 秒拼手速！狂点按钮拍打，全场实时排名',
  tug: '30 秒拔河！点得越快绳越往我方拉',
  duel: '30 秒免费弹射！按住钉板蓄力，命中亮灯道计分',
  lucky: '幸运座位开奖中…全场随机抽取幸运机位'
}

function Board({ snap }: { snap: TournamentSnapshot }) {
  return (
    <View className="tm-board">
      {snap.board.slice(0, 5).map((e, i) => (
        <View key={e.name} className={`tm-row ${e.isPlayer ? 'me' : ''}`}>
          <Text className="tm-rank">{i + 1}</Text>
          <Text className="tm-name">{e.name}</Text>
          <Text className="tm-score">{e.score}</Text>
        </View>
      ))}
    </View>
  )
}

export default function TournamentModal({ runner }: { runner: TournamentRunner }) {
  const snap = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot)
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  // 倒计时秒级刷新（快照只在事件时提交）
  const live = snap.state === 'invite' || snap.state === 'playing'
  useEffect(() => {
    if (!live) return
    const id = setInterval(forceUpdate, 250)
    return () => clearInterval(id)
  }, [live])

  if (snap.state === 'idle') return null
  const sec = Math.ceil(snap.leftMs / 1000)

  if (snap.state === 'invite') {
    return (
      <View className="tm-mask">
        <View className="tm-card">
          <View className="tm-title">🏅 全场赛事 · {snap.name}</View>
          <View className="tm-desc">{GAME_DESC[snap.id]}</View>
          <View className="tm-countdown">{sec}s 后开赛</View>
          <View className="tm-btn primary" onClick={() => runner.join()}>
            立即报名
          </View>
          <View className="tm-skip">不报名将自动继续游戏</View>
        </View>
      </View>
    )
  }

  if (snap.state === 'playing') {
    return (
      <View className={`tm-sheet ${snap.id === 'duel' ? 'duel' : ''}`}>
        <View className="tm-sheet-head">
          <Text className="tm-title sm">{snap.name}</Text>
          <Text className="tm-countdown">{sec}s</Text>
          <Text className="tm-score-num">
            {snap.id === 'duel' ? `命中 ${snap.score}` : snap.id === 'lucky' ? '开奖中…' : snap.score}
          </Text>
        </View>
        {(snap.id === 'paipai' || snap.id === 'tug') && (
          <View
            className="tm-tapzone"
            onTouchStart={() => runner.tap()}
          >
            拍！
          </View>
        )}
        {snap.id === 'duel' && <View className="tm-desc sm">{GAME_DESC.duel}</View>}
        {snap.id === 'lucky' && (
          <View className="tm-desc sm">
            我的座位：{snap.playerSeat} 号 · 开奖座位即将揭晓…
          </View>
        )}
        {snap.id !== 'lucky' && <Board snap={snap} />}
      </View>
    )
  }

  // result
  return (
    <View className="tm-mask">
      <View className="tm-card">
        <View className="tm-title">{snap.result?.rank === 1 ? '🏆 ' : '🏅 '}{snap.name} · 结算</View>
        <View className="tm-result-text">{snap.result?.rewardText}</View>
        <Board snap={snap} />
        <View className="tm-btn primary" onClick={() => runner.close()}>
          收下奖励
        </View>
      </View>
    </View>
  )
}
