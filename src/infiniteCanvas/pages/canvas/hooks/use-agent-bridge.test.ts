import { describe, expect, it } from 'vitest'

import type { CanvasNodeData } from '@canvas/types/canvas'
import { getAgentFocusViewport, isExecutableCanvasAgentOp } from './use-agent-bridge'

function node(id: string, x: number, y: number, width = 200, height = 120) {
  return { id, position: { x, y }, width, height } as CanvasNodeData
}

describe('canvas Agent bridge', () => {
  it('fits new nodes into the visible canvas area with bounded zoom', () => {
    const viewport = getAgentFocusViewport([
      node('left', 0, 0),
      node('right', 1000, 500),
    ], { width: 1000, height: 600 })

    expect(viewport?.k).toBeCloseTo(0.658, 2)
    expect(viewport?.x).toBeGreaterThan(90)
    expect(viewport?.y).toBeGreaterThan(90)
  })

  it('centers a generation target and ignores empty or malformed operations', () => {
    const viewport = getAgentFocusViewport([node('target', 400, 300)], { width: 1200, height: 800 })

    expect(viewport?.x).toBe(-75)
    expect(viewport?.y).toBeCloseTo(-86, 5)
    expect(viewport?.k).toBe(1.35)
    expect(getAgentFocusViewport([], { width: 1200, height: 800 })).toBeNull()
    expect(isExecutableCanvasAgentOp(undefined)).toBe(false)
    expect(isExecutableCanvasAgentOp({ type: 'run_generation' })).toBe(false)
    expect(isExecutableCanvasAgentOp({ type: 'set_viewport', viewport: { x: 0, y: 0 } })).toBe(false)
    expect(isExecutableCanvasAgentOp({ type: 'add_node' })).toBe(true)
    expect(isExecutableCanvasAgentOp({ type: 'run_generation', nodeId: 'target' })).toBe(true)
  })
})
