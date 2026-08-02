import {
  DEFAULT_API_TIMEOUT,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_RESPONSES_MODEL,
  normalizeSettings,
} from './apiProfiles'
import { DEFAULT_STREAM_PARTIAL_IMAGES, type ApiMode, type ApiProfile, type AppSettings } from '../types'
import {
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_PRO_IMAGE_MODEL,
  isGeminiImageModel,
} from './imageModels'

export const FIXED_API_BASE_URL = 'https://meinianda.top/v1'
export const FIXED_GEMINI_API_BASE_URL = 'https://meinianda.top/v1beta'
export const FIXED_IMAGE_PROFILE_ID = 'fixed-images'
export const FIXED_GEMINI_PROFILE_ID = 'fixed-gemini'
export const FIXED_RESPONSES_PROFILE_ID = 'fixed-responses'

function getProfileApiKey(profiles: ApiProfile[], id: string, mode: ApiMode) {
  const exactProfile = profiles.find((profile) => profile.id === id)
  if (exactProfile) return exactProfile.apiKey
  return profiles.find((profile) => profile.apiMode === mode)?.apiKey
}

export function lockApiSettings(input: Partial<AppSettings> | unknown): AppSettings {
  const settings = normalizeSettings(input)
  const imageApiKey = getProfileApiKey(settings.profiles, FIXED_IMAGE_PROFILE_ID, 'images') ?? settings.apiKey
  const existingGeminiProfile = settings.profiles.find((profile) => profile.id === FIXED_GEMINI_PROFILE_ID)
  const geminiApiKey = existingGeminiProfile?.apiKey ?? settings.profiles.find((profile) => profile.provider === 'gemini')?.apiKey ?? imageApiKey
  const geminiModel = existingGeminiProfile && isGeminiImageModel(existingGeminiProfile.model)
    ? existingGeminiProfile.model
    : GEMINI_FLASH_IMAGE_MODEL
  const responsesApiKey = getProfileApiKey(settings.profiles, FIXED_RESPONSES_PROFILE_ID, 'responses') ?? imageApiKey
  const activeProfileId = settings.activeProfileId === FIXED_GEMINI_PROFILE_ID
    ? FIXED_GEMINI_PROFILE_ID
    : FIXED_IMAGE_PROFILE_ID
  const profiles: ApiProfile[] = [
    {
      id: FIXED_IMAGE_PROFILE_ID,
      name: '生图',
      provider: 'openai',
      baseUrl: FIXED_API_BASE_URL,
      apiKey: imageApiKey,
      model: DEFAULT_IMAGES_MODEL,
      timeout: DEFAULT_API_TIMEOUT,
      apiMode: 'images',
      codexCli: false,
      apiProxy: false,
      streamImages: false,
      streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    },
    {
      id: FIXED_GEMINI_PROFILE_ID,
      name: 'Gemini 生图',
      provider: 'gemini',
      baseUrl: FIXED_GEMINI_API_BASE_URL,
      apiKey: geminiApiKey,
      model: geminiModel,
      timeout: DEFAULT_API_TIMEOUT,
      apiMode: 'images',
      codexCli: false,
      apiProxy: false,
      streamImages: false,
      streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    },
    {
      id: FIXED_RESPONSES_PROFILE_ID,
      name: '语言',
      provider: 'openai',
      baseUrl: FIXED_API_BASE_URL,
      apiKey: responsesApiKey,
      model: DEFAULT_RESPONSES_MODEL,
      timeout: DEFAULT_API_TIMEOUT,
      apiMode: 'responses',
      codexCli: false,
      apiProxy: false,
      streamImages: true,
      streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    },
  ]

  return normalizeSettings({
    ...settings,
    baseUrl: FIXED_API_BASE_URL,
    apiKey: imageApiKey,
    model: DEFAULT_IMAGES_MODEL,
    timeout: DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    streamImages: false,
    streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    customProviders: [],
    providerOrder: undefined,
    agentApiConfigMode: 'hybrid',
    agentTextProfileId: FIXED_RESPONSES_PROFILE_ID,
    agentImageProfileId: FIXED_IMAGE_PROFILE_ID,
    profiles,
    activeProfileId,
  })
}

export const FIXED_GEMINI_MODELS = [
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_PRO_IMAGE_MODEL,
] as const
