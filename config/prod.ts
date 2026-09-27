import type { UserConfigExport } from '@tarojs/cli'

export default {
  mini: {},
  h5: {
    // GitHub Pages 项目页部署在 /pinball/ 子路径下（仓库名）：
    // 资源前缀 + hash 路由 basename（hash 路由免 404.html 处理）
    publicPath: '/pinball/',
    router: {
      mode: 'hash' as const,
      basename: '/pinball'
    }
  }
} satisfies UserConfigExport<'production'>
