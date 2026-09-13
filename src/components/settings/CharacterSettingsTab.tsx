import { useEffect, useState } from 'react'
import type { AppSettings } from '../../types'
import { DEFAULT_GEMINI_TEXT_MODEL, FIXED_RESPONSES_PROFILE_ID } from '../../lib/fixedApiProfiles'
import { DEFAULT_RESPONSES_MODEL } from '../../lib/apiProfiles'
import CharacterImageSettings from './CharacterImageSettings'
import Select from '../Select'

export default function CharacterSettingsTab({
  draft,
  commitSettings,
}: {
  draft: AppSettings
  commitSettings: (next: AppSettings) => void
}) {
  const profile = draft.profiles.find((item) => item.id === (draft.characterTextProfileId || FIXED_RESPONSES_PROFILE_ID))
  const defaultModel = profile?.provider === 'gemini' ? DEFAULT_GEMINI_TEXT_MODEL : DEFAULT_RESPONSES_MODEL
  const [model, setModel] = useState(profile?.model ?? defaultModel)
  useEffect(() => {
    setModel(profile?.model ?? defaultModel)
  }, [profile?.id, profile?.model, defaultModel])
  const fieldClass =
    'mt-2 w-full rounded-2xl border-0 bg-gray-100/80 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-200 dark:bg-white/5 dark:focus:ring-blue-500/30'
  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-blue-50/60 p-5 text-sm leading-7 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
        所有人物共用这里的配置。设置一次，之后就可以直接聊天。密钥在「API 配置」中填写。
      </div>
      <label className="block text-sm text-gray-600 dark:text-gray-300">
        语言接口
        <Select
          ariaLabel="语言接口"
          value={profile?.id ?? FIXED_RESPONSES_PROFILE_ID}
          onChange={(value) => commitSettings({ ...draft, characterTextProfileId: value })}
          className={fieldClass}
          options={draft.profiles.filter((item) => item.apiMode === 'responses' || item.apiMode === 'generateContent').map((item) => ({ value: item.id, label: item.provider === 'gemini' ? 'Gemini 原生' : 'OpenAI Responses' }))}
        />
      </label>
      <label className="block text-sm text-gray-600 dark:text-gray-300">
        聊天模型
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => {
            const value = model.trim() || defaultModel
            setModel(value)
            commitSettings({
              ...draft,
              profiles: draft.profiles.map((item) => (item.id === profile?.id ? { ...item, model: value } : item)),
            })
          }}
          className={fieldClass}
        />
        <span className="mt-2 block text-xs leading-5 text-gray-400">使用支持看图和函数调用的模型。{profile?.provider === 'gemini' ? '通过 Gemini 原生流式接口聊天与调用工具，文字实时显示。' : 'OpenAI 模型配置与 Agent 共用。'}</span>
      </label>
      <label className="block text-sm text-gray-600 dark:text-gray-300">
        默认生图配置
        <Select
          ariaLabel="默认生图配置"
          value={draft.characterImageProfileId ?? ''}
          onChange={(value) => commitSettings({ ...draft, characterImageProfileId: value || null })}
          className={fieldClass}
          options={[{ value: '', label: '默认生图配置' }, ...draft.profiles.filter((item) => item.apiMode === 'images').map((item) => ({ value: item.id, label: `${item.name} · ${item.model}` }))]}
        />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm text-gray-600 dark:text-gray-300">
          生图画幅
          <Select
            ariaLabel="生图画幅"
            value={draft.characterImageSize ?? '1024x1536'}
            onChange={(value) => commitSettings({ ...draft, characterImageSize: value })}
            className={fieldClass}
            options={[{ value: '1024x1536', label: '竖图 · 2:3' }, { value: '1024x1024', label: '方图 · 1:1' }, { value: '1536x1024', label: '横图 · 3:2' }, { value: 'auto', label: '自动' }]}
          />
        </label>
        <label className="block text-sm text-gray-600 dark:text-gray-300">
          图片质量
          <Select
            ariaLabel="图片质量"
            value={draft.characterImageQuality ?? 'medium'}
            onChange={(value) => commitSettings({ ...draft, characterImageQuality: value })}
            className={fieldClass}
            options={[{ value: 'auto', label: '自动' }, { value: 'low', label: '低' }, { value: 'medium', label: '标准' }, { value: 'high', label: '高' }]}
          />
        </label>
      </div>
      <CharacterImageSettings draft={draft} commitSettings={commitSettings} />
      <p className="text-xs leading-6 text-gray-400">
        选择竖图、方图或横图后，新图片按所选画幅生成；选择「自动」时由模型根据对话决定。图片质量作为默认偏好。人格原文仍是聊天唯一的系统提示词，副脑单独使用画面提示词优化。
      </p>
    </div>
  )
}
