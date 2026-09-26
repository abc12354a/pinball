/** 最小 Taro mock（引擎冒烟测试用）：仅覆盖 GameEngine/soundManager 触碰的 API */
const Taro: any = {
  getWindowInfo: () => ({ pixelRatio: 2 }),
  getSystemInfoSync: () => ({ pixelRatio: 2 }),
  vibrateShort: () => {},
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  nextTick: (fn: () => void) => fn(),
  showToast: () => {},
  showModal: () => {},
  createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) })
}
export default Taro
export const { getWindowInfo, getSystemInfoSync, vibrateShort } = Taro
