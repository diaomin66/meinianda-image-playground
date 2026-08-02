import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGES_MODEL, DEFAULT_RESPONSES_MODEL } from './apiProfiles'
import {
  FIXED_API_BASE_URL,
  FIXED_IMAGE_PROFILE_ID,
  FIXED_RESPONSES_PROFILE_ID,
  lockApiSettings,
} from './fixedApiProfiles'

describe('locked API settings', () => {
  it('keeps only the two fixed profiles while preserving their API keys', () => {
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

    expect(settings.profiles.map((profile) => profile.apiKey)).toEqual(['shared-key', 'shared-key'])
  })
})
