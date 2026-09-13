import type { CharacterImageJob, CharacterImageJobItem } from '../types'
import { parseCharacterImageRequest } from './characterImageTool'

export function isCharacterImageJobActive(job: CharacterImageJob) {
  return job.status === 'queued' || job.status === 'optimizing' || job.status === 'generating'
}

export function normalizeCharacterImageJobs(value: unknown): CharacterImageJob[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((data) => {
    if (!data || typeof data !== 'object' || typeof data.id !== 'string' || typeof data.callKey !== 'string') return []
    try {
      const request = parseCharacterImageRequest(data.request)
      const active = ['queued', 'optimizing', 'generating'].includes(data.status)
      const items: CharacterImageJobItem[] = (Array.isArray(data.items) ? data.items : []).slice(0, request.params.n).map((item: Record<string, unknown>) => ({
        prompt: typeof item?.prompt === 'string' ? item.prompt : request.prompt,
        optimizerStatus: ['disabled', 'optimized', 'fallback'].includes(String(item?.optimizerStatus)) ? item.optimizerStatus as CharacterImageJobItem['optimizerStatus'] : undefined,
        optimizerNote: typeof item?.optimizerNote === 'string' ? item.optimizerNote : undefined,
        status: item?.status === 'completed' || item?.status === 'failed' || item?.status === 'cancelled' ? item.status : 'interrupted',
        imageIds: Array.isArray(item?.imageIds) ? item.imageIds.filter((id): id is string => typeof id === 'string') : [],
        output: item?.output && typeof item.output === 'object' && !Array.isArray(item.output) ? item.output as Record<string, unknown> : undefined,
        error: typeof item?.error === 'string' ? item.error : undefined,
      }))
      return [{
        id: data.id, callKey: data.callKey, request, items,
        status: active ? 'interrupted' : ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(data.status) ? data.status : 'interrupted',
        optimizerStatus: ['disabled', 'optimized', 'fallback'].includes(data.optimizerStatus) ? data.optimizerStatus : undefined,
        optimizerNote: typeof data.optimizerNote === 'string' ? data.optimizerNote : undefined,
        error: active ? '页面关闭或刷新使任务中断。可重试未完成的图片。' : typeof data.error === 'string' ? data.error : undefined,
        notification: data.notification === 'done' ? 'done' : 'failed',
        createdAt: typeof data.createdAt === 'number' && Number.isFinite(data.createdAt) ? data.createdAt : Date.now(),
        finishedAt: typeof data.finishedAt === 'number' && Number.isFinite(data.finishedAt) ? data.finishedAt : undefined,
      } as CharacterImageJob]
    } catch {
      return []
    }
  })
}

export function characterImageJobSummary(job: CharacterImageJob, detail = false) {
  return {
    taskId: job.id, status: job.status, requestedCount: job.request.params.n,
    completedCount: job.items.filter((item) => item.status === 'completed').length,
    imageIds: job.items.flatMap((item) => item.imageIds), error: job.error,
    mode: job.request.mode, referenceIds: job.request.referenceIds, referenceRoles: job.request.referenceRoles,
    ...(detail ? { request: job.request, optimizerStatus: job.optimizerStatus, optimizerNote: job.optimizerNote, items: job.items } : {}),
  }
}
