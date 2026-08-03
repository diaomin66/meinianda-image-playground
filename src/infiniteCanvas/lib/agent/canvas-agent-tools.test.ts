import { describe, expect, it } from 'vitest'

import {
  DIRECT_CANVAS_TOOL_NAMES,
  runDirectCanvasTool,
  type DirectCanvasToolName,
} from './canvas-agent-tools'
import type { CanvasAgentOp, CanvasAgentSnapshot } from '@canvas/lib/canvas/canvas-agent-ops'

const snapshot: CanvasAgentSnapshot = {
  projectId: 'project-1',
  title: 'Test canvas',
  nodes: [{
    id: 'node-1',
    type: 'text',
    title: 'Prompt',
    position: { x: 10, y: 20 },
    width: 320,
    height: 220,
    metadata: { content: 'hello', status: 'success' },
  }],
  connections: [],
  selectedNodeIds: ['node-1'],
  viewport: { x: 0, y: 0, k: 1 },
}

const validInputs: Record<DirectCanvasToolName, Record<string, unknown>> = {
  canvas_get_state: {},
  canvas_get_selection: {},
  canvas_apply_ops: { ops: [{ type: 'select_nodes', ids: ['node-1'] }] },
  canvas_create_node: { nodeType: 'image', title: 'Image placeholder' },
  canvas_create_text_node: { text: 'New text' },
  canvas_create_text_nodes: { items: [{ text: 'A' }, { text: 'B' }], direction: 'row' },
  canvas_create_config_node: { prompt: 'A cat', mode: 'image' },
  canvas_create_image_prompt_flow: { prompt: 'A cat' },
  canvas_create_generation_flow: { prompt: 'A cat', mode: 'image' },
  canvas_generate_text: { prompt: 'Write a caption' },
  canvas_generate_image: { prompt: 'A cat' },
  canvas_generate_video: { prompt: 'A running cat' },
  canvas_generate_audio: { prompt: 'Read this sentence' },
  canvas_update_node: { id: 'node-1', patch: { title: 'Updated' } },
  canvas_update_node_text: { id: 'node-1', text: 'Updated text' },
  canvas_move_nodes: { items: [{ id: 'node-1', dx: 20, dy: 30 }] },
  canvas_resize_node: { id: 'node-1', width: 400, height: 300 },
  canvas_delete_nodes: { ids: ['node-1'] },
  canvas_connect_nodes: { connections: [{ fromNodeId: 'node-1', toNodeId: 'node-1' }] },
  canvas_select_nodes: { ids: [] },
  canvas_set_viewport: { viewport: { x: 10, y: 20, k: 0.8 } },
  canvas_run_generation: { nodeId: 'node-1', mode: 'image', prompt: 'A cat' },
}

describe('direct canvas high-level tools', () => {
  it('implements every canvas tool exposed to the model', () => {
    expect(Object.keys(validInputs).sort()).toEqual([...DIRECT_CANVAS_TOOL_NAMES].sort())

    DIRECT_CANVAS_TOOL_NAMES.forEach((name) => {
      expect(() => runDirectCanvasTool(name, validInputs[name], snapshot)).not.toThrow()
    })
  })

  it('turns canvas_generate_image into the original prompt/config/generate flow', () => {
    const result = runDirectCanvasTool('canvas_generate_image', {
      prompt: '蓝色海边灯塔',
      title: '灯塔提示词',
      size: '1:1',
    }, snapshot)

    expect(result.kind).toBe('ops')
    if (result.kind !== 'ops') return
    expect(result.ops.map((op) => op.type)).toEqual(['add_node', 'add_node', 'connect_nodes', 'select_nodes', 'run_generation'])
    const text = result.ops[0] as Extract<CanvasAgentOp, { type: 'add_node' }>
    const config = result.ops[1] as Extract<CanvasAgentOp, { type: 'add_node' }>
    const run = result.ops[4]
    expect(text).toMatchObject({ type: 'add_node', nodeType: 'text', title: '灯塔提示词', metadata: { content: '蓝色海边灯塔' } })
    expect(config).toMatchObject({
      type: 'add_node',
      nodeType: 'config',
      metadata: {
        generationMode: 'image',
        size: '1:1',
        composerContent: `@[node:${text.id}]`,
      },
    })
    expect(run).toMatchObject({ type: 'run_generation', nodeId: config.id, mode: 'image', prompt: `@[node:${text.id}]` })
  })

  it('keeps raw add_node prompts in node metadata instead of discarding them', () => {
    const result = runDirectCanvasTool('canvas_apply_ops', {
      ops: [{ type: 'add_node', id: 'image-1', nodeType: 'image', prompt: '一只猫', mode: 'image' }],
    }, snapshot)

    expect(result).toEqual({
      kind: 'ops',
      ops: [{
        type: 'add_node',
        id: 'image-1',
        nodeType: 'image',
        metadata: {
          prompt: '一只猫',
          composerContent: '一只猫',
          generationMode: 'image',
        },
      }],
    })
  })
})
