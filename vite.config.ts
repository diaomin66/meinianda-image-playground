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

export default defineConfig(({ command }) => {
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
    },
    server: {
      host: true,
      proxy:
        devProxyConfig?.enabled
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
          : undefined,
    },
  }
})
