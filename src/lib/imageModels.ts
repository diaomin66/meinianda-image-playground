export const GPT_IMAGE_MODEL = 'gpt-image-2'
export const GEMINI_FLASH_IMAGE_MODEL = 'gemini-3.1-flash-image'
export const GEMINI_PRO_IMAGE_MODEL = 'gemini-3-pro-image'

export const GALLERY_IMAGE_MODELS = [
  GPT_IMAGE_MODEL,
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_PRO_IMAGE_MODEL,
] as const

export type GalleryImageModel = typeof GALLERY_IMAGE_MODELS[number]

export const GEMINI_STANDARD_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const

export const GEMINI_FLASH_ASPECT_RATIOS = [
  ...GEMINI_STANDARD_ASPECT_RATIOS,
  '1:4',
  '1:8',
  '4:1',
  '8:1',
] as const

export const GEMINI_PRO_IMAGE_SIZES = ['1K', '2K', '4K'] as const
export const GEMINI_FLASH_IMAGE_SIZES = ['512px', ...GEMINI_PRO_IMAGE_SIZES] as const
export const GEMINI_MAX_REFERENCE_IMAGES = 14

export function isGalleryImageModel(value: string): value is GalleryImageModel {
  return GALLERY_IMAGE_MODELS.includes(value as GalleryImageModel)
}

export function isGeminiImageModel(value: string) {
  return value === GEMINI_FLASH_IMAGE_MODEL || value === GEMINI_PRO_IMAGE_MODEL
}
