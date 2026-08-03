import { nanoid } from 'nanoid'

import { parseCanvasArguments, parseCanvasOps } from './canvas-agent-op-parser'
import type { CanvasAgentOp, CanvasAgentSnapshot } from '@canvas/lib/canvas/canvas-agent-ops'
import type { CanvasGenerationMode, CanvasNodeMetadata, CanvasNodeTypeId } from '@canvas/types/canvas'

type CanvasToolDefinition = {
  type: 'function'
  name: DirectCanvasToolName
  description: string
  parameters: Record<string, unknown>
}

type DirectCanvasToolResult =
  | { kind: 'read'; output: Record<string, unknown> }
  | { kind: 'ops'; ops: CanvasAgentOp[] }

const NODE_TYPES = ['text', 'image', 'config', 'video', 'audio'] as const
const GENERATION_MODES = ['text', 'image', 'video', 'audio'] as const

export const DIRECT_CANVAS_TOOL_NAMES = [
  'canvas_get_state',
  'canvas_get_selection',
  'canvas_apply_ops',
  'canvas_create_node',
  'canvas_create_text_node',
  'canvas_create_text_nodes',
  'canvas_create_config_node',
  'canvas_create_image_prompt_flow',
  'canvas_create_generation_flow',
  'canvas_generate_text',
  'canvas_generate_image',
  'canvas_generate_video',
  'canvas_generate_audio',
  'canvas_update_node',
  'canvas_update_node_text',
  'canvas_move_nodes',
  'canvas_resize_node',
  'canvas_delete_nodes',
  'canvas_connect_nodes',
  'canvas_select_nodes',
  'canvas_set_viewport',
  'canvas_run_generation',
] as const

export type DirectCanvasToolName = (typeof DIRECT_CANVAS_TOOL_NAMES)[number]

const positionProperties = {
  x: { type: 'number' },
  y: { type: 'number' },
}

const generationProperties = {
  model: { type: 'string' },
  size: { type: 'string' },
  quality: { type: 'string' },
  count: { type: 'number' },
  seconds: { type: 'string' },
  vquality: { type: 'string' },
  generateAudio: { type: 'string' },
  watermark: { type: 'string' },
  audioVoice: { type: 'string' },
  audioFormat: { type: 'string' },
  audioSpeed: { type: 'string' },
  audioInstructions: { type: 'string' },
}

const generationFlowProperties = {
  prompt: { type: 'string' },
  title: { type: 'string' },
  ...positionProperties,
  referenceNodeIds: { type: 'array', items: { type: 'string' } },
  ...generationProperties,
}

const operationSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['add_node', 'update_node', 'delete_node', 'delete_connections', 'connect_nodes', 'set_viewport', 'select_nodes', 'run_generation'] },
    id: { type: 'string' },
    nodeId: { type: 'string' },
    ids: { type: 'array', items: { type: 'string' } },
    nodeType: { type: 'string', enum: NODE_TYPES },
    title: { type: 'string' },
    position: { type: 'object', properties: positionProperties, required: ['x', 'y'], additionalProperties: false },
    ...positionProperties,
    width: { type: 'number' },
    height: { type: 'number' },
    patch: { type: 'object' },
    metadata: { type: 'object' },
    fromNodeId: { type: 'string' },
    toNodeId: { type: 'string' },
    viewport: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, k: { type: 'number' } },
      required: ['x', 'y', 'k'],
      additionalProperties: false,
    },
    all: { type: 'boolean' },
    mode: { type: 'string', enum: GENERATION_MODES },
    prompt: { type: 'string' },
  },
  required: ['type'],
  additionalProperties: true,
}

export const DIRECT_CANVAS_TOOLS: CanvasToolDefinition[] = [
  tool('canvas_get_state', '读取当前网页画布的节点、连线、选区和视口。'),
  tool('canvas_get_selection', '读取当前网页画布选中的节点。'),
  tool('canvas_apply_ops', '批量操作当前网页画布。复杂增删改、移动、连接、选择和视口操作使用本工具。生成内容不能只 add_node，必须同时 run_generation；优先使用 canvas_generate_*。', {
    ops: { type: 'array', items: operationSchema },
  }, ['ops']),
  tool('canvas_create_node', '创建任意类型的画布节点。它只创建节点，不会生成内容；需要生图时使用 canvas_generate_image。', {
    nodeType: { type: 'string', enum: NODE_TYPES },
    title: { type: 'string' },
    ...positionProperties,
    width: { type: 'number' },
    height: { type: 'number' },
    metadata: { type: 'object' },
  }, ['nodeType']),
  tool('canvas_create_text_node', '在当前画布创建单个文本节点。', {
    text: { type: 'string' },
    title: { type: 'string' },
    ...positionProperties,
    width: { type: 'number' },
    height: { type: 'number' },
  }),
  tool('canvas_create_text_nodes', '批量创建文本节点，适合标题、段落、脚本和说明。', {
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          title: { type: 'string' },
          ...positionProperties,
          width: { type: 'number' },
          height: { type: 'number' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    ...positionProperties,
    gap: { type: 'number' },
    direction: { type: 'string', enum: ['row', 'column'] },
  }, ['items']),
  tool('canvas_create_config_node', '创建生成配置节点，可指定 text/image/video/audio 模式与参数，并可用 autoRun 立即触发生成。', {
    prompt: { type: 'string' },
    mode: { type: 'string', enum: GENERATION_MODES },
    title: { type: 'string' },
    ...positionProperties,
    width: { type: 'number' },
    height: { type: 'number' },
    autoRun: { type: 'boolean' },
    ...generationProperties,
  }),
  tool('canvas_create_image_prompt_flow', '创建提示词文本节点和图片生成配置节点并自动连线；autoRun=true 时立即生图。', {
    prompt: { type: 'string' },
    ...positionProperties,
    autoRun: { type: 'boolean' },
    ...generationProperties,
  }, ['prompt']),
  tool('canvas_create_generation_flow', '创建提示词、配置节点和参考节点连线组成的生成流程。', {
    ...generationFlowProperties,
    mode: { type: 'string', enum: GENERATION_MODES },
    autoRun: { type: 'boolean' },
  }, ['prompt']),
  tool('canvas_generate_text', '创建文本生成流程并立即触发生成。', generationFlowProperties, ['prompt']),
  tool('canvas_generate_image', '创建图片生成流程并立即触发生图。用户要求生图时优先调用本工具，不要用 add_node 代替。', generationFlowProperties, ['prompt']),
  tool('canvas_generate_video', '创建视频生成流程并立即触发生成。', generationFlowProperties, ['prompt']),
  tool('canvas_generate_audio', '创建音频生成流程并立即触发生成。', generationFlowProperties, ['prompt']),
  tool('canvas_update_node', '更新节点基础字段或 metadata。', {
    id: { type: 'string' },
    patch: { type: 'object' },
    metadata: { type: 'object' },
  }, ['id']),
  tool('canvas_update_node_text', '更新文本节点内容和标题。', {
    id: { type: 'string' },
    text: { type: 'string' },
    title: { type: 'string' },
  }, ['id', 'text']),
  tool('canvas_move_nodes', '移动一个或多个节点，支持绝对坐标或 dx/dy 偏移。', {
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          dx: { type: 'number' },
          dy: { type: 'number' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  }, ['items']),
  tool('canvas_resize_node', '调整节点尺寸。', {
    id: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' },
    freeResize: { type: 'boolean' },
  }, ['id', 'width', 'height']),
  tool('canvas_delete_nodes', '删除指定节点及相关连线。', {
    ids: { type: 'array', minItems: 1, items: { type: 'string' } },
  }, ['ids']),
  tool('canvas_connect_nodes', '批量连接节点。', {
    connections: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          fromNodeId: { type: 'string' },
          toNodeId: { type: 'string' },
        },
        required: ['fromNodeId', 'toNodeId'],
        additionalProperties: false,
      },
    },
  }, ['connections']),
  tool('canvas_select_nodes', '设置当前选中节点；空数组用于清空选择。', {
    ids: { type: 'array', items: { type: 'string' } },
  }, ['ids']),
  tool('canvas_set_viewport', '调整画布视口。', {
    viewport: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, k: { type: 'number' } },
      required: ['x', 'y', 'k'],
      additionalProperties: false,
    },
  }, ['viewport']),
  tool('canvas_run_generation', '触发指定节点生成。生图时 mode=image，并提供 prompt 或确保节点已有提示词/输入。', {
    nodeId: { type: 'string' },
    mode: { type: 'string', enum: GENERATION_MODES },
    prompt: { type: 'string' },
  }, ['nodeId']),
]

export function isDirectCanvasToolName(value: unknown): value is DirectCanvasToolName {
  return typeof value === 'string' && DIRECT_CANVAS_TOOL_NAMES.includes(value as DirectCanvasToolName)
}

export function runDirectCanvasTool(name: DirectCanvasToolName, value: unknown, snapshot: CanvasAgentSnapshot | null): DirectCanvasToolResult {
  const input = parseCanvasArguments(value) as Record<string, unknown>
  if (name === 'canvas_get_state') {
    const state = requireSnapshot(snapshot)
    return { kind: 'read', output: { state: summarizeSnapshot(state) } }
  }
  if (name === 'canvas_get_selection') {
    const state = requireSnapshot(snapshot)
    const selected = new Set(state.selectedNodeIds)
    return { kind: 'read', output: { selectedNodeIds: state.selectedNodeIds, nodes: state.nodes.filter((node) => selected.has(node.id)) } }
  }

  const state = requireSnapshot(snapshot)
  if (name === 'canvas_apply_ops') return { kind: 'ops', ops: parseCanvasOps(input) }
  if (name === 'canvas_create_node') {
    const nodeType = nodeTypeValue(input.nodeType)
    return {
      kind: 'ops',
      ops: [{
        type: 'add_node',
        nodeType,
        ...(stringValue(input.title) ? { title: stringValue(input.title) } : {}),
        position: { x: numberValue(input.x) ?? nextCanvasX(state), y: numberValue(input.y) ?? 0 },
        ...(numberValue(input.width) !== undefined ? { width: numberValue(input.width) } : {}),
        ...(numberValue(input.height) !== undefined ? { height: numberValue(input.height) } : {}),
        ...(recordValue(input.metadata) ? { metadata: recordValue(input.metadata) as CanvasNodeMetadata } : {}),
      }],
    }
  }
  if (name === 'canvas_create_text_node') {
    return { kind: 'ops', ops: [textNodeOp(input, numberValue(input.x) ?? nextCanvasX(state), numberValue(input.y) ?? 0)] }
  }
  if (name === 'canvas_create_text_nodes') {
    const items = objectArray(input.items, 'items')
    const x = numberValue(input.x) ?? nextCanvasX(state)
    const y = numberValue(input.y) ?? 0
    const gap = numberValue(input.gap) ?? 40
    const row = input.direction === 'row'
    return {
      kind: 'ops',
      ops: items.map((item, index) => textNodeOp(item, numberValue(item.x) ?? (row ? x + index * (340 + gap) : x), numberValue(item.y) ?? (row ? y : y + index * (240 + gap)))),
    }
  }
  if (name === 'canvas_create_config_node') {
    const id = `config-${nanoid()}`
    const mode = generationMode(input.mode)
    return {
      kind: 'ops',
      ops: [
        configNodeOp(id, input, numberValue(input.x) ?? nextCanvasX(state), numberValue(input.y) ?? 0),
        ...(input.autoRun === true ? [runGenerationOp(id, mode, stringValue(input.prompt) || '')] : []),
      ],
    }
  }
  if (name === 'canvas_create_image_prompt_flow') return { kind: 'ops', ops: generationFlowOps({ ...input, mode: 'image' }, state) }
  if (name === 'canvas_create_generation_flow') return { kind: 'ops', ops: generationFlowOps(input, state) }
  if (name.startsWith('canvas_generate_')) {
    const mode = name.slice('canvas_generate_'.length) as CanvasGenerationMode
    return { kind: 'ops', ops: generationFlowOps({ ...input, mode, autoRun: true }, state) }
  }
  if (name === 'canvas_update_node') {
    return {
      kind: 'ops',
      ops: [{
        type: 'update_node',
        id: requiredString(input.id, 'id'),
        ...(recordValue(input.patch) ? { patch: recordValue(input.patch) } : {}),
        ...(recordValue(input.metadata) ? { metadata: recordValue(input.metadata) as CanvasNodeMetadata } : {}),
      }],
    }
  }
  if (name === 'canvas_update_node_text') {
    return {
      kind: 'ops',
      ops: [{
        type: 'update_node',
        id: requiredString(input.id, 'id'),
        patch: stringValue(input.title) ? { title: stringValue(input.title) } : undefined,
        metadata: { content: requiredString(input.text, 'text'), status: 'success' },
      }],
    }
  }
  if (name === 'canvas_move_nodes') {
    return {
      kind: 'ops',
      ops: objectArray(input.items, 'items').map((item) => {
        const id = requiredString(item.id, 'items[].id')
        const current = state.nodes.find((node) => node.id === id)
        if (!current) throw new Error(`找不到节点：${id}`)
        return {
          type: 'update_node',
          id,
          patch: {
            position: {
              x: numberValue(item.x) ?? current.position.x + (numberValue(item.dx) ?? 0),
              y: numberValue(item.y) ?? current.position.y + (numberValue(item.dy) ?? 0),
            },
          },
        }
      }),
    }
  }
  if (name === 'canvas_resize_node') {
    return {
      kind: 'ops',
      ops: [{
        type: 'update_node',
        id: requiredString(input.id, 'id'),
        patch: { width: requiredNumber(input.width, 'width'), height: requiredNumber(input.height, 'height') },
        ...(typeof input.freeResize === 'boolean' ? { metadata: { freeResize: input.freeResize } } : {}),
      }],
    }
  }
  if (name === 'canvas_delete_nodes') return { kind: 'ops', ops: [{ type: 'delete_node', ids: requiredStringArray(input.ids, 'ids') }] }
  if (name === 'canvas_connect_nodes') {
    return {
      kind: 'ops',
      ops: objectArray(input.connections, 'connections').map((connection) => ({
        type: 'connect_nodes',
        fromNodeId: requiredString(connection.fromNodeId, 'connections[].fromNodeId'),
        toNodeId: requiredString(connection.toNodeId, 'connections[].toNodeId'),
      })),
    }
  }
  if (name === 'canvas_select_nodes') return { kind: 'ops', ops: [{ type: 'select_nodes', ids: stringArray(input.ids) }] }
  if (name === 'canvas_set_viewport') {
    const viewport = recordValue(input.viewport)
    if (!viewport) throw new Error('viewport 必须是对象。')
    return {
      kind: 'ops',
      ops: [{
        type: 'set_viewport',
        viewport: {
          x: requiredNumber(viewport.x, 'viewport.x'),
          y: requiredNumber(viewport.y, 'viewport.y'),
          k: requiredNumber(viewport.k, 'viewport.k'),
        },
      }],
    }
  }
  return {
    kind: 'ops',
    ops: [runGenerationOp(requiredString(input.nodeId, 'nodeId'), generationMode(input.mode), stringValue(input.prompt))],
  }
}

export function summarizeDirectCanvasSnapshot(snapshot: CanvasAgentSnapshot) {
  return summarizeSnapshot(snapshot)
}

function tool(name: DirectCanvasToolName, description: string, properties: Record<string, unknown> = {}, required: string[] = []): CanvasToolDefinition {
  return {
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
  }
}

function generationFlowOps(input: Record<string, unknown>, state: CanvasAgentSnapshot) {
  const prompt = requiredString(input.prompt, 'prompt')
  const mode = generationMode(input.mode)
  const x = numberValue(input.x) ?? nextCanvasX(state)
  const y = numberValue(input.y) ?? 0
  const textId = `text-${nanoid()}`
  const configId = `config-${nanoid()}`
  const referenceNodeIds = stringArray(input.referenceNodeIds)
  referenceNodeIds.forEach((id) => {
    if (!state.nodes.some((node) => node.id === id)) throw new Error(`找不到参考节点：${id}`)
  })
  const tokens = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)]
  return [
    textNodeOp({ text: prompt, title: stringValue(input.title) || '提示词', id: textId }, x, y),
    configNodeOp(configId, { ...input, prompt: tokens.join('\n'), mode }, x + 420, y),
    { type: 'connect_nodes', fromNodeId: textId, toNodeId: configId },
    ...referenceNodeIds.map((fromNodeId) => ({ type: 'connect_nodes' as const, fromNodeId, toNodeId: configId })),
    { type: 'select_nodes', ids: [configId] },
    ...(input.autoRun === true ? [runGenerationOp(configId, mode, tokens.join('\n'))] : []),
  ] satisfies CanvasAgentOp[]
}

function textNodeOp(input: Record<string, unknown>, x: number, y: number): CanvasAgentOp {
  return {
    type: 'add_node',
    ...(stringValue(input.id) ? { id: stringValue(input.id) } : {}),
    nodeType: 'text',
    ...(stringValue(input.title) ? { title: stringValue(input.title) } : {}),
    position: { x, y },
    ...(numberValue(input.width) !== undefined ? { width: numberValue(input.width) } : {}),
    ...(numberValue(input.height) !== undefined ? { height: numberValue(input.height) } : {}),
    metadata: { content: stringValue(input.text) || '', status: 'success', fontSize: 14 },
  }
}

function configNodeOp(id: string, input: Record<string, unknown>, x: number, y: number): CanvasAgentOp {
  const mode = generationMode(input.mode)
  const prompt = stringValue(input.prompt) || ''
  return {
    type: 'add_node',
    id,
    nodeType: 'config',
    title: stringValue(input.title) || generationTitle(mode),
    position: { x, y },
    ...(numberValue(input.width) !== undefined ? { width: numberValue(input.width) } : {}),
    ...(numberValue(input.height) !== undefined ? { height: numberValue(input.height) } : {}),
    metadata: cleanMetadata({
      generationMode: mode,
      composerContent: prompt,
      prompt,
      status: 'idle',
      model: stringValue(input.model),
      size: stringValue(input.size),
      quality: stringValue(input.quality),
      count: numberValue(input.count),
      seconds: stringValue(input.seconds),
      vquality: stringValue(input.vquality),
      generateAudio: stringValue(input.generateAudio),
      watermark: stringValue(input.watermark),
      audioVoice: stringValue(input.audioVoice),
      audioFormat: stringValue(input.audioFormat),
      audioSpeed: stringValue(input.audioSpeed),
      audioInstructions: stringValue(input.audioInstructions),
    }),
  }
}

function runGenerationOp(nodeId: string, mode: CanvasGenerationMode, prompt?: string): CanvasAgentOp {
  return { type: 'run_generation', nodeId, mode, ...(prompt ? { prompt } : {}) }
}

function nextCanvasX(state: CanvasAgentSnapshot) {
  return state.nodes.length ? Math.max(...state.nodes.map((node) => node.position.x + node.width)) + 80 : 0
}

function generationMode(value: unknown): CanvasGenerationMode {
  return value === 'text' || value === 'video' || value === 'audio' ? value : 'image'
}

function generationTitle(mode: CanvasGenerationMode) {
  if (mode === 'text') return '文本生成'
  if (mode === 'video') return '视频生成'
  if (mode === 'audio') return '音频生成'
  return '图片生成'
}

function nodeTypeValue(value: unknown): CanvasNodeTypeId {
  if (typeof value === 'string' && NODE_TYPES.includes(value as (typeof NODE_TYPES)[number])) return value
  throw new Error('nodeType 必须是 text、image、config、video 或 audio。')
}

function summarizeSnapshot(snapshot: CanvasAgentSnapshot) {
  return {
    projectId: snapshot.projectId,
    title: snapshot.title,
    selectedNodeIds: snapshot.selectedNodeIds,
    viewport: snapshot.viewport,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      position: node.position,
      width: node.width,
      height: node.height,
      metadata: node.metadata?.content ? { ...node.metadata, content: '[omitted]' } : node.metadata,
    })),
    connections: snapshot.connections,
  }
}

function requireSnapshot(snapshot: CanvasAgentSnapshot | null) {
  if (!snapshot) throw new Error('当前没有可操作的画布。')
  return snapshot
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredString(value: unknown, field: string) {
  const result = stringValue(value)
  if (!result) throw new Error(`${field} 不能为空。`)
  return result
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function requiredNumber(value: unknown, field: string) {
  const result = numberValue(value)
  if (result === undefined) throw new Error(`${field} 必须是数字。`)
  return result
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function objectArray(value: unknown, field: string) {
  if (!Array.isArray(value) || !value.length) throw new Error(`${field} 必须是非空数组。`)
  const items = value.map(recordValue)
  if (items.some((item) => !item)) throw new Error(`${field} 包含无效对象。`)
  return items as Record<string, unknown>[]
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter((item): item is string => Boolean(item)) : []
}

function requiredStringArray(value: unknown, field: string) {
  const result = stringArray(value)
  if (!result.length) throw new Error(`${field} 必须包含至少一个节点 ID。`)
  return result
}

function cleanMetadata(value: CanvasNodeMetadata) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== '')) as CanvasNodeMetadata
}
