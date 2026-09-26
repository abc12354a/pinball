import Taro from '@tarojs/taro'
import { createPlayer, type PlayerState } from './wallet'

/**
 * Taro storage 持久化：读写 + 防抖落盘。
 * 版本迁移：load 时按 version 校验/合并默认值，坏数据回滚到新档。
 */

const KEY = 'pinball:player:v1'
const SAVE_DEBOUNCE_MS = 600

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function loadPlayer(): PlayerState {
  try {
    const raw = Taro.getStorageSync(KEY)
    if (!raw) return createPlayer()
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<PlayerState>
    if (!data || data.version !== 1) return createPlayer()
    const fresh = createPlayer()
    // 剔除已下线字段（V2 删除能量/开心30秒前的旧存档）
    const { energyLamps: _l, energyProgress: _p, ...rest } = data as Record<string, unknown>
    const merged = { ...fresh, ...rest } as PlayerState
    return {
      ...merged,
      cards: { ...(data.cards ?? {}) },
      unlockedSkins: data.unlockedSkins ?? fresh.unlockedSkins,
      activeSkin: data.activeSkin ?? fresh.activeSkin,
      dailyMissions: { ...fresh.dailyMissions, ...(data.dailyMissions ?? {}) },
      achievements: { ...fresh.achievements, ...(data.achievements ?? {}) },
      stats: { ...fresh.stats, ...(data.stats ?? {}) }
    }
  } catch {
    return createPlayer()
  }
}

/** 防抖落盘：高频结算不逐次写 storage */
export function savePlayer(p: PlayerState): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      Taro.setStorageSync(KEY, JSON.stringify(p))
    } catch {
      // storage 满等异常：静默（下局再试）
    }
  }, SAVE_DEBOUNCE_MS)
}

export function flushPlayer(p: PlayerState): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  try {
    Taro.setStorageSync(KEY, JSON.stringify(p))
  } catch {
    // ignore
  }
}

export function clearPlayer(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  try {
    Taro.removeStorageSync(KEY)
  } catch {
    // ignore
  }
}
