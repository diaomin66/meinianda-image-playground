import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile } from './apiProfiles'
import {
  DEFAULT_GPT_IMAGE_SIZE,
  GEMINI_FLASH_ASPECT_RATIOS,
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_FLASH_IMAGE_SIZES,
  GEMINI_PRO_IMAGE_SIZES,
  GEMINI_STANDARD_ASPECT_RATIOS,
} from './imageModels'
import { normalizeCodexCliImageSize, normalizeImageSize } from './size'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_OPENAI_OUTPUT_IMAGES = 10
export const MAX_GEMINI_OUTPUT_IMAGES = 10

export function getOutputImageLimitForSettings(settings: AppSettings) {
  const provider = getActiveApiProfile(settings).provider
  if (provider === 'fal') return MAX_FAL_OUTPUT_IMAGES
  if (provider === 'gemini') return MAX_GEMINI_OUTPUT_IMAGES
  return MAX_OPENAI_OUTPUT_IMAGES
}

export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
  options: { hasInputImages?: boolean } = {},
): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const normalizedSize = normalizeImageSize(params.size)
  const nextParams: TaskParams = {
    ...params,
    size: activeProfile.provider === 'openai' && normalizedSize !== 'auto' && !/^\d+x\d+$/.test(normalizedSize)
      ? DEFAULT_GPT_IMAGE_SIZE
      : normalizedSize || DEFAULT_PARAMS.size,
    n: Math.min(outputImageLimit, Math.max(1, params.n || DEFAULT_PARAMS.n)),
  }

  if (activeProfile.provider === 'openai' && activeProfile.codexCli) {
    nextParams.size = normalizeCodexCliImageSize(nextParams.size)
    nextParams.quality = DEFAULT_PARAMS.quality
  }

  if (activeProfile.provider === 'fal') {
    if (!options.hasInputImages && nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  if (activeProfile.provider === 'gemini') {
    const isFlash = activeProfile.model === GEMINI_FLASH_IMAGE_MODEL
    const imageSizes = isFlash ? GEMINI_FLASH_IMAGE_SIZES : GEMINI_PRO_IMAGE_SIZES
    const aspectRatios = isFlash ? GEMINI_FLASH_ASPECT_RATIOS : GEMINI_STANDARD_ASPECT_RATIOS
    if (!imageSizes.some((size) => size === nextParams.size)) nextParams.size = '1K'
    if (!aspectRatios.some((ratio) => ratio === nextParams.aspect_ratio)) nextParams.aspect_ratio = 'auto'
    if (nextParams.output_format === 'webp') nextParams.output_format = 'png'
    nextParams.quality = DEFAULT_PARAMS.quality
    nextParams.background = DEFAULT_PARAMS.background
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
    nextParams.transparent_output = false
  }

  if (nextParams.output_format === 'png') {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  if (nextParams.output_format === 'jpeg') {
    nextParams.background = 'opaque'
  }

  return nextParams
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
