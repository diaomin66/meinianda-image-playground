// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCharacterChatImage } from './characterChatImages'
import { loadImage } from './canvasImage'
import { ensureImageCached } from './imageCache'

vi.mock('./canvasImage', () => ({ loadImage: vi.fn() }))
vi.mock('./imageCache', () => ({ ensureImageCached: vi.fn() }))

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('人物语言请求的看图副本', () => {
  it('小图原样传递，连续读取复用缓存，不重复加载图片', async () => {
    const url = 'data:image/png;base64,c21hbGw='
    vi.mocked(ensureImageCached).mockResolvedValue(url)
    expect(await getCharacterChatImage('small')).toBe(url)
    expect(await getCharacterChatImage('small')).toBe(url)
    expect(ensureImageCached).toHaveBeenCalledOnce()
    expect(loadImage).not.toHaveBeenCalled()
  })

  it('大参考图按原比例缩小并压缩，缓存并发处理结果，原始数据保持不变', async () => {
    const original = 'data:image/png;base64,' + 'A'.repeat(800000)
    const preview = 'data:image/jpeg;base64,cHJldmlldw=='
    vi.mocked(ensureImageCached).mockResolvedValue(original)
    vi.mocked(loadImage).mockResolvedValue({ naturalWidth: 3072, naturalHeight: 5624 } as HTMLImageElement)
    const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn(() => preview) }
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
    expect(await Promise.all([getCharacterChatImage('large'), getCharacterChatImage('large')])).toEqual([preview, preview])
    expect(ensureImageCached).toHaveBeenCalledOnce()
    expect(loadImage).toHaveBeenCalledOnce()
    expect(loadImage).toHaveBeenCalledWith(original)
    expect(canvas.height).toBe(1536)
    expect(canvas.width / canvas.height).toBeCloseTo(3072 / 5624, 3)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, canvas.width, canvas.height)
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85)
    expect(await ensureImageCached('large')).toBe(original)
  })

  it('保留 GIF 动画，图片丢失后可重新上传重试', async () => {
    const gif = 'data:image/gif;base64,' + 'A'.repeat(800000)
    vi.mocked(ensureImageCached).mockResolvedValueOnce(gif).mockResolvedValueOnce(undefined).mockResolvedValueOnce('data:image/png;base64,cmV0cnk=')
    expect(await getCharacterChatImage('gif')).toBe(gif)
    expect(loadImage).not.toHaveBeenCalled()
    await expect(getCharacterChatImage('missing')).rejects.toThrow('丢失')
    expect(await getCharacterChatImage('missing')).toBe('data:image/png;base64,cmV0cnk=')
  })
})
