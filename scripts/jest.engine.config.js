/** 引擎冒烟测试专用 jest 配置：mock @tarojs/taro（node 下缺 webpack 常量） */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/scripts/engine-smoke.test.ts'],
  moduleNameMapper: {
    '^@tarojs/taro$': '<rootDir>/taro-mock.ts'
  },
  clearMocks: true
}
