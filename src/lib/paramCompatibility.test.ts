import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { DEFAULT_GPT_IMAGE_SIZE, GPT_IMAGE_25_MODELS, getImageQualityOptions } from './imageModels'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it.each(GPT_IMAGE_25_MODELS)('%s 提供六档质量并保留 4K 和透明输出参数', (model) => {
    const profile = createDefaultOpenAIProfile({ model, apiMode: 'images' })
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    const qualities = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const
    expect(getImageQualityOptions(profile)).toEqual(qualities)
    for (const quality of qualities) {
      for (const size of ['3840x2160', '2160x3840']) {
        for (const background of ['auto', 'opaque', 'transparent'] as const) {
          const params = { ...DEFAULT_PARAMS, quality, size, background }
          expect(normalizeParamsForSettings(params, settings)).toEqual(params)
        }
      }
    }
  })

  it.each(['xhigh', 'max'] as const)('切换模型时将不支持的 %s 降为兼容档位', (quality) => {
    const profiles = [
      createDefaultOpenAIProfile({ model: 'gpt-image-2', apiMode: 'images' }),
      createDefaultOpenAIProfile({ model: 'gpt-5.6-sol', apiMode: 'responses' }),
      createDefaultFalProfile({}),
    ]
    for (const profile of profiles) {
      const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
      expect(getImageQualityOptions(profile)).not.toContain(quality)
      expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality }, settings).quality).toBe('high')
    }
    const cli = createDefaultOpenAIProfile({ model: GPT_IMAGE_25_MODELS[0], codexCli: true })
    const settings = normalizeSettings({ profiles: [cli], activeProfileId: cli.id })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality }, settings).quality).toBe('auto')
  })

  it('JPEG 自动使用不透明背景，PNG 和 WebP 保留原生透明背景', () => {
    const profile = createDefaultOpenAIProfile({ model: GPT_IMAGE_25_MODELS[0], apiMode: 'images' })
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    for (const output_format of ['jpeg', 'png', 'webp'] as const) {
      expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format, background: 'transparent' }, settings).background)
        .toBe(output_format === 'jpeg' ? 'opaque' : 'transparent')
    }
  })

  it('uses one output as the shared image count default', () => {
    expect(DEFAULT_PARAMS.n).toBe(1)
  })

  it('falls back to the 1024x1024 default when an OpenAI profile receives a resolution tier token', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2K' }, settings).size).toBe(DEFAULT_GPT_IMAGE_SIZE)
  })

  it('limits OpenAI output count to 10', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: false })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(10)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(10)
  })

  it('limits fal.ai output count to 4', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(4)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 8 }, settings).n).toBe(4)
  })

  it('keeps OpenAI streaming output count so the request can disable streaming', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, settings).n).toBe(4)
  })

  it('only replaces fal.ai auto size in text-to-image mode', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe('1360x1024')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings, { hasInputImages: true }).size).toBe('auto')
  })

  it('limits Codex CLI custom sizes to 1K while preserving auto', () => {
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', codexCli: true })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [profile],
      activeProfileId: profile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048' }, settings).size).toBe('1024x1024')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe('auto')
  })
})
