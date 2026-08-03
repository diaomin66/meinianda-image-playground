import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGES_MODEL, DEFAULT_RESPONSES_MODEL } from './apiProfiles'
import {
  FIXED_API_BASE_URL,
  FIXED_GEMINI_API_BASE_URL,
  FIXED_GEMINI_PROFILE_ID,
  FIXED_IMAGE_PROFILE_ID,
  FIXED_RESPONSES_PROFILE_ID,
  lockApiSettings,
} from './fixedApiProfiles'
import { GEMINI_FLASH_IMAGE_MODEL, GEMINI_PRO_IMAGE_MODEL } from './imageModels'

describe('locked API settings', () => {
  it('keeps only the three fixed profiles while preserving their API keys', () => {
    const settings = lockApiSettings({
      profiles: [
        {
          id: 'legacy-images',
          name: 'Legacy images',
          provider: 'fal',
          baseUrl: 'https://example.com/v1',
          apiKey: 'image-key',
          model: 'custom-image',
          timeout: 30,
          apiMode: 'images',
          codexCli: true,
          apiProxy: true,
        },
        {
          id: 'legacy-responses',
          name: 'Legacy responses',
          provider: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'language-key',
          model: 'custom-language',
          timeout: 30,
          apiMode: 'responses',
          codexCli: true,
          apiProxy: true,
        },
      ],
    })

    expect(settings.profiles).toEqual([
      expect.objectContaining({
        id: FIXED_IMAGE_PROFILE_ID,
        name: '生图',
        baseUrl: FIXED_API_BASE_URL,
        apiKey: 'image-key',
        model: DEFAULT_IMAGES_MODEL,
        apiMode: 'images',
      }),
      expect.objectContaining({
        id: FIXED_GEMINI_PROFILE_ID,
        name: 'Gemini 生图',
        provider: 'gemini',
        baseUrl: FIXED_GEMINI_API_BASE_URL,
        apiKey: 'image-key',
        model: GEMINI_FLASH_IMAGE_MODEL,
        apiMode: 'images',
      }),
      expect.objectContaining({
        id: FIXED_RESPONSES_PROFILE_ID,
        name: '语言',
        baseUrl: FIXED_API_BASE_URL,
        apiKey: 'language-key',
        model: DEFAULT_RESPONSES_MODEL,
        apiMode: 'responses',
      }),
    ])
    expect(settings.activeProfileId).toBe(FIXED_IMAGE_PROFILE_ID)
    expect(settings.agentApiConfigMode).toBe('hybrid')
    expect(settings.agentTextProfileId).toBe(FIXED_RESPONSES_PROFILE_ID)
    expect(settings.agentImageProfileId).toBe(FIXED_IMAGE_PROFILE_ID)
  })

  it('uses the existing key for both fixed profiles during a one-profile migration', () => {
    const settings = lockApiSettings({ apiKey: 'shared-key' })

    expect(settings.profiles.map((profile) => profile.apiKey)).toEqual(['shared-key', 'shared-key', 'shared-key'])
  })

  it('preserves a nonempty selected Agent model on the fixed Responses profile', () => {
    const settings = lockApiSettings({
      profiles: [
        {
          id: FIXED_RESPONSES_PROFILE_ID,
          name: 'Language',
          provider: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'language-key',
          model: 'custom-responses-model',
          timeout: 30,
          apiMode: 'responses',
          codexCli: false,
          apiProxy: false,
        },
      ],
    })

    expect(settings.profiles.find((profile) => profile.id === FIXED_RESPONSES_PROFILE_ID)).toMatchObject({
      apiKey: 'language-key',
      model: 'custom-responses-model',
      baseUrl: FIXED_API_BASE_URL,
      apiMode: 'responses',
    })
  })

  it('falls back to the default Agent model when the fixed Responses model is blank', () => {
    const settings = lockApiSettings({
      profiles: [
        {
          id: FIXED_RESPONSES_PROFILE_ID,
          name: 'Language',
          provider: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'language-key',
          model: '   ',
          timeout: 30,
          apiMode: 'responses',
          codexCli: false,
          apiProxy: false,
        },
      ],
    })

    expect(settings.profiles.find((profile) => profile.id === FIXED_RESPONSES_PROFILE_ID)?.model).toBe(DEFAULT_RESPONSES_MODEL)
  })

  it('preserves the selected Gemini model and active gallery profile', () => {
    const settings = lockApiSettings({
      activeProfileId: FIXED_GEMINI_PROFILE_ID,
      profiles: [
        {
          id: FIXED_GEMINI_PROFILE_ID,
          name: 'Gemini',
          provider: 'gemini',
          baseUrl: 'https://example.com/v1beta',
          apiKey: 'gemini-key',
          model: GEMINI_PRO_IMAGE_MODEL,
          timeout: 30,
          apiMode: 'images',
          codexCli: true,
          apiProxy: true,
        },
      ],
    })

    expect(settings.activeProfileId).toBe(FIXED_GEMINI_PROFILE_ID)
    expect(settings.profiles.find((profile) => profile.id === FIXED_GEMINI_PROFILE_ID)).toMatchObject({
      apiKey: 'gemini-key',
      model: GEMINI_PRO_IMAGE_MODEL,
      baseUrl: FIXED_GEMINI_API_BASE_URL,
      codexCli: false,
      apiProxy: false,
    })
  })
})
