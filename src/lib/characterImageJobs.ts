import { nanoid } from 'nanoid'
import type { AppSettings, CharacterImageJob, CharacterImageRequest } from '../types'
import { saveCharacters, useCharacterStore } from '../characterStore'
import { executeCharacterImage } from './characterImageTool'
import { optimizeCharacterImages } from './characterImageOptimizer'
import { characterImageJobSummary, isCharacterImageJobActive } from './characterImageJobState'
import { ensureImageCached } from './imageCache'
import { getDataUrlDecodedByteSize } from './imageApiShared'
import { normalizeCharacterImageOptimizer } from './characterImageSettings'
import { recordCharacterLog, updateCharacterLog } from './characterLogs'

const controllers = new Map<string, AbortController>()
const queue: Array<() => void> = []
let running = 0

export function getCharacterImageJobs(conversationId: string) {
  return useCharacterStore.getState().conversations.find((convo) => convo.id === conversationId)?.messages.flatMap((msg) => msg.imageJobs ?? []) ?? []
}

export function cancelCharacterImageJob(jobId: string) {
  controllers.get(jobId)?.abort()
}

export const characterImageStatusTool = {
  type: 'function', name: 'image_task_status', strict: true,
  description: '只读查询当前对话的图片任务进度和真实结果。taskId 为空查询最近任务；detail=true 包含实际提示词和参数。无需重复调用 generate_image 查询进度。',
  parameters: { type: 'object', additionalProperties: false, properties: { taskId: { type: 'string' }, detail: { type: 'boolean' } }, required: ['taskId', 'detail'] },
}

export function readCharacterImageTaskStatus(conversationId: string, args: unknown) {
  const value = typeof args === 'string' ? JSON.parse(args) : args
  if (!value || typeof value.taskId !== 'string' || typeof value.detail !== 'boolean') throw new Error('查询需要 taskId 字符串及 detail 布尔值。')
  const jobs = getCharacterImageJobs(conversationId)
  const selected = value.taskId ? jobs.filter((job) => job.id === value.taskId) : jobs.slice(-8)
  if (value.taskId && !selected.length) throw new Error('当前对话中没有此图片任务。')
  return { success: true, tasks: selected.map((job) => characterImageJobSummary(job, value.detail)) }
}

export async function enqueueCharacterImageJob(opts: {
  conversationId: string
  messageId: string
  callKey: string
  request: CharacterImageRequest
  settings: AppSettings
  onSettled: () => void
  retryId?: string
  notify?: boolean
}) {
  const messages = useCharacterStore.getState().conversations.find((convo) => convo.id === opts.conversationId)?.messages
  const msg = messages?.find((item) => item.id === opts.messageId)
  if (!msg) throw new Error('原对话消息不存在。')
  const existing = msg.imageJobs?.find((job) => opts.retryId ? job.id === opts.retryId : job.callKey === opts.callKey)
  if (existing && (!opts.retryId || controllers.has(existing.id))) return existing
  if (controllers.size >= 8) throw new Error('已有 8 个图片任务在处理，请等待部分任务完成。')
  const request = structuredClone(existing?.request ?? opts.request)
  const settings = structuredClone(opts.settings)
  const job: CharacterImageJob = existing
    ? { ...structuredClone(existing), status: 'queued', error: undefined, finishedAt: undefined, notification: 'pending', items: existing.items.map((item) => item.status === 'completed' ? item : { ...item, status: 'queued', error: undefined }) }
    : { id: nanoid(), callKey: opts.callKey, request, status: 'queued', items: [], notification: 'pending', createdAt: Date.now() }
  if (opts.notify === false) job.notification = 'done'
  const logContext = { conversationId: opts.conversationId, messageId: opts.messageId, jobId: job.id }
  const jobLogId = recordCharacterLog({ ...logContext, stage: 'image', status: 'running', title: opts.retryId ? '重试未完成图片' : `图片任务接单 · ${request.params.n} 张`, details: { request, queued: running >= 2 } })
  const controller = new AbortController()
  controllers.set(job.id, controller)
  const update = async (patch: Partial<CharacterImageJob>) => {
    Object.assign(job, patch)
    const conversation = useCharacterStore.getState().conversations.find((convo) => convo.id === opts.conversationId)
    const message = conversation?.messages.find((item) => item.id === opts.messageId)
    if (!message) throw new Error('原对话消息已被移除。')
    const jobs = message.imageJobs ?? []
    const messagePatch = {
      imageJobs: jobs.some((item) => item.id === job.id) ? jobs.map((item) => item.id === job.id ? structuredClone(job) : item) : [...jobs, structuredClone(job)],
      imageIds: opts.notify === false ? [...new Set([...message.imageIds, ...job.items.flatMap((item) => item.imageIds)])] : message.imageIds,
    }
    // 后台图片按实际送达时间进入对话；固定消息 ID 避免重试、保存时重复投递。
    const delivered = opts.notify === false ? [] : job.items.flatMap((item, idx) => {
      const id = `image-${job.id}-${idx}`
      if (item.status !== 'completed' || !item.imageIds.length || conversation!.messages.some((msg) => msg.id === id || item.imageIds.every((imageId) => msg.imageIds.includes(imageId)))) return []
      return [{ id, role: 'assistant' as const, content: '', imageIds: item.imageIds, status: 'done' as const, createdAt: Date.now() }]
    })
    useCharacterStore.setState((state) => ({ conversations: state.conversations.map((convo) => convo.id === opts.conversationId ? {
      ...convo, updatedAt: Date.now(),
      messages: [...convo.messages.map((msg) => msg.id === opts.messageId ? { ...msg, ...messagePatch } : msg), ...delivered],
    } : convo) }))
    for (const msg of delivered) recordCharacterLog({ ...logContext, stage: 'image', status: 'success', title: '图片送达聊天', result: { messageId: msg.id, imageIds: msg.imageIds } })
    await saveCharacters()
  }
  try {
    await update({})
  } catch (err) {
    updateCharacterLog(jobLogId, { status: 'error', result: { error: err } })
    controllers.delete(job.id)
    throw err
  }
  // 输入 ID 已持久化并受回收保护；入队时立即读取字节，之后不读取可变的人物资料或聊天历史。
  const snapshot = Promise.all([...new Set([...request.referenceIds, ...(request.maskImageId ? [request.maskImageId] : [])])].map(async (id) => {
    const url = await ensureImageCached(id)
    if (!url) throw new Error('任务选中的参考图或遮罩已丢失，请重新上传。')
    return [id, url] as const
  })).then((entries) => {
    const sizes = entries.map(([, url]) => getDataUrlDecodedByteSize(url))
    if (sizes.some((size) => size > 20 * 1024 * 1024) || sizes.reduce((sum, size) => sum + size, 0) > 64 * 1024 * 1024) throw new Error('参考图每张最多 20 MB，合计最多 64 MB。')
    return { images: new Map(entries) }
  }).catch((err: unknown) => ({ error: err }))
  const run = async () => {
    try {
      controller.signal.throwIfAborted()
      const captured = await snapshot
      if ('error' in captured) throw captured.error
      const images = captured.images
      recordCharacterLog({ ...logContext, stage: 'image', status: 'info', title: '参考图已准备，仅用于生图', details: { referenceIds: request.referenceIds, referenceRoles: request.referenceRoles, maskImageId: request.maskImageId, decodedBytes: [...images.values()].map(getDataUrlDecodedByteSize) } })
      controller.signal.throwIfAborted()
      const fresh = !job.items.length
      const optimizeBatch = request.params.n > 1 && request.optimize !== false && normalizeCharacterImageOptimizer(settings.characterImageOptimizer).enabled
      if (!job.items.length) {
        await update({ status: 'optimizing' })
        if (optimizeBatch) {
          await update({ items: Array.from({ length: request.params.n }, () => ({ prompt: request.prompt, status: 'queued', imageIds: [] })) })
        } else {
          const plan = await optimizeCharacterImages(request, settings, controller.signal, logContext)
          await update({ optimizerStatus: plan.status, optimizerNote: plan.note, items: plan.prompts.map((prompt) => ({ prompt, optimizerStatus: plan.status, optimizerNote: plan.note, status: 'queued', imageIds: [] })) })
        }
      }
      // 提示词和图片先同步占位再等待持久化，避免并发完成时检查到同一份旧状态。
      const usedPrompts = new Set(job.items.filter((item) => item.status === 'completed').map((item) => item.prompt))
      const replan = job.items.map((item) => {
        const ready = item.optimizerStatus === 'optimized' || (!fresh && !item.optimizerStatus && job.optimizerStatus === 'optimized')
        if (ready && !item.optimizerStatus) item.optimizerStatus = 'optimized'
        const duplicate = usedPrompts.has(item.prompt)
        if (ready && !duplicate) usedPrompts.add(item.prompt)
        return optimizeBatch && item.status !== 'completed' && (!ready || duplicate)
      })
      const usedImages = new Set(useCharacterStore.getState().conversations.find((convo) => convo.id === opts.conversationId)?.messages.flatMap((msg) => msg.role === 'assistant' ? [...msg.imageIds, ...(msg.imageJobs ?? []).flatMap((job) => job.items.flatMap((item) => item.imageIds))] : []) ?? [])
      await update({ status: replan.some(Boolean) ? 'optimizing' : 'generating' })
      const results = await Promise.allSettled(job.items.map(async (item, idx) => {
        if (item.status === 'completed') return
        job.items[idx] = { ...item, status: 'running' }
        const itemLogId = recordCharacterLog({ ...logContext, stage: 'image', status: 'running', title: `生成第 ${idx + 1} / ${job.items.length} 张`, details: { prompt: item.prompt, params: { ...request.params, n: 1 } } })
        try {
          controller.signal.throwIfAborted()
          await update({})
          if (replan[idx]) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const plan = await optimizeCharacterImages({ ...request, params: { ...request.params, n: 1 } }, settings, controller.signal, logContext, { index: idx, count: request.params.n, excludePrompts: attempt ? [...usedPrompts] : [] })
              controller.signal.throwIfAborted()
              job.items[idx] = { ...job.items[idx], optimizerStatus: plan.status, optimizerNote: plan.note }
              if (plan.status !== 'optimized') throw new Error(plan.note || '多图副脑未能生成独立提示词，本张未提交生图。')
              if (usedPrompts.has(plan.prompts[0])) {
                recordCharacterLog({ ...logContext, stage: 'optimizer', status: 'warning', title: `第 ${idx + 1} 张提示词重复${attempt < 2 ? '，重新规划' : ''}`, details: { attempt: attempt + 1, prompt: plan.prompts[0] } })
                if (attempt < 2) continue
                job.items[idx].optimizerStatus = 'fallback'
                throw new Error('副脑连续返回重复提示词，本张未提交生图。')
              }
              usedPrompts.add(plan.prompts[0])
              job.items[idx] = { ...job.items[idx], prompt: plan.prompts[0] }
              await update({})
              break
            }
          }
          controller.signal.throwIfAborted()
          await update({ status: 'generating' })
          const prompt = job.items[idx].prompt
          updateCharacterLog(itemLogId, { details: { prompt, params: { ...request.params, n: 1 } } })
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const result = await executeCharacterImage({ ...request, prompt, params: { ...request.params, n: 1 } }, settings, controller.signal, images, logContext)
            controller.signal.throwIfAborted()
            const previous = new Set(useCharacterStore.getState().conversations.find((convo) => convo.id === opts.conversationId)?.messages.flatMap((msg) => msg.role === 'assistant' ? [...msg.imageIds, ...(msg.imageJobs ?? []).flatMap((job) => job.items.flatMap((item) => item.imageIds))] : []) ?? [])
            // 图片 ID 是内容哈希；接口返回本对话已有图片时仅重试一次，不改副脑最终提示词。
            if (result.imageIds.some((id) => previous.has(id) || usedImages.has(id)) || new Set(result.imageIds).size !== result.imageIds.length) {
              recordCharacterLog({ ...logContext, stage: 'image', status: 'warning', title: attempt === 0 ? `第 ${idx + 1} 张重复，自动重试` : `第 ${idx + 1} 张再次重复`, details: { imageIds: result.imageIds, attempt: attempt + 1 } })
              if (attempt === 0) continue
              throw new Error('图片接口连续返回重复图片，本张未作为新图发送。')
            }
            result.imageIds.forEach((id) => usedImages.add(id))
            job.items[idx] = { ...job.items[idx], status: 'completed', imageIds: result.imageIds, output: result.output }
            updateCharacterLog(itemLogId, { status: 'success', result: { imageIds: result.imageIds } })
            break
          }
        } catch (err) {
          updateCharacterLog(itemLogId, { status: controller.signal.aborted ? 'warning' : 'error', result: { error: err } })
          controller.signal.throwIfAborted()
          console.warn('人物图片任务失败', err)
          job.items[idx] = { ...job.items[idx], status: 'failed', error: err instanceof Error ? err.message : '生图失败。' }
        }
        await update({})
      }))
      // 所有请求退出后再释放队列名额，取消不能遗留仍在运行的子请求。
      controller.signal.throwIfAborted()
      const rejected = results.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason
      const count = job.items.filter((item) => item.status === 'completed').length
      await update({ status: count === job.items.length ? 'completed' : count ? 'partial' : 'failed', optimizerStatus: optimizeBatch ? job.items.every((item) => item.optimizerStatus === 'optimized') ? 'optimized' : 'fallback' : job.optimizerStatus, optimizerNote: job.items.map((item) => item.optimizerNote).filter(Boolean).join('\n') || job.optimizerNote, error: job.items.filter((item) => item.error).map((item) => item.error).join('\n') || undefined, finishedAt: Date.now() })
      updateCharacterLog(jobLogId, { status: job.status === 'completed' ? 'success' : job.status === 'partial' ? 'warning' : 'error', result: characterImageJobSummary(job) })
    } catch (err) {
      const cancelled = controller.signal.aborted
      updateCharacterLog(jobLogId, { status: cancelled ? 'warning' : 'error', result: { error: err, cancelled } })
      if (!cancelled) console.warn('人物后台生图中断', err)
      await update({
        status: cancelled ? 'cancelled' : 'failed', finishedAt: Date.now(),
        error: cancelled ? '已取消未完成的图片。' : err instanceof Error ? err.message : '图片任务失败。',
        items: job.items.map((item) => item.status === 'completed' || item.status === 'failed' ? item : { ...item, status: cancelled ? 'cancelled' : 'interrupted' }),
      })
    } finally {
      controllers.delete(job.id)
      running -= 1
      queue.shift()?.()
      opts.onSettled()
    }
  }
  const start = () => {
    running += 1
    void run().catch((err) => console.error('图片任务保存失败', err))
  }
  if (running < 2) start()
  else {
    queue.push(start)
    controller.signal.addEventListener('abort', () => {
      const idx = queue.indexOf(start)
      if (idx < 0) return
      queue.splice(idx, 1)
      controllers.delete(job.id)
      updateCharacterLog(jobLogId, { status: 'warning', result: { cancelled: true, note: '排队中取消，未请求图片接口。' } })
      void update({ status: 'cancelled', error: '已取消排队的图片任务。', finishedAt: Date.now() }).then(opts.onSettled).catch((err) => console.error('取消图片任务保存失败', err))
    }, { once: true })
  }
  return job
}

export function hasPendingCharacterImageNotification(conversationId: string) {
  return getCharacterImageJobs(conversationId).some((job) => !isCharacterImageJobActive(job) && job.notification === 'pending')
}
