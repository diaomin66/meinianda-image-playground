import { useEffect, useState } from 'react'
import type { AppSettings } from '../../types'
import { normalizeCharacterImageOptimizer } from '../../lib/characterImageSettings'
import Select from '../Select'

export default function CharacterImageSettings({ draft, commitSettings }: { draft: AppSettings; commitSettings: (next: AppSettings) => void }) {
  const config = normalizeCharacterImageOptimizer(draft.characterImageOptimizer)
  const [model, setModel] = useState(config.model)
  const [custom, setCustom] = useState(config.customPrompt)
  useEffect(() => { setModel(config.model) }, [config.model])
  useEffect(() => { setCustom(config.customPrompt) }, [config.customPrompt])
  const fieldClass = 'mt-2 w-full rounded-2xl border-0 bg-gray-100/80 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-200 dark:bg-white/5 dark:focus:ring-blue-500/30'
  return (
    <div className="space-y-5 rounded-3xl bg-blue-50/50 p-5 dark:bg-blue-500/5">
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={draft.characterImageBackground !== false} onChange={(e) => commitSettings({ ...draft, characterImageBackground: e.target.checked })} />
        <span>后台生图<span className="mt-1 block text-xs leading-5 text-gray-400">等待照片时继续聊天，准备好后直接发到对话里。请保持页面打开。</span></span>
      </label>
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={config.enabled} onChange={(e) => commitSettings({ ...draft, characterImageOptimizer: { ...config, enabled: e.target.checked } })} />
        <span>生图副脑<span className="mt-1 block text-xs leading-5 text-gray-400">主 Agent 生成提示词，交给提示词优化副脑处理，再直接生图。每次任务增加一次语言模型请求；失败时回退主 Agent 提示词。</span></span>
      </label>
      {config.enabled && <>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-gray-600 dark:text-gray-300">副脑语言接口
            <Select ariaLabel="副脑语言接口" className={fieldClass} value={config.profileId ?? ''} onChange={(value) => commitSettings({ ...draft, characterImageOptimizer: { ...config, profileId: value || null } })}
              options={[{ value: '', label: '跟随人物聊天接口' }, ...draft.profiles.filter((profile) => profile.apiMode === 'responses' || profile.apiMode === 'generateContent').map((profile) => ({ value: profile.id, label: profile.name }))]}
            />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">副脑模型
            <input className={fieldClass} placeholder="留空则跟随所选接口" value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => commitSettings({ ...draft, characterImageOptimizer: { ...config, model: model.trim() } })} />
          </label>
        </div>
        <label className="block text-sm text-gray-600 dark:text-gray-300">画风偏好
          <Select ariaLabel="画风偏好" className={fieldClass} value={config.style} onChange={(value) => commitSettings({ ...draft, characterImageOptimizer: { ...config, style: value } })}
            options={[{ value: 'photo', label: '手机日常原生感' }, { value: 'selfie', label: '自拍专用极致真实' }, { value: 'cinema', label: '电影级光影大片' }, { value: 'anime', label: '日系插画大师' }, { value: 'toy', label: '3D 潮玩盲盒' }, { value: 'custom', label: '自定义模式' }]}
          />
        </label>
        {config.style === 'custom' && <label className="block text-sm text-gray-600 dark:text-gray-300">自定义画风
          <textarea rows={3} className={fieldClass} value={custom} onChange={(e) => setCustom(e.target.value)} onBlur={() => commitSettings({ ...draft, characterImageOptimizer: { ...config, customPrompt: custom } })} placeholder="描述想要的画面风格、光线与质感" />
        </label>}
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer">更多副脑设置</summary>
          <label className="mt-3 block">等待上限（秒）<input type="number" min={5} max={120} className={fieldClass} value={config.timeout} onChange={(e) => commitSettings({ ...draft, characterImageOptimizer: { ...config, timeout: Math.max(5, Math.min(120, Number(e.target.value) || 45)) } })} /></label>
        </details>
      </>}
    </div>
  )
}
