import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'

// https://taro-docs.jd.com/docs/compact
export default defineConfig(async (merge) => {
  const baseConfig: UserConfigExport = {
    projectName: 'pinball-hall',
    date: '2026-9-21',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [],
    framework: 'react',
    compiler: {
      type: 'webpack5',
      prebundle: { enable: false }
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false // 默认为 false，如需使用 css modules 功能，则设为 true
        }
      }
    },
    h5: {}
  }

  if (process.env.NODE_ENV === 'development') {
    // 本地开发构建配置（不沿用默认值）
    return merge({}, baseConfig, devConfig)
  }
  // 生产构建配置（不沿用默认值）
  return merge({}, baseConfig, prodConfig)
})
