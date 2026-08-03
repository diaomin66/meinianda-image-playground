/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __CANVAS_APP_VERSION__: string
declare const __CANVAS_APP_RELEASES__: import('./infiniteCanvas/lib/release').ReleaseInfo[]
declare const __DEV_PROXY_CONFIG__: unknown

interface ImportMetaEnv {
  readonly VITE_DEFAULT_API_URL?: string
  readonly VITE_API_PROXY_AVAILABLE?: string
  readonly VITE_API_PROXY_LOCKED?: string
  readonly VITE_DOCKER_DEPLOYMENT?: string
  readonly VITE_DOCKER_LEGACY_API_URL_USED?: string
  readonly VITE_SHOW_DEFAULT_CONFIG_ONLY?: string
  readonly VITE_DEV_PLUGINS?: string
  readonly VITE_DOC_URL?: string
  readonly VITE_PLUGIN_REGISTRY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
