import { useState } from 'react'
import type { AppSettings } from '../../types'
import {
  FIXED_API_BASE_URL,
  FIXED_GEMINI_API_BASE_URL,
  FIXED_GEMINI_MODELS,
  FIXED_GEMINI_PROFILE_ID,
  FIXED_IMAGE_PROFILE_ID,
  FIXED_RESPONSES_PROFILE_ID,
} from '../../lib/fixedApiProfiles'

interface FixedApiSettingsTabProps {
  draft: AppSettings
  commitSettings: (nextDraft: AppSettings) => void
}

const CONFIGURATIONS = [
  {
    id: FIXED_IMAGE_PROFILE_ID,
    title: '生图配置',
    baseUrl: FIXED_API_BASE_URL,
    endpoint: 'Images API (/v1/images)',
    description: '用于画廊中的图片生成与编辑。',
  },
  {
    id: FIXED_GEMINI_PROFILE_ID,
    title: 'Gemini 生图配置',
    baseUrl: FIXED_GEMINI_API_BASE_URL,
    endpoint: 'Interactions API (/v1beta/interactions)',
    description: `用于画廊 Gemini 生图与编辑，可选 ${FIXED_GEMINI_MODELS.join('、')}。`,
  },
  {
    id: FIXED_RESPONSES_PROFILE_ID,
    title: '语言配置',
    baseUrl: FIXED_API_BASE_URL,
    endpoint: 'Responses API (/v1/responses)',
    description: '用于 Agent 的语言理解与工具调用。',
  },
] as const

export default function FixedApiSettingsTab({ draft, commitSettings }: FixedApiSettingsTabProps) {
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>({})

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-relaxed text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
        服务地址和接口类型已固定；Gemini 模型在画廊参数栏中从两项允许值里选择。API Key 仅保存在当前浏览器中。
      </div>

      {CONFIGURATIONS.map((configuration) => {
        const profile = draft.profiles.find((item) => item.id === configuration.id)
        if (!profile) return null

        const visible = Boolean(visibleApiKeys[configuration.id])

        return (
          <section key={configuration.id} className="rounded-2xl border border-gray-200/70 bg-white/50 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
            <div className="mb-4">
              <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">{configuration.title}</h4>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{configuration.description}</p>
            </div>

            <dl className="mb-4 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500 dark:text-gray-400">API URL</dt>
                <dd><code className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">{configuration.baseUrl}</code></dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500 dark:text-gray-400">接口</dt>
                <dd className="text-right font-medium text-gray-700 dark:text-gray-200">{configuration.endpoint}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500 dark:text-gray-400">模型</dt>
                <dd><code className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">{profile.model}</code></dd>
              </div>
            </dl>

            <label className="block">
              <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API Key</span>
              <div className="relative">
                <input
                  value={profile.apiKey}
                  onChange={(event) => commitSettings({
                    ...draft,
                    profiles: draft.profiles.map((item) => item.id === profile.id ? { ...item, apiKey: event.target.value } : item),
                  })}
                  type={visible ? 'text' : 'password'}
                  placeholder="sk-..."
                  autoComplete="off"
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
                <button
                  type="button"
                  onClick={() => setVisibleApiKeys((current) => ({ ...current, [configuration.id]: !visible }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-200"
                  aria-label={visible ? '隐藏 API Key' : '显示 API Key'}
                >
                  {visible ? '隐藏' : '显示'}
                </button>
              </div>
            </label>
          </section>
        )
      })}
    </div>
  )
}
