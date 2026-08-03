import { afterEach, describe, expect, it, vi } from 'vitest'

import { lockApiSettings } from '../../../lib/fixedApiProfiles'
import type { CanvasAgentOp, CanvasAgentSnapshot } from '../canvas/canvas-agent-ops'
import { parseCanvasOps, runDirectCanvasAgentTurn } from './direct-agent'

const snapshot: CanvasAgentSnapshot = {
  projectId: 'project-1',
  title: 'Test canvas',
  nodes: [],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function request(settings = lockApiSettings({ apiKey: 'test-key' })) {
  return {
    settings,
    messages: [{ role: 'user' as const, text: 'Organize the current canvas' }],
    snapshot,
    applyOps: vi.fn((_ops?: CanvasAgentOp[]) => snapshot),
    signal: new AbortController().signal,
  }
}

describe('direct canvas agent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to paired function-call input when previous_response_id is not supported', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        id: 'resp-1',
        output: [{
          type: 'function_call',
          call_id: 'call-1',
          name: 'canvas_apply_ops',
          arguments: '{"operations":[{"action":"createNode","node_id":"node-1","node_type":"text","x":40,"y":80}]}',
        }],
      }))
      .mockResolvedValueOnce(response({
        error: { message: 'No tool call found for function call output with call_id call-1' },
      }, 400))
      .mockResolvedValueOnce(response({
        id: 'resp-2',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Canvas updated.' }] }],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const input = request()
    const onTool = vi.fn()

    await expect(runDirectCanvasAgentTurn({ ...input, onTool })).resolves.toBe('Canvas updated.')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(input.applyOps).toHaveBeenCalledWith([expect.objectContaining({ type: 'add_node', id: 'node-1', nodeType: 'text', position: { x: 40, y: 80 } })])
    expect(onTool).toHaveBeenCalledTimes(1)
    const retry = JSON.parse(fetchMock.mock.calls[2][1].body as string)
    expect(retry.previous_response_id).toBeUndefined()
    expect(retry.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call', call_id: 'call-1', name: 'canvas_apply_ops' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call-1' }),
    ]))
  })

  it('keeps a normal text-only answer out of the canvas tool path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      id: 'resp-1',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'The canvas has three nodes.' }] }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const input = request()

    await expect(runDirectCanvasAgentTurn(input)).resolves.toBe('The canvas has three nodes.')
    expect(input.applyOps).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a structured tool error so the model can recover from an invalid call', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        id: 'resp-1',
        output: [{
          type: 'function_call',
          call_id: 'call-1',
          name: 'canvas_apply_ops',
          arguments: '{"ops":[{"type":"connect_nodes","from":"node-1"}]}',
        }],
      }))
      .mockResolvedValueOnce(response({
        id: 'resp-2',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'I need a valid target node first.' }] }],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const input = request()

    await expect(runDirectCanvasAgentTurn(input)).resolves.toBe('I need a valid target node first.')
    expect(input.applyOps).not.toHaveBeenCalled()
    const continuation = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(JSON.parse(continuation.input[0].output)).toMatchObject({ ok: false })
  })

  it('reports an accurate error after consecutive invalid tool calls', async () => {
    const invalid = {
      type: 'function_call',
      call_id: 'call-1',
      name: 'canvas_apply_ops',
      arguments: '{"ops":[]}',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ id: 'resp-1', output: [invalid] }))
      .mockResolvedValueOnce(response({ id: 'resp-2', output: [{ ...invalid, call_id: 'call-2' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const input = request()

    await expect(runDirectCanvasAgentTurn(input)).rejects.toThrow(/Agent/)
    expect(input.applyOps).not.toHaveBeenCalled()
  })
  it('normalizes common operation wrappers and field aliases', () => {
    expect(parseCanvasOps({
      canvasOps: [
        { action: 'setViewport', viewport: { x: 10, y: 20, zoom: 0.8 } },
        { operation: 'generate', node_id: 'node-1', mode: 'image', prompt: 'Generate an image' },
      ],
    })).toEqual([
      { type: 'set_viewport', viewport: { x: 10, y: 20, k: 0.8 } },
      { type: 'run_generation', nodeId: 'node-1', mode: 'image', prompt: 'Generate an image' },
    ])
  })

  it('loads the original canvas skill and exposes the high-level image generation tool', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        id: 'resp-1',
        output: [{
          type: 'function_call',
          call_id: 'call-1',
          name: 'canvas_generate_image',
          arguments: '{"prompt":"蓝色海边灯塔","size":"1:1"}',
        }],
      }))
      .mockResolvedValueOnce(response({
        id: 'resp-2',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '图片生成已开始。' }] }],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const input = request()
    input.messages = [{ role: 'user', text: '生成一张蓝色海边灯塔图片' }]

    await expect(runDirectCanvasAgentTurn(input)).resolves.toBe('图片生成已开始。')

    const firstRequest = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(firstRequest.instructions).toContain('# Infinite Canvas')
    expect(firstRequest.instructions).toContain('For image generation, call canvas_generate_image')
    expect(firstRequest.tools.map((tool: { name: string }) => tool.name)).toContain('canvas_generate_image')
    const ops = input.applyOps.mock.calls[0]?.[0] || []
    expect(ops.map((op) => op.type)).toEqual(['add_node', 'add_node', 'connect_nodes', 'select_nodes', 'run_generation'])
    const config = ops[1] as Extract<CanvasAgentOp, { type: 'add_node' }>
    const run = ops[4]
    expect(config).toMatchObject({ type: 'add_node', nodeType: 'config', metadata: { generationMode: 'image' } })
    expect(run).toMatchObject({ type: 'run_generation', nodeId: config.id, mode: 'image' })
    const continuation = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(JSON.parse(continuation.input[0].output)).toMatchObject({ ok: true, status: 'started' })
  })

  it('rejects add_node-only image generation and lets the model repair with canvas_generate_image', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        id: 'resp-1',
        output: [{
          type: 'function_call',
          call_id: 'call-1',
          name: 'canvas_apply_ops',
          arguments: '{"ops":[{"type":"add_node","nodeType":"image","prompt":"一只猫"}]}',
        }],
      }))
      .mockResolvedValueOnce(response({
        id: 'resp-2',
        output: [{
          type: 'function_call',
          call_id: 'call-2',
          name: 'canvas_generate_image',
          arguments: '{"prompt":"一只猫"}',
        }],
      }))
      .mockResolvedValueOnce(response({
        id: 'resp-3',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '已开始生图。' }] }],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const input = request()
    input.messages = [{ role: 'user', text: '请生图：一只猫' }]

    await expect(runDirectCanvasAgentTurn(input)).resolves.toBe('已开始生图。')

    expect(input.applyOps).toHaveBeenCalledTimes(1)
    expect((input.applyOps.mock.calls[0]?.[0] || []).some((op) => op.type === 'run_generation')).toBe(true)
    const repairRequest = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(JSON.parse(repairRequest.input[0].output)).toMatchObject({
      ok: false,
      instruction: expect.stringContaining('canvas_generate_image'),
    })
  })
})
