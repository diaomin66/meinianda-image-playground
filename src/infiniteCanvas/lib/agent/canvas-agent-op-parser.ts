import type { CanvasAgentOp } from '@canvas/lib/canvas/canvas-agent-ops'

export function parseCanvasOps(value: unknown): CanvasAgentOp[] {
  const parsed = parseCanvasArguments(value)
  const rawOps = extractRawOps(parsed)
  const normalized = rawOps.map(normalizeCanvasOp).filter((op): op is CanvasAgentOp => Boolean(op))
  if (!normalized.length) throw new Error('Agent 请求了画布操作，但未提供可执行操作。')
  return normalized
}

export function parseCanvasArguments(value: unknown) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object') return parsed
      throw new Error()
    } catch {
      throw new Error('Agent 返回的画布操作格式无效。')
    }
  }
  if (value && typeof value === 'object') return value
  throw new Error('Agent 返回的画布操作格式无效。')
}

function extractRawOps(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  for (const key of ['ops', 'operations', 'canvas_ops', 'canvasOps', 'actions']) {
    const nested = record[key]
    if (Array.isArray(nested)) return nested
    if (nested && typeof nested === 'object') return [nested]
  }
  return 'type' in record || 'action' in record || 'operation' in record ? [record] : []
}

function normalizeCanvasOp(value: unknown): CanvasAgentOp | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const operation = normalizeOperationName(record.type ?? record.action ?? record.operation)
  if (!operation) return null
  const id = stringValue(record.id ?? record.nodeId ?? record.node_id)
  if (operation === 'add_node') {
    const prompt = stringValue(record.prompt)
    const mode = generationMode(record.mode ?? record.generationMode ?? record.generation_mode)
    const metadata = record.metadata && typeof record.metadata === 'object'
      ? { ...(record.metadata as Record<string, unknown>) }
      : {}
    if (prompt) {
      metadata.prompt = metadata.prompt ?? prompt
      metadata.composerContent = metadata.composerContent ?? prompt
    }
    if (mode) metadata.generationMode = metadata.generationMode ?? mode
    return {
      type: operation,
      ...(id ? { id } : {}),
      ...(stringValue(record.nodeType ?? record.node_type ?? record.kind) ? { nodeType: stringValue(record.nodeType ?? record.node_type ?? record.kind) as CanvasAgentOp extends { nodeType?: infer T } ? T : never } : {}),
      ...(stringValue(record.title ?? record.name) ? { title: stringValue(record.title ?? record.name) } : {}),
      ...(normalizePosition(record.position, record.x, record.y) ? { position: normalizePosition(record.position, record.x, record.y) } : {}),
      ...(numberValue(record.width) !== undefined ? { width: numberValue(record.width) } : {}),
      ...(numberValue(record.height) !== undefined ? { height: numberValue(record.height) } : {}),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    } as CanvasAgentOp
  }
  if (operation === 'update_node') {
    if (!id) return null
    const patch = record.patch && typeof record.patch === 'object' ? { ...(record.patch as Record<string, unknown>) } : {}
    for (const key of ['title', 'position', 'width', 'height']) if (record[key] !== undefined) patch[key] = record[key]
    if (!Object.keys(patch).length && !(record.metadata && typeof record.metadata === 'object')) return null
    return {
      type: operation,
      id,
      ...(Object.keys(patch).length ? { patch } : {}),
      ...(record.metadata && typeof record.metadata === 'object' ? { metadata: record.metadata } : {}),
    }
  }
  if (operation === 'delete_node') {
    const ids = stringArray(record.ids ?? record.nodeIds ?? record.node_ids)
    if (!id && !ids.length && !stringValue(record.nodeType ?? record.node_type)) return null
    return { type: operation, ...(id ? { id } : {}), ...(ids.length ? { ids } : {}), ...(stringValue(record.nodeType ?? record.node_type) ? { nodeType: stringValue(record.nodeType ?? record.node_type) as CanvasAgentOp extends { nodeType?: infer T } ? T : never } : {}) } as CanvasAgentOp
  }
  if (operation === 'delete_connections') {
    const ids = stringArray(record.ids ?? record.connectionIds ?? record.connection_ids)
    if (!record.all && !id && !ids.length) return null
    return { type: operation, ...(id ? { id } : {}), ...(ids.length ? { ids } : {}), ...(record.all === true ? { all: true } : {}) }
  }
  if (operation === 'connect_nodes') {
    const fromNodeId = stringValue(record.fromNodeId ?? record.from_node_id ?? record.from)
    const toNodeId = stringValue(record.toNodeId ?? record.to_node_id ?? record.to)
    return fromNodeId && toNodeId ? { type: operation, ...(id ? { id } : {}), fromNodeId, toNodeId } : null
  }
  if (operation === 'set_viewport') {
    const viewport = normalizeViewport(record.viewport && typeof record.viewport === 'object' ? record.viewport as Record<string, unknown> : record)
    return viewport ? { type: operation, viewport } : null
  }
  if (operation === 'select_nodes') {
    const ids = stringArray(record.ids ?? record.nodeIds ?? record.node_ids)
    return ids.length || Array.isArray(record.ids) ? { type: operation, ids } : null
  }
  if (operation === 'run_generation') {
    if (!id) return null
    return { type: operation, nodeId: id, ...(generationMode(record.mode) ? { mode: generationMode(record.mode) } : {}), ...(stringValue(record.prompt) ? { prompt: stringValue(record.prompt) } : {}) }
  }
  return null
}

function normalizeOperationName(value: unknown) {
  const name = stringValue(value)?.replace(/[-\s]/g, '_').toLowerCase()
  const aliases: Record<string, CanvasAgentOp['type']> = {
    add: 'add_node', add_node: 'add_node', addnode: 'add_node', create: 'add_node', create_node: 'add_node', createnode: 'add_node',
    update: 'update_node', update_node: 'update_node', updatenode: 'update_node', edit_node: 'update_node',
    delete: 'delete_node', delete_node: 'delete_node', deletenode: 'delete_node', remove_node: 'delete_node',
    delete_connections: 'delete_connections', deleteconnections: 'delete_connections', remove_connections: 'delete_connections',
    connect: 'connect_nodes', connect_nodes: 'connect_nodes', connectnodes: 'connect_nodes',
    set_viewport: 'set_viewport', setviewport: 'set_viewport', viewport: 'set_viewport',
    select: 'select_nodes', select_nodes: 'select_nodes', selectnodes: 'select_nodes',
    run_generation: 'run_generation', rungeneration: 'run_generation', generate: 'run_generation',
  }
  return name ? aliases[name] : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter((item): item is string => Boolean(item)) : []
}

function generationMode(value: unknown) {
  return value === 'text' || value === 'image' || value === 'video' || value === 'audio' ? value : undefined
}

function normalizePosition(value: unknown, x: unknown, y: unknown) {
  const position = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const nextX = numberValue(position.x ?? x)
  const nextY = numberValue(position.y ?? y)
  return nextX !== undefined && nextY !== undefined ? { x: nextX, y: nextY } : undefined
}

function normalizeViewport(value: Record<string, unknown>) {
  const x = numberValue(value.x)
  const y = numberValue(value.y)
  const k = numberValue(value.k ?? value.zoom ?? value.scale)
  return x !== undefined && y !== undefined && k !== undefined ? { x, y, k } : undefined
}
