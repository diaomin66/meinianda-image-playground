import type { CharacterImageOptimizerSettings } from '../types'

export function getCharacterImageFrame(size = '1024x1536') {
  if (size === 'auto') return null
  if (size === '1024x1024') return { size, aspect_ratio: '1:1' } as const
  if (size === '1536x1024') return { size, aspect_ratio: '3:2' } as const
  return { size: '1024x1536', aspect_ratio: '2:3' } as const
}

export function normalizeCharacterImageOptimizer(value: unknown): CharacterImageOptimizerSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    enabled: data.enabled !== false,
    profileId: typeof data.profileId === 'string' ? data.profileId : null,
    model: typeof data.model === 'string' ? data.model.trim() : '',
    // 旧版 follow 没有对应的上游预设，升级为 OmniDraw 默认的手机日常原生感。
    style: data.style === 'selfie' || data.style === 'cinema' || data.style === 'anime' || data.style === 'toy' || data.style === 'custom' ? data.style : 'photo',
    customPrompt: typeof data.customPrompt === 'string' ? data.customPrompt : '',
    timeout: typeof data.timeout === 'number' && Number.isFinite(data.timeout) ? Math.max(5, Math.min(120, data.timeout)) : 45,
  }
}
