import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { normalizeDevProxyConfig } from './src/lib/devProxy'
import { parseChangelog } from './src/infiniteCanvas/lib/release'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const canvasVersion = readFileSync('./src/infiniteCanvas/VERSION', 'utf-8').trim()
const canvasReleases = parseChangelog(readFileSync('./src/infiniteCanvas/CHANGELOG.md', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command, mode }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [react()],
    base: './',
    resolve: {
      alias: {
        '@canvas': resolve(__dirname, 'src/infiniteCanvas'),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __CANVAS_APP_VERSION__: JSON.stringify(canvasVersion),
      __CANVAS_APP_RELEASES__: JSON.stringify(canvasReleases),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
      __LOCAL_API_RELAY__: command === 'serve' && mode !== 'test',
    },
    server: {
      host: true,
      proxy: {
        // 本地同源转发固定服务商，保留 v1/v1beta；不开放任意目标地址，也不重试生成请求。
        '/__local-api': {
          target: 'https://meinianda.top',
          changeOrigin: true,
          secure: true,
          timeout: 600000,
          proxyTimeout: 600000,
          rewrite: (path) => path.replace(/^\/__local-api(?=\/)/, ''),
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              if (!('writeHead' in res) || res.writableEnded) return
              if (res.headersSent) { res.destroy(); return }
              res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
              res.end(JSON.stringify({ error: { message: '本地转发未能收到服务商的完整响应；服务端可能仍在处理，请先核对后台结果再重试。', code: (err as NodeJS.ErrnoException).code || 'UPSTREAM_CONNECTION_ERROR' } }))
            })
            // 上游已返回 200 后断流也必须结束本地响应，避免浏览器一直等到超时。
            proxy.on('proxyRes', (upstream, _req, res) => {
              upstream.on('aborted', () => res.destroy())
              upstream.on('error', () => res.destroy())
            })
          },
        },
        ...(devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : {}),
      },
    },
  }
})
