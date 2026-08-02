import type { ApiProfile, TaskParams } from '../../types'
import { dismissAllTooltips } from '../../lib/tooltipDismiss'
import {
  GEMINI_FLASH_IMAGE_MODEL,
  GALLERY_IMAGE_MODELS,
  type GalleryImageModel,
} from '../../lib/imageModels'
import Select from '../Select'
import ButtonTooltip from './buttonTooltip'

interface HintTooltipState {
  visible: boolean
  show: () => void
  hide: () => void
  clearTimer: () => void
  startTouch: () => void
}

interface InputParamsPanelProps {
  layout: string
  params: TaskParams
  setParams: (patch: Partial<TaskParams>) => void
  activeProfile: ApiProfile
  showModelSelector: boolean
  selectedModel: GalleryImageModel
  onModelChange: (model: GalleryImageModel) => void
  isGeminiProvider: boolean
  isFalProvider: boolean
  isFalTextToImage: boolean
  displaySize: string
  qualityOptions: Array<{ label: string; value: string }>
  selectClass: string
  compressionHint: HintTooltipState
  compressionDisabled: boolean
  outputCompressionInput: string
  setOutputCompressionInput: (value: string) => void
  commitOutputCompression: () => void
  moderationHint: HintTooltipState
  moderationDisabled: boolean
  agentAutoImageCount: boolean
  outputImageLimit: number
  nInput: string
  setNInputFocused: (focused: boolean) => void
  commitN: () => void
  handleNInputChange: (value: string) => void
  handleNLimitIncreaseAttempt: (preventDefault: () => void) => void
  showAgentNHint: () => void
  hideNLimitHint: () => void
  startAgentNHintTouch: () => void
  clearAgentNHintTouchTimer: () => void
  nLimitHint: HintTooltipState
  nLimitHintText: string
  streamConcurrentByN: boolean
  streamConcurrentHint: HintTooltipState
  sizeHint: HintTooltipState
  qualityHint: HintTooltipState
  onOpenSizePicker: () => void
}

const MODEL_OPTIONS = GALLERY_IMAGE_MODELS.map((model) => ({ label: model, value: model }))

export default function InputParamsPanel({
  layout,
  params,
  setParams,
  activeProfile,
  showModelSelector,
  selectedModel,
  onModelChange,
  isGeminiProvider,
  isFalProvider,
  isFalTextToImage,
  displaySize,
  qualityOptions,
  selectClass,
  compressionHint,
  compressionDisabled,
  outputCompressionInput,
  setOutputCompressionInput,
  commitOutputCompression,
  moderationHint,
  moderationDisabled,
  agentAutoImageCount,
  outputImageLimit,
  nInput,
  setNInputFocused,
  commitN,
  handleNInputChange,
  handleNLimitIncreaseAttempt,
  showAgentNHint,
  hideNLimitHint,
  startAgentNHintTouch,
  clearAgentNHintTouchTimer,
  nLimitHint,
  nLimitHintText,
  streamConcurrentByN,
  streamConcurrentHint,
  sizeHint,
  qualityHint,
  onOpenSizePicker,
}: InputParamsPanelProps) {
  const isGeminiFlash = selectedModel === GEMINI_FLASH_IMAGE_MODEL

  const modelControl = showModelSelector ? (
    <label className="col-span-2 flex min-w-0 flex-col gap-0.5">
      <span className="ml-1 text-gray-400 dark:text-gray-500">模型</span>
      <Select
        value={selectedModel}
        onChange={(value) => onModelChange(value as GalleryImageModel)}
        options={MODEL_OPTIONS}
        showValueTooltips
        fitContent
        className={`${selectClass} whitespace-nowrap`}
      />
    </label>
  ) : null

  const sizeControl = (
    <label
      className="relative flex w-fit min-w-0 flex-col gap-0.5"
      onMouseEnter={sizeHint.show}
      onMouseLeave={sizeHint.hide}
      onTouchStart={sizeHint.startTouch}
      onTouchEnd={sizeHint.clearTimer}
      onTouchCancel={sizeHint.hide}
      onClick={sizeHint.show}
    >
      <span className="ml-1 text-gray-400 dark:text-gray-500">尺寸</span>
      <button
        type="button"
        onClick={() => { dismissAllTooltips(); onOpenSizePicker() }}
        className="min-w-24 whitespace-nowrap rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-left font-mono text-xs shadow-sm transition-all duration-200 hover:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
      >
        {displaySize}
      </button>
      <ButtonTooltip
        visible={!isGeminiProvider && (isFalTextToImage || activeProfile.codexCli) && sizeHint.visible}
        text={isFalTextToImage
          ? <>fal.ai 的文生图模式不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 参数</>
          : 'Codex CLI 不支持尺寸参数，此处设置仅基于提示词工程'}
      />
    </label>
  )

  const quantityControl = (
    <label
      className="relative flex w-fit flex-col gap-0.5"
      onMouseEnter={() => { showAgentNHint(); streamConcurrentHint.show() }}
      onMouseLeave={() => { hideNLimitHint(); streamConcurrentHint.hide() }}
      onTouchStart={() => { startAgentNHintTouch(); streamConcurrentHint.startTouch() }}
      onTouchEnd={() => { clearAgentNHintTouchTimer(); streamConcurrentHint.clearTimer() }}
      onTouchCancel={() => {
        clearAgentNHintTouchTimer()
        hideNLimitHint()
        streamConcurrentHint.hide()
      }}
      onClick={() => { showAgentNHint(); streamConcurrentHint.show() }}
    >
      <span className="ml-1 text-gray-400 dark:text-gray-500">数量</span>
      <input
        value={nInput}
        onChange={(event) => handleNInputChange(event.target.value)}
        onFocus={() => setNInputFocused(true)}
        onBlur={() => {
          setNInputFocused(false)
          commitN()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') handleNLimitIncreaseAttempt(() => event.preventDefault())
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) handleNLimitIncreaseAttempt(() => event.preventDefault())
        }}
        disabled={agentAutoImageCount}
        type={agentAutoImageCount ? 'text' : 'number'}
        min={agentAutoImageCount ? undefined : 1}
        max={agentAutoImageCount ? undefined : outputImageLimit}
        className={`min-w-24 rounded-xl border border-gray-200/60 px-3 py-1.5 text-xs shadow-sm outline-none transition-all duration-200 dark:border-white/[0.08] ${
          agentAutoImageCount
            ? 'cursor-not-allowed bg-gray-100/50 opacity-50 dark:bg-white/[0.05]'
            : 'bg-white/50 dark:bg-white/[0.03]'
        }`}
      />
      <ButtonTooltip visible={nLimitHint.visible} text={nLimitHintText} />
      <ButtonTooltip
        visible={streamConcurrentByN && streamConcurrentHint.visible && !nLimitHint.visible}
        text={isGeminiProvider ? 'Gemini 数量大于 1 时会并发提交多个独立请求' : '数量大于 1 时会将多图生成拆分为并发单图'}
      />
    </label>
  )

  if (isGeminiProvider) {
    return (
      <div className={`${layout} flex-1 gap-2 text-xs`}>
        {modelControl}
        {sizeControl}
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="ml-1 text-gray-400 dark:text-gray-500">格式</span>
          <Select
            value={params.output_format}
            onChange={(value) => setParams({
              output_format: value as TaskParams['output_format'],
              output_compression: null,
              background: 'auto',
              transparent_output: false,
            })}
            options={[
              { label: 'PNG', value: 'png' },
              { label: 'JPEG', value: 'jpeg' },
            ]}
            showValueTooltips={false}
            fitContent
            className={selectClass}
          />
        </label>
        {isGeminiFlash && (
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="ml-1 text-gray-400 dark:text-gray-500">思考</span>
            <Select
              value={params.thinking_level}
              onChange={(value) => setParams({ thinking_level: value as TaskParams['thinking_level'] })}
              options={[
                { label: 'minimal', value: 'minimal' },
                { label: 'high', value: 'high' },
              ]}
              showValueTooltips={false}
              fitContent
              className={selectClass}
            />
          </label>
        )}
        {quantityControl}
      </div>
    )
  }

  return (
    <div className={`${layout} flex-1 gap-2 text-xs`}>
      {modelControl}
      {sizeControl}
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={qualityHint.show}
        onMouseLeave={qualityHint.hide}
        onTouchStart={qualityHint.startTouch}
        onTouchEnd={qualityHint.clearTimer}
        onTouchCancel={qualityHint.hide}
        onClick={qualityHint.show}
      >
        <span className="ml-1 text-gray-400 dark:text-gray-500">质量</span>
        <Select
          value={activeProfile.codexCli ? 'auto' : isFalProvider && params.quality === 'auto' ? 'high' : params.quality}
          onChange={(value) => {
            if (!activeProfile.codexCli) setParams({ quality: value as TaskParams['quality'] })
          }}
          options={qualityOptions}
          disabled={activeProfile.codexCli}
          showValueTooltips={false}
          fitContent
          className={activeProfile.codexCli
            ? 'cursor-not-allowed rounded-xl border border-gray-200/60 bg-gray-100/50 px-3 py-1.5 text-xs opacity-50 shadow-sm transition-all duration-200 dark:border-white/[0.08] dark:bg-white/[0.05]'
            : selectClass}
        />
        <ButtonTooltip
          visible={(activeProfile.codexCli || isFalProvider) && qualityHint.visible}
          text={isFalProvider ? <>fal.ai 不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 质量参数</> : 'Codex CLI 不支持质量参数'}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="ml-1 text-gray-400 dark:text-gray-500">格式</span>
        <Select
          value={params.output_format}
          onChange={(value) => setParams({
            output_format: value as TaskParams['output_format'],
            ...(value === 'png' ? { output_compression: null } : {}),
            ...(value === 'jpeg' ? { background: 'opaque' as const, transparent_output: false } : {}),
          })}
          options={[
            { label: 'PNG', value: 'png' },
            { label: 'JPEG', value: 'jpeg' },
            { label: 'WebP', value: 'webp' },
          ]}
          showValueTooltips={false}
          fitContent
          className={selectClass}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="ml-1 text-gray-400 dark:text-gray-500">背景</span>
        <Select
          value={params.output_format === 'jpeg' ? 'opaque' : params.background}
          onChange={(value) => {
            if (params.output_format !== 'jpeg') setParams({ background: value as TaskParams['background'] })
          }}
          options={[
            { label: 'auto', value: 'auto' },
            { label: 'opaque', value: 'opaque' },
            { label: 'transparent', value: 'transparent' },
          ]}
          disabled={params.output_format === 'jpeg'}
          showValueTooltips={false}
          fitContent
          className={params.output_format === 'jpeg'
            ? 'cursor-not-allowed rounded-xl border border-gray-200/60 bg-gray-100/50 px-3 py-1.5 text-xs opacity-50 shadow-sm transition-all duration-200 dark:border-white/[0.08] dark:bg-white/[0.05]'
            : selectClass}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={compressionHint.show}
        onMouseLeave={compressionHint.hide}
        onTouchStart={compressionHint.startTouch}
        onTouchEnd={compressionHint.clearTimer}
        onTouchCancel={compressionHint.hide}
        onClick={compressionHint.show}
      >
        <span className="ml-1 text-gray-400 dark:text-gray-500">压缩率</span>
        <input
          value={outputCompressionInput}
          onChange={(event) => setOutputCompressionInput(event.target.value)}
          onBlur={commitOutputCompression}
          disabled={compressionDisabled}
          type="number"
          min={0}
          max={100}
          placeholder="0-100"
          className={`min-w-24 rounded-xl border border-gray-200/60 px-3 py-1.5 text-xs shadow-sm outline-none transition-all duration-200 dark:border-white/[0.08] ${
            compressionDisabled
              ? 'cursor-not-allowed bg-gray-100/50 opacity-50 dark:bg-white/[0.05]'
              : 'bg-white/50 dark:bg-white/[0.03]'
          }`}
        />
        <ButtonTooltip
          visible={compressionHint.visible}
          text={isFalProvider ? 'fal.ai 不支持压缩率参数' : '仅 JPEG 和 WebP 支持压缩率'}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={moderationHint.show}
        onMouseLeave={moderationHint.hide}
        onTouchStart={moderationHint.startTouch}
        onTouchEnd={moderationHint.clearTimer}
        onTouchCancel={moderationHint.hide}
        onClick={moderationHint.show}
      >
        <span className="ml-1 text-gray-400 dark:text-gray-500">审核</span>
        <Select
          value={moderationDisabled ? 'auto' : params.moderation}
          onChange={(value) => {
            if (!moderationDisabled) setParams({ moderation: value as TaskParams['moderation'] })
          }}
          options={[
            { label: 'auto', value: 'auto' },
            { label: 'low', value: 'low' },
          ]}
          disabled={moderationDisabled}
          showValueTooltips={false}
          fitContent
          className={moderationDisabled
            ? 'cursor-not-allowed rounded-xl border border-gray-200/60 bg-gray-100/50 px-3 py-1.5 text-xs opacity-50 shadow-sm transition-all duration-200 dark:border-white/[0.08] dark:bg-white/[0.05]'
            : selectClass}
        />
        <ButtonTooltip visible={moderationDisabled && moderationHint.visible} text="fal.ai 不支持审核参数" />
      </label>
      {quantityControl}
    </div>
  )
}
