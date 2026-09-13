import { loadImage } from './canvasImage'
import { ensureImageCached } from './imageCache'

const images = new Map<string, Promise<string>>()

// 语言模型只需看图副本；生图、下载和本地存储继续使用原图。
export function getCharacterChatImage(id: string): Promise<string> {
  const cached = images.get(id)
  if (cached) {
    images.delete(id)
    images.set(id, cached)
    return cached
  }
  const pending = (async () => {
    const url = await ensureImageCached(id)
    if (!url) throw new Error('聊天所需的图片已丢失，请重新上传或开启新对话。')
    if (url.length <= 512 * 1024 || url.startsWith('data:image/gif;')) return url
    const img = await loadImage(url)
    const scale = Math.min(1, 1536 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持处理聊天图片。')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const preview = canvas.toDataURL('image/jpeg', 0.85)
    return preview.startsWith('data:image/jpeg;') && preview.length < url.length ? preview : url
  })().catch((err) => {
    images.delete(id)
    throw err
  })
  images.set(id, pending)
  while (images.size > 16) images.delete(images.keys().next().value!)
  return pending
}
