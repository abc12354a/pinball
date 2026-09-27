# 弹珠堂（pinball-hall）

立式弹珠礼品机的微信小程序数字复刻：拉杆射母球进钉板 → 落入亮灯轨道中奖 → 退珠 = 投注×倍数 → 满 30 珠出积分卡。核心体验 = **续航线**（中奖退珠续玩）+ **收集线**（出卡攒积分）。

技术栈：Taro 4 + React + TypeScript + Canvas 2d，自写轻量物理，本地存储（无后端）。

## 玩法规则（摘要）

- **一局流程**：投珠（5 颗起投，上限 50）→ 按开始摇倍数（2/4/6/8/10× 加权随机）→ 亮灯 + 加注窗口 → 按住画布蓄力、松手发射 → 落道判定 → 结算
- **中奖**：落入亮灯轨道 → 退 `投注 × 倍数` 颗珠（含本金）；未中投注没收
- **出卡**：单次中奖退珠每满 30 颗出 1 张，单局封顶 5 张
- **双模式**：弹珠模式（退珠）⇄ 卡片模式（命中率高 ~3×，直接抽卡不退珠）
- **能量条**：投珠累积，5 盏灯全亮 → 下一局开心 30 秒（免费连发）
- **机器人赛事**：定时轮换拍拍乐（10s 拼手速）/ 拔河（30s 狂按）/ 巅峰对决（30s 免费弹射比命中）/ 幸运座位（随机开奖），假玩家排行榜 + Top3 发奖

**核心设计：概率主导、物理表现** —— 落点在松手瞬间由概率表（W2×力度偏移）抽出，物理动画末段渐进引导到预定轨道，与实体机"看似有技巧、实际概率可控"一致。

## 开发环境（Windows）

1. Node ≥ 16.20（建议 20 LTS）
2. [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 稳定版
3. 依赖：`npm install`

`project.config.json` 已配置 `touristappid`（游客模式，零注册本地开发）。

## 常用命令

```bash
npm run dev:weapp   # 小程序开发构建（watch），产物在 dist/
npm run build:weapp # 小程序生产构建
npm run dev:h5      # 网页版本地调试（watch + dev server）
npm run build:h5    # 网页版生产构建，产物在 dist/web/
npm run test        # jest 单元测试（状态机/结算/物理）
npm run sim         # 蒙特卡洛 RTP 验证（10万局）
npm run dist        # 无引导自然落道分布测量（3000球）
```

开发流程：`npm run dev:weapp` → 微信开发者工具导入项目根目录 → 模拟器/真机预览。

## 网页版（H5）

- 同一套代码编译为网页版：`npm run dev:h5` 后浏览器打开本地 dev server，鼠标与触摸均可操作
- 推送 `main` 分支后，GitHub Actions（`.github/workflows/deploy-web.yml`）自动构建并发布到
  **https://abc12354a.github.io/pinball/**（hash 路由，子路径 `/pinball/` 由 `config/prod.ts` 配置）

## 目录结构

```
src/
  config/config.ts        # ★ 全部数值单一来源（W1/W2/W3、投注、出卡、能量、赛事）
  pages/game/             # 唯一页面：Canvas + HUD
  game/
    core/                 # 纯逻辑：状态机 / 概率(lottery) / RNG（可脱离小程序测试）
    physics/world.ts      # PlinkoWorld：钉板物理 + 末段引导（表现层）
    render/               # board 布局 / renderer / 粒子
    GameEngine.ts         # 粘合层：状态机+物理+渲染+触摸+赛事+主循环
  events/                 # 机器人赛事：调度 / 假玩家 / 4种玩法
  store/                  # 钱包(纯数据) / 持久化 / React 绑定
  components/             # TournamentModal / CardPackModal
scripts/
  simulate.ts             # RTP 验证（各档EV / 总RTP / 分力度 / 采样一致性 / 卡片模式）
  natural-dist.ts         # 自然分布测量 → W2 回填源
```

## 数值调参指南（改 config.ts 后必跑）

| 想调什么 | 改哪里 | 改完跑 |
|---|---|---|
| 倍数出现频率 | `mult.weights`（W1） | `npm run sim` |
| 各轨道落球难度 | `lanes.weights`（W2） | `npm run sim`（看采样一致性 + RTP） |
| 亮灯位置/数量 | `lanes.litPatternByMult`（W3） | `npm run sim`（看各档 EV 与总 RTP） |
| 出卡阈值/封顶 | `card.*` | `npm run test` |
| 开心30秒收益 | `energy.happyNominalBet` / `happyLaneWeights` | `npm run sim`（总 RTP 含免费收益） |
| 赛事节奏 | `events.*` | 手动试玩（把 periodMs 调 1 分钟） |
| 钉板布局/物理 | `game/render/board.ts` | **`npm run dist` 重测自然分布并回填 W2**，再 `npm run sim` |

当前标定（N=100000）：总 RTP ≈ 0.865（目标 0.85±0.03），分力度 RTP 极差 0.03（无"必胜力道"），卡片模式命中 ×2.8。

## 测试覆盖

- 状态机：全环流程、非法转移 throw、能量累积、开心30秒（触发/免费结算/超时）、赛事打断恢复（含 PHYSICS 中断 fast-forward）
- 结算边界：5×8=40→1卡 / 15×10=150→5卡 / 5×4=20→0卡 / 封顶
- 物理：无卡死（300球）、引导正确性（600球落点=目标轨道）
- 赛事：4 种玩法端到端 + 未报名恢复 + 非重复发起

## 合规说明

个人主体小程序不能选"游戏"类目，微信小游戏上线需版号。本项目定位为**个人学习/自娱**（touristappid + 本地存储），请勿以"弹珠礼品机"名义对外发布；若未来要发布需企业主体 + 资质，且博彩式数值表述需重新设计。
