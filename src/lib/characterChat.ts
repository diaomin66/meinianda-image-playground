import { nanoid } from 'nanoid'
import type { Character, CharacterMessage, CharacterToolTurn, GeminiContent, GeminiPart } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { useStore } from '../store'
import { saveCharacters, useCharacterStore } from '../characterStore'
import { callAgentResponsesApi } from './agentApi'
import { getAgentTextApiProfile, normalizeAgentMaxToolRounds } from './apiProfiles'
import { createCharacterImageTool, executeCharacterImage, parseCharacterImageCall } from './characterImageTool'
import { callGeminiTextApi, geminiImagePart } from './geminiTextApi'
import { getCharacterChatImage } from './characterChatImages'
import { cancelCharacterImageJob, characterImageStatusTool, enqueueCharacterImageJob, getCharacterImageJobs, hasPendingCharacterImageNotification, readCharacterImageTaskStatus } from './characterImageJobs'
import { characterImageJobSummary, isCharacterImageJobActive } from './characterImageJobState'
import { normalizeCharacterImageOptimizer } from './characterImageSettings'
import { recordCharacterLog, updateCharacterLog } from './characterLogs'
import { applyCharacterLifeSchedule, ensureCharacterLifeSchedule, getCharacterLifeContext, getCharacterLifeDate } from './characterLifeScheduler'

const controllers = new Map<string, AbortController>()

export async function buildCharacterInput(char: Character, messages: CharacterMessage[]) {
  const history = messages.slice(-40)
  const chatImageIds = [...new Set(history.flatMap((msg) => msg.imageIds).slice(-8))]
  const imageIds = new Set([...char.referenceImageIds, ...chatImageIds])
  // 固定人物参考图只提供 ID，原图到实际生图时才读取；聊天附件仍可用于看图对话。
  const images = new Map(await Promise.all(chatImageIds.map(async (id) => [id, await getCharacterChatImage(id)] as const)))
  const input: unknown[] = []
  const contents: GeminiContent[] = []
  const profileText = JSON.stringify({ 名字: char.name, 外貌: char.appearance })
  input.push({ role: 'user', content: [
    { type: 'input_text', text: '人物资料：' + profileText },
    ...char.referenceImageIds.map((id, idx) => ({ type: 'input_text', text: (idx === 0 ? '人物主参考图 ID（仅生图使用）：' : '人物参考图 ID（仅生图使用）：') + id })),
  ] })
  contents.push({ role: 'user', parts: [
    { text: '人物资料：' + profileText },
    ...char.referenceImageIds.map((id, idx) => ({ text: (idx === 0 ? '人物主参考图 ID（仅生图使用）：' : '人物参考图 ID（仅生图使用）：') + id })),
  ] })
  for (const msg of history) {
    if (msg.content) {
      input.push({ role: msg.role, content: msg.content })
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] })
    }
    const refs = msg.imageIds.filter((id) => images.has(id))
    if (!refs.length) continue
    const label = msg.role === 'assistant' ? '上条人物消息实际生成的图片：' : '用户在上条消息附上的图片：'
    input.push({ role: 'user', content: [
      { type: 'input_text', text: label },
      ...refs.flatMap((id) => [{ type: 'input_text', text: '聊天图片 ID：' + id }, { type: 'input_image', image_url: images.get(id) }]),
    ] })
    contents.push({ role: 'user', parts: [{ text: label }, ...refs.flatMap((id) => [{ text: '聊天图片 ID：' + id }, geminiImagePart(images.get(id)!)])] })
  }
  const jobs = messages.flatMap((msg) => msg.imageJobs ?? []).slice(-12)
  if (jobs.length) {
    const text = '以下是内部图片状态，仅用于判断图片是否已送达，不向用户播报任务、进度、参数或提示词；继续按人格进行日常聊天：' + JSON.stringify(jobs.map((job) => ({ taskId: job.id, status: job.status, requestedCount: job.request.params.n, imageIds: job.items.flatMap((item) => item.imageIds) })))
    input.push({ role: 'user', content: text })
    contents.push({ role: 'user', parts: [{ text }] })
  }
  return { input, contents, imageIds }
}

async function appendToolTurn(context: Awaited<ReturnType<typeof buildCharacterInput>>, turn: CharacterToolTurn) {
  if (turn.outputItems) context.input.push(...turn.outputItems)
  if (turn.content) context.contents.push(turn.content)
  const parts: GeminiPart[] = []
  for (const result of turn.results) {
    context.input.push({ type: 'function_call_output', call_id: result.callId, output: JSON.stringify(result.output) })
    parts.push({ functionResponse: { ...(result.callId ? { id: result.callId } : {}), name: result.name, response: result.output } })
  }
  // 函数结果先完整回传，再附上实际生成图，供模型查看和后续工具引用。
  for (const result of turn.results) {
    for (const id of result.imageIds) {
      const url = await getCharacterChatImage(id)
      context.imageIds.add(id)
      context.input.push({ role: 'user', content: [{ type: 'input_text', text: '工具生成图片 ID：' + id }, { type: 'input_image', image_url: url }] })
      parts.push({ text: '工具生成图片 ID：' + id }, geminiImagePart(url))
    }
  }
  if (parts.length) context.contents.push({ role: 'user', parts })
}

export function stopCharacterResponse(conversationId: string) {
  controllers.get(conversationId)?.abort()
}

export function notifyCharacterImages(conversationId: string) {
  if (controllers.has(conversationId) || !hasPendingCharacterImageNotification(conversationId)) return
  void sendCharacterMessage(conversationId, '', [], undefined, true).catch((err) => console.warn('图片完成通知失败', err))
}

export async function retryCharacterImageJob(conversationId: string, messageId: string, jobId: string) {
  const job = getCharacterImageJobs(conversationId).find((item) => item.id === jobId)
  if (!job || isCharacterImageJobActive(job) || job.status === 'completed') return
  await enqueueCharacterImageJob({ conversationId, messageId, callKey: job.callKey, request: job.request, settings: useStore.getState().settings, retryId: jobId, onSettled: () => notifyCharacterImages(conversationId) })
}

export async function sendCharacterMessage(conversationId: string, text: string, imageIds: string[] = [], retryMessageId?: string, imageNotification = false) {
  if (controllers.has(conversationId)) return false
  const state = useCharacterStore.getState()
  const convo = state.conversations.find((item) => item.id === conversationId)
  let char = state.characters.find((item) => item.id === convo?.characterId)
  if (!convo || !char || (!imageNotification && !retryMessageId && !text.trim() && !imageIds.length)) return false
  const notifications = imageNotification ? getCharacterImageJobs(conversationId).filter((job) => !isCharacterImageJobActive(job) && job.notification === 'pending') : []
  if (imageNotification && !notifications.length) return false
  const settings = useStore.getState().settings
  const selectedProfile = settings.profiles.find((item) => item.id === settings.characterTextProfileId) ?? getAgentTextApiProfile(settings)
  const retry = retryMessageId ? convo.messages.find((msg) => msg.id === retryMessageId && msg.role === 'assistant') : undefined
  if (retryMessageId && (!retry || convo.messages[convo.messages.length - 1]?.id !== retry.id)) return false
  // 恢复中断的工具往返时沿用原语言模型，避免签名与模型不匹配。
  const resume = Boolean(retry?.toolTurns?.length)
  const profile = resume ? settings.profiles.find((item) => item.id === retry?.textProfileId) : selectedProfile
  if (!profile?.apiKey.trim()) {
    if (imageNotification) return false
    useStore.getState().showToast('请先填写语言模型密钥', 'error')
    useStore.getState().setShowSettings(true, 'api')
    return false
  }
  const textProfile = resume && retry?.textModel ? { ...profile, model: retry.textModel } : profile
  const controller = new AbortController()
  controllers.set(conversationId, controller)
  const now = Date.now()
  let assistant: CharacterMessage = retry
    ? { ...retry, status: 'replying', error: undefined, imageError: undefined, content: resume ? retry.content : '', toolTurns: resume ? retry.toolTurns : [] }
    : { id: nanoid(), role: 'assistant', content: '', imageIds: [], status: 'replying', createdAt: now, toolTurns: [] }
  assistant = { ...assistant, textProfileId: textProfile.id, textModel: textProfile.model }
  const logContext = { conversationId, messageId: assistant.id }
  recordCharacterLog({ ...logContext, stage: 'chat', status: 'info', title: imageNotification ? '图片送达后继续对话' : retry ? '重试人物回复' : '用户发送消息', details: { text, imageIds, model: textProfile.model, profileId: textProfile.id } })
  if (imageNotification) assistant.imageNotificationIds = notifications.map((job) => job.id)
  const messages: CharacterMessage[] = retry
    ? convo.messages.map((msg) => msg.id === retry.id ? assistant : msg)
    : imageNotification ? [...convo.messages, assistant]
    : [...convo.messages, { id: nanoid(), role: 'user', content: text.trim(), imageIds, status: 'done', createdAt: now }, assistant]
  const notificationIds = assistant.imageNotificationIds ?? []
  const markNotifications = (notification: 'replying' | 'done' | 'failed') => {
    const latest = useCharacterStore.getState().conversations.find((item) => item.id === conversationId)
    for (const msg of latest?.messages ?? []) {
      if (!msg.imageJobs?.some((job) => notificationIds.includes(job.id))) continue
      useCharacterStore.getState().updateMessage(conversationId, msg.id, { imageJobs: msg.imageJobs.map((job) => notificationIds.includes(job.id) ? { ...job, notification } : job) })
    }
  }
  useCharacterStore.setState((state) => ({
    conversations: state.conversations.map((item) => item.id === convo.id ? { ...item, messages, updatedAt: now, title: item.title === '新对话' ? text.trim().slice(0, 24) || '图片对话' : item.title } : item),
  }))
  markNotifications('replying')
  // 请求独立于页面生命周期，所有更新仍写回原对话。
  void (async () => {
    const update = (patch: Partial<CharacterMessage>) => {
      const current = useCharacterStore.getState().conversations.find((item) => item.id === convo.id)?.messages.find((msg) => msg.id === assistant.id)
      assistant = { ...assistant, ...current, ...patch }
      useCharacterStore.getState().updateMessage(convo.id, assistant.id, patch)
    }
    try {
      await saveCharacters()
      const currentConversation = useCharacterStore.getState().conversations.find((item) => item.id === conversationId)
      try {
        const lifeSchedule = await ensureCharacterLifeSchedule(char, currentConversation, settings, '', controller.signal)
        controller.signal.throwIfAborted()
        const latest = useCharacterStore.getState().characters.find((item) => item.id === convo.characterId)
        if (latest) {
          char = latest
          if (lifeSchedule && latest.lifeSchedulerEnabled === true && lifeSchedule.date === getCharacterLifeDate(latest)) {
            char = applyCharacterLifeSchedule(latest, lifeSchedule)
            useCharacterStore.getState().saveCharacter(char)
          }
        }
      } catch (err) {
        controller.signal.throwIfAborted()
        console.warn('生活日程生成失败，继续人物对话', err)
        recordCharacterLog({ ...logContext, stage: 'chat', status: 'warning', title: '生活日程未更新，继续对话', details: { error: err } })
      }
      const context = await buildCharacterInput(char, messages.slice(0, -1))
      const lifeContext = getCharacterLifeContext(char)
      if (lifeContext) {
        context.input.push({ role: 'user', content: lifeContext })
        context.contents.push({ role: 'user', parts: [{ text: lifeContext }] })
      }
      if (notificationIds.length) {
        const jobs = getCharacterImageJobs(conversationId).filter((job) => notificationIds.includes(job.id))
        const result = '内部图片回执：成功的图片已作为聊天消息送达。请结合图片和当前话题按人格自然接话，不播报生图完成、任务状态、参数或提示词。没有成功图片时可简短说照片没发出去，不编造已发送。' + JSON.stringify(jobs.map((job) => ({ requestedCount: job.request.params.n, imageIds: job.items.flatMap((item) => item.imageIds), completedCount: job.items.filter((item) => item.status === 'completed').length })))
        recordCharacterLog({ ...logContext, stage: 'chat', status: 'info', title: '图片回执发送给主 Agent', details: { notificationIds, result } })
        context.input.push({ role: 'user', content: result })
        context.contents.push({ role: 'user', parts: [{ text: result }] })
        for (const id of jobs.flatMap((job) => job.items.flatMap((item) => item.imageIds))) {
          if (context.imageIds.has(id)) continue
          const url = await getCharacterChatImage(id)
          context.input.push({ role: 'user', content: [{ type: 'input_text', text: '任务结果图片 ID：' + id }, { type: 'input_image', image_url: url }] })
          context.contents.push({ role: 'user', parts: [{ text: '任务结果图片 ID：' + id }, geminiImagePart(url)] })
          context.imageIds.add(id)
        }
      }
      const turns: CharacterToolTurn[] = structuredClone(assistant.toolTurns ?? [])
      const tool = createCharacterImageTool(settings, char)
      const tools = notificationIds.length ? [] : [tool, characterImageStatusTool]
      let pending = turns.pop()
      for (const turn of turns) await appendToolTurn(context, turn)
      let round = turns.length
      const maxRounds = normalizeAgentMaxToolRounds(settings.agentMaxToolRounds)
      while (true) {
        controller.signal.throwIfAborted()
        if (!pending) {
          const prefix = assistant.content ? assistant.content + '\n\n' : ''
          update({ status: 'replying' })
          let streamed = ''
          let lastUpdate = 0
          let lastLogUpdate = 0
          const startedAt = Date.now()
          const logId = recordCharacterLog({ ...logContext, stage: 'chat', status: 'running', title: `主 Agent 请求 · 第 ${round + 1} 轮`, details: { provider: textProfile.provider, model: textProfile.model, profileId: textProfile.id } })
          const onRequest = (url: string, body: unknown) => updateCharacterLog(logId, { details: { provider: textProfile.provider, model: textProfile.model, url, body } })
          let textTimer: ReturnType<typeof setTimeout> | undefined
          const flushText = () => {
            clearTimeout(textTimer)
            textTimer = undefined
            if (!streamed || assistant.content === prefix + streamed) return
            lastUpdate = Date.now()
            update({ content: prefix + streamed })
          }
          const onTextDelta = (delta: string) => {
            if (!delta || controller.signal.aborted) return
            if (!streamed) updateCharacterLog(logId, { firstTokenMs: Date.now() - startedAt })
            streamed += delta
            if (Date.now() - lastLogUpdate >= 500) {
              lastLogUpdate = Date.now()
              updateCharacterLog(logId, { result: { receivedText: streamed } })
            }
            // 首段立即显示；短时间内的后续分片合并补刷，不依赖下一分片抵达。
            const wait = 40 - (Date.now() - lastUpdate)
            if (wait <= 0) flushText()
            else if (textTimer === undefined) textTimer = setTimeout(flushText, wait)
          }
          try {
            if (textProfile.provider === 'gemini') {
              const result = await callGeminiTextApi({ profile: textProfile, instructions: char.personality, contents: context.contents, tools: round < maxRounds ? tools : [], signal: controller.signal, onTextDelta, onRequest })
              controller.signal.throwIfAborted()
              updateCharacterLog(logId, { status: 'success', result })
              flushText()
              update({ content: (prefix + result.text).trimEnd() })
              pending = { content: result.content, results: [] }
            } else {
              const result = await callAgentResponsesApi({
                settings, profile: textProfile, params: DEFAULT_PARAMS, input: context.input, signal: controller.signal,
                instructions: char.personality, tools: round < maxRounds ? tools : [],
                onTextDelta, onRequest,
              })
              controller.signal.throwIfAborted()
              updateCharacterLog(logId, { status: 'success', result: { text: result.text, outputItems: result.outputItems } })
              flushText()
              update({ content: (prefix + (result.text || streamed)).trimEnd() })
              pending = { outputItems: result.outputItems ?? [], results: [] }
            }
          } catch (err) {
            updateCharacterLog(logId, { status: controller.signal.aborted ? 'warning' : 'error', result: { error: err, receivedText: streamed } })
            throw err
          } finally {
            if (textTimer !== undefined) flushText()
          }
        }
        const calls = pending.content
          ? pending.content.parts.filter((part) => part.functionCall).map((part) => ({ id: part.functionCall!.id, name: part.functionCall!.name, args: part.functionCall!.args }))
          : (pending.outputItems ?? []).filter((item) => item.type === 'function_call').map((item) => ({ id: item.call_id, name: item.name ?? '', args: item.arguments }))
        if (!calls.length) {
          if (!assistant.content.trim() && !assistant.imageIds.length) throw new Error('人物没有返回回复，请重试。')
          update({ status: assistant.imageError ? 'error' : 'done', error: assistant.imageError })
          markNotifications('done')
          return
        }
        if (round > maxRounds) throw new Error('已达到本轮工具调用上限，请发送新消息继续。')
        update({ toolTurns: structuredClone([...turns, pending]) })
        await saveCharacters()
        for (const [idx, call] of calls.entries()) {
          controller.signal.throwIfAborted()
          const toolLogId = recordCharacterLog({ ...logContext, stage: 'tool', status: 'running', title: `调用 ${call.name}`, details: { callId: call.id, args: call.args } })
          // 已保存的成功结果直接回传；停止或崩溃后的重试不会重复生成这些图片。
          if (pending.results[idx]?.output.success || pending.results[idx]?.output.accepted) {
            pending.results[idx].imageIds.forEach((id) => context.imageIds.add(id))
            updateCharacterLog(toolLogId, { status: 'success', result: { reused: true, ...pending.results[idx].output } })
            continue
          }
          try {
            if (!call.id && textProfile.provider !== 'gemini') throw new Error('语言接口的函数调用缺少 call_id。')
            if (round >= maxRounds) throw new Error('已达到工具调用上限。')
            if (notificationIds.length) throw new Error('图片结果通知不执行新工具。')
            if (call.name === characterImageStatusTool.name) {
              pending.results[idx] = { callId: call.id, name: call.name, output: readCharacterImageTaskStatus(conversationId, call.args), imageIds: [] }
              update({ toolTurns: structuredClone([...turns, pending]) })
              await saveCharacters()
              updateCharacterLog(toolLogId, { status: 'success', result: pending.results[idx].output })
              continue
            }
            if (call.name !== tool.name) throw new Error('未知工具：' + call.name + '。')
            const request = parseCharacterImageCall(call.args, settings, char, context.imageIds)
            if (settings.characterImageBackground !== false || request.mode || normalizeCharacterImageOptimizer(settings.characterImageOptimizer).enabled) {
              const background = settings.characterImageBackground !== false
              const job = await enqueueCharacterImageJob({ conversationId, messageId: assistant.id, callKey: `${round}:${idx}:${call.id ?? ''}`, request, settings, notify: background, onSettled: () => { if (background) notifyCharacterImages(conversationId) } })
              if (background) {
                pending.results[idx] = { callId: call.id, name: call.name, output: { accepted: true, taskId: job.id, status: job.status, requestedCount: request.params.n }, imageIds: [] }
                update({ imageError: undefined })
              } else {
                const cancel = () => cancelCharacterImageJob(job.id)
                controller.signal.addEventListener('abort', cancel, { once: true })
                if (controller.signal.aborted) cancel()
                try {
                  update({ status: 'imaging' })
                  await new Promise<void>((resolve) => {
                    const unsubscribe = useCharacterStore.subscribe(() => {
                      const current = getCharacterImageJobs(conversationId).find((item) => item.id === job.id)
                      if (current && isCharacterImageJobActive(current)) return
                      unsubscribe()
                      resolve()
                    })
                    const current = getCharacterImageJobs(conversationId).find((item) => item.id === job.id)
                    if (!current || !isCharacterImageJobActive(current)) { unsubscribe(); resolve() }
                  })
                  const completed = getCharacterImageJobs(conversationId).find((item) => item.id === job.id)!
                  controller.signal.throwIfAborted()
                  const ids = completed.items.flatMap((item) => item.imageIds)
                  ids.forEach((id) => context.imageIds.add(id))
                  pending.results[idx] = { callId: call.id, name: call.name, output: { success: completed.status === 'completed', ...characterImageJobSummary(completed, true) }, imageIds: ids }
                  update({ imageError: completed.error })
                } finally {
                  controller.signal.removeEventListener('abort', cancel)
                }
              }
              update({ status: 'replying', toolTurns: structuredClone([...turns, pending]) })
              await saveCharacters()
              updateCharacterLog(toolLogId, { status: background || pending.results[idx].output.success ? 'success' : 'error', result: pending.results[idx].output })
              continue
            }
            update({ status: 'imaging', imageRequest: request, imagePrompt: request.prompt, imageReferenceIds: request.referenceIds, imageError: undefined })
            await saveCharacters()
            const result = await executeCharacterImage(request, settings, controller.signal, undefined, logContext)
            pending.results[idx] = { callId: call.id, name: call.name, ...result }
            result.imageIds.forEach((id) => context.imageIds.add(id))
            update({ imageIds: [...assistant.imageIds, ...result.imageIds], status: 'replying' })
            updateCharacterLog(toolLogId, { status: 'success', result: result.output })
          } catch (err) {
            updateCharacterLog(toolLogId, { status: controller.signal.aborted ? 'warning' : 'error', result: { error: err } })
            controller.signal.throwIfAborted()
            console.warn('人物生图工具失败', err)
            const error = err instanceof Error ? err.message : '生图失败。'
            pending.results[idx] = { callId: call.id, name: call.name, output: { success: false, error }, imageIds: [] }
            update({ status: 'replying', imageError: error })
          }
          update({ toolTurns: structuredClone([...turns, pending]) })
          await saveCharacters()
        }
        await appendToolTurn(context, pending)
        turns.push(pending)
        pending = undefined
        round += 1
      }
    } catch (err) {
      recordCharacterLog({ ...logContext, stage: 'chat', status: controller.signal.aborted ? 'warning' : 'error', title: controller.signal.aborted ? '人物回复已停止' : '人物回复失败', result: { error: err } })
      console.warn('人物回复失败', err)
      update({ status: 'error', error: controller.signal.aborted ? '已停止生成，可以重试。' : err instanceof Error ? err.message : '回复失败，请重试。' })
      markNotifications('failed')
    } finally {
      controllers.delete(conversationId)
      notifyCharacterImages(conversationId)
    }
  })()
  return true
}
