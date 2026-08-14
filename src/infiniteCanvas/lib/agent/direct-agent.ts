import type { ApiProfile, AppSettings } from '../../../types'
import { getAgentTextApiProfile } from '../../../lib/apiProfiles'
import type { ReasoningEffort } from '../../../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../../lib/devProxy'
import { getApiErrorMessage } from '../../../lib/imageApiShared'
import { summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from '@canvas/lib/canvas/canvas-agent-ops'
import {
  DIRECT_CANVAS_TOOLS,
  isDirectCanvasToolName,
  runDirectCanvasTool,
  summarizeDirectCanvasSnapshot,
} from './canvas-agent-tools'
import canvasSkill from './canvas-skill.md?raw'
import { getDirectAgentModel } from './direct-agent-models'

export { parseCanvasOps } from './canvas-agent-op-parser'

export type DirectAgentMessage = {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
}

type DirectResponseOutputItem = {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: unknown
  content?: Array<{ type?: string; text?: string }>
}

type DirectResponsePayload = {
  id?: string
  output_text?: string
  output?: DirectResponseOutputItem[]
  error?: { message?: string }
}

export function getDirectAgentProfile(settings: AppSettings): { profile: ApiProfile | null; message: string | null } {
  const profile = getAgentTextApiProfile(settings)
  if (!profile || profile.provider !== 'openai' || profile.apiMode !== 'responses') {
    return { profile: null, message: '请先在全局设置的 Agent 配置中选择支持 Responses API 的文本模型。' }
  }
  if (!profile.baseUrl.trim() || !profile.apiKey.trim() || !profile.model.trim()) {
    return { profile: null, message: '全局 Agent 文本模型配置不完整，请补充 API 地址、密钥和模型。' }
  }
  return { profile, message: null }
}

export async function runDirectCanvasAgentTurn({ settings, messages, snapshot, applyOps, signal, onTool, model, reasoningEffort }: {
  settings: AppSettings
  messages: DirectAgentMessage[]
  snapshot: CanvasAgentSnapshot | null
  applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot
  signal: AbortSignal
  onTool?: (ops: CanvasAgentOp[], result: CanvasAgentSnapshot) => void
  model?: string
  reasoningEffort?: ReasoningEffort
}): Promise<string> {
  const { profile, message } = getDirectAgentProfile(settings)
  if (!profile) throw new Error(message || 'Agent 模型不可用')

  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const requestProfile = {
    ...profile,
    ...(model ? { model: getDirectAgentModel(model) } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
  const initialInput = messages.flatMap((message) => {
    const content = message.role === 'user'
      ? [
          { type: 'input_text', text: message.text },
          ...(message.images || []).map((image) => ({ type: 'input_image', image_url: image })),
        ]
      : message.text
    return [{ role: message.role, content }]
  })
  let responseId = ''
  let input: unknown[] = initialInput
  let compatibilityInput: unknown[] = initialInput
  let usePreviousResponse = true
  let finalText = ''
  let canvasSnapshot = snapshot
  let consecutiveInvalidToolRounds = 0
  const maxRounds = Math.max(1, Math.min(12, settings.agentMaxToolRounds || 12))

  for (let round = 0; round < maxRounds; round += 1) {
    let payload: DirectResponsePayload
    try {
      payload = await requestResponse({
        profile: requestProfile,
        proxyConfig,
        useApiProxy,
        snapshot: canvasSnapshot,
        input: usePreviousResponse ? input : compatibilityInput,
        previousResponseId: usePreviousResponse ? responseId : '',
        signal,
      })
    } catch (error) {
      if (!usePreviousResponse || !responseId || !shouldUseCompatibilityContinuation(error)) throw error
      usePreviousResponse = false
      payload = await requestResponse({
        profile: requestProfile,
        proxyConfig,
        useApiProxy,
        snapshot: canvasSnapshot,
        input: compatibilityInput,
        previousResponseId: '',
        signal,
      })
    }

    if (usePreviousResponse) responseId = payload.id || responseId
    const text = responseText(payload)
    if (text) finalText = [finalText, text].filter(Boolean).join('\n')
    const calls = (payload.output || []).filter((item) => item.type === 'function_call')
    if (!calls.length) return finalText || '已完成。'

    const continuations = calls.map((call) => {
      const callId = call.call_id || call.id
      if (!callId) throw new Error('画布工具调用缺少 call_id')
      const toolName = call.name
      const callInput = {
        type: 'function_call',
        call_id: callId,
        name: toolName || 'canvas_apply_ops',
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {}),
      }
      try {
        if (!isDirectCanvasToolName(toolName)) throw new Error(`Agent 调用了未注册的画布工具：${toolName || '未命名工具'}`)
        const toolResult = runDirectCanvasTool(toolName, call.arguments, canvasSnapshot)
        if (toolResult.kind === 'read') {
          return {
            valid: true,
            call: callInput,
            output: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ ok: true, ...toolResult.output }),
            },
          }
        }
        const ops = toolResult.ops
        if (toolName === 'canvas_apply_ops' && isImageGenerationRequest(messages) && hasOnlyNodeCreationOps(ops)) {
          throw new Error('生图不能只创建节点。请改用 canvas_generate_image，或在同一批操作中加入同一 nodeId 的 run_generation。')
        }
        const result = applyOps(ops)
        canvasSnapshot = result
        onTool?.(ops, result)
        const hasGeneration = ops.some((op) => op.type === 'run_generation')
        return {
          valid: true,
          call: callInput,
          output: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({
              ok: true,
              status: hasGeneration ? 'started' : 'completed',
              summary: summarizeCanvasAgentOps(ops),
              snapshot: summarizeDirectCanvasSnapshot(result),
            }),
          },
        }
      } catch (error) {
        return {
          valid: false,
          call: callInput,
          output: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : '画布操作格式无效。',
              instruction: '请根据原始 Infinite Canvas skill 选择正确的高层工具。生图优先调用 canvas_generate_image，不要只调用 add_node。',
            }),
          },
        }
      }
    })
    consecutiveInvalidToolRounds = continuations.some((item) => item.valid) ? 0 : consecutiveInvalidToolRounds + 1
    if (consecutiveInvalidToolRounds >= 2) throw new Error('Agent 连续返回无法执行的画布操作，请重试或换一种描述。')
    input = continuations.map((item) => item.output)
    compatibilityInput = [...compatibilityInput, ...continuations.flatMap((item) => [item.call, item.output])]
  }

  if (consecutiveInvalidToolRounds) throw new Error('Agent 未能提供可执行的画布操作，请重试或换一种描述。')
  throw new Error(`Agent 已达到 ${maxRounds} 轮画布工具调用上限。`)
}

async function requestResponse({
  profile,
  proxyConfig,
  useApiProxy,
  snapshot,
  input,
  previousResponseId,
  signal,
}: {
  profile: ApiProfile
  proxyConfig: ReturnType<typeof readClientDevProxyConfig>
  useApiProxy: boolean
  snapshot: CanvasAgentSnapshot | null
  input: unknown[]
  previousResponseId: string
  signal: AbortSignal
}) {
  const body: Record<string, unknown> = {
    model: profile.model,
    instructions: buildInstructions(snapshot),
    input,
    tools: DIRECT_CANVAS_TOOLS,
  }
  if (previousResponseId) body.previous_response_id = previousResponseId
  if (profile.reasoningEffort) body.reasoning = { effort: profile.reasoningEffort }

  const response = await fetch(buildApiUrl(profile.baseUrl, 'responses', proxyConfig, useApiProxy), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(await getApiErrorMessage(response))

  const payload = await response.json() as DirectResponsePayload
  if (payload.error?.message) throw new Error(payload.error.message)
  return payload
}

function shouldUseCompatibilityContinuation(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return /No tool call found for function call output/i.test(message) ||
    /previous[_ ]response[_ ]id.*(?:unsupported|not supported|only supported|invalid|unknown)/i.test(message)
}

function buildInstructions(snapshot: CanvasAgentSnapshot | null) {
  return [
    'You are the assistant inside the Infinite Canvas image workspace. Answer in the user\'s language.',
    `Follow this original Infinite Canvas canvas skill:\n\n${canvasSkill}`,
    [
      'Direct-host adaptation:',
      '- The current webpage canvas is already connected. Use the provided canvas_* function tools directly; do not ask to open another page and do not mention MCP, URL, token, JSON, or manual clicks.',
      '- The current canvas snapshot is included below. Use canvas_get_state or canvas_get_selection when you need to reread it.',
      '- For image generation, call canvas_generate_image. For text, video, or audio generation, call the matching canvas_generate_* tool.',
      '- add_node and canvas_create_node only create nodes. They never generate media. Never represent a generation request with add_node alone.',
      '- canvas_apply_ops is for complex batch layout. A generation batch must include run_generation with a real node ID.',
      '- Generation runs asynchronously. When a tool result has status "started", say that generation has started; do not claim the final image/video/audio is already complete.',
      '- Do not claim a canvas change succeeded unless the tool returned ok=true.',
    ].join('\n'),
    snapshot ? `Current canvas snapshot:\n${JSON.stringify(summarizeDirectCanvasSnapshot(snapshot))}` : 'Canvas context is not available yet. You may answer questions, but do not call canvas tools.',
  ].join('\n\n')
}

function isImageGenerationRequest(messages: DirectAgentMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === 'user')?.text || ''
  return /生图|生成(?:一张|几张|图片|图像|图)|画(?:一张|几张|图片|图像|图)|做(?:一张|几张)(?:图片|图像|图)|generate\s+(?:an?\s+|some\s+)?images?|create\s+(?:an?\s+|some\s+)?images?/i.test(latest)
}

function hasOnlyNodeCreationOps(ops: CanvasAgentOp[]) {
  return ops.some((op) => op.type === 'add_node') && !ops.some((op) => op.type === 'run_generation')
}

function responseText(payload: DirectResponsePayload) {
  return payload.output_text || (payload.output || [])
    .flatMap((item) => item.type === 'message' ? item.content || [] : [])
    .map((item) => item.text || '')
    .join('')
}
