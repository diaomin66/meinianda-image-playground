import { useEffect, useState } from 'react'
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, type AppSettings } from '../../types'
import { DEFAULT_RESPONSES_MODEL, normalizeAgentMaxToolRounds } from '../../lib/apiProfiles'
import { FIXED_RESPONSES_PROFILE_ID } from '../../lib/fixedApiProfiles'

interface AgentSettingsTabProps {
  draft: AppSettings
  agentMaxToolRoundsInput: string
  setAgentMaxToolRoundsInput: (value: string) => void
  commitSettings: (nextDraft: AppSettings) => void
  commitAgentMaxToolRounds: () => void
}

export default function AgentSettingsTab({
  draft,
  agentMaxToolRoundsInput,
  setAgentMaxToolRoundsInput,
  commitSettings,
  commitAgentMaxToolRounds,
}: AgentSettingsTabProps) {
  const agentProfile = draft.profiles.find((profile) => profile.id === FIXED_RESPONSES_PROFILE_ID)
  const agentModel = agentProfile?.model || DEFAULT_RESPONSES_MODEL
  const [agentModelInput, setAgentModelInput] = useState(agentModel)

  useEffect(() => {
    setAgentModelInput(agentModel)
  }, [agentModel])

  const commitAgentModel = () => {
    const model = agentModelInput.trim() || DEFAULT_RESPONSES_MODEL
    setAgentModelInput(model)
    commitSettings({
      ...draft,
      profiles: draft.profiles.map((profile) => profile.id === FIXED_RESPONSES_PROFILE_ID ? { ...profile, model } : profile),
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-relaxed text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
        Agent 固定使用语言配置调用 Responses API，并使用生图配置调用 Images API。
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">Agent 模型 ID</span>
        <input
          list="agent-model-presets"
          value={agentModelInput}
          onChange={(e) => setAgentModelInput(e.target.value)}
          onBlur={commitAgentModel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          placeholder={DEFAULT_RESPONSES_MODEL}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
        <datalist id="agent-model-presets">
          <option value={DEFAULT_RESPONSES_MODEL} />
        </datalist>
        <div data-selectable-text className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
          可直接输入服务支持的任意 Responses 模型 ID；默认使用 {DEFAULT_RESPONSES_MODEL}。
        </div>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">最大工具调用轮数</span>
        <input
          value={agentMaxToolRoundsInput}
          onChange={(e) => setAgentMaxToolRoundsInput(e.target.value)}
          onBlur={commitAgentMaxToolRounds}
          type="number"
          min={1}
          max={50}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
        <div data-selectable-text className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
          默认 15。用于限制 Agent 连续调用工具时的最大轮数，防止无限循环。
        </div>
      </label>
      <div className="block">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="block text-sm text-gray-600 dark:text-gray-300">网络搜索</span>
          <button
            type="button"
            onClick={() => {
              const agentMaxToolRounds = agentMaxToolRoundsInput.trim() === ''
                ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
                : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, draft.agentMaxToolRounds)
              setAgentMaxToolRoundsInput(String(agentMaxToolRounds))
              commitSettings({ ...draft, agentMaxToolRounds, agentWebSearch: !draft.agentWebSearch })
            }}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${draft.agentWebSearch ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            role="switch"
            aria-checked={draft.agentWebSearch}
            aria-label="网络搜索"
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.agentWebSearch ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
          </button>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
          启用 Responses API 的 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]">web_search</code> 工具。模型每次调用此工具会产生少量固定价格的额外计费。
        </div>
      </div>
    </div>
  )
}
