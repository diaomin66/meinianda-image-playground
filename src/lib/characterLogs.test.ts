// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCharacterLogs, recordCharacterLog, saveCharacterLogs, updateCharacterLog, useCharacterLogStore } from './characterLogs'

const entry = { conversationId: 'conversation', messageId: 'message', stage: 'chat' as const, status: 'running' as const, title: '主 Agent 请求' }

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useCharacterLogStore.setState({ entries: [], storageError: null })
})
afterEach(() => { saveCharacterLogs(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('人物日志', () => {
  it('保存请求快照，清洗嵌套 JSON 密钥、URL 密钥、签名和图片字节，保留提示词和参数', () => {
    const body = { apiKey: 'secret-key', headers: { Authorization: 'Bearer secret-token' }, url: 'https://example.com/generate?key=url-secret&alt=sse', contents: [{ parts: [{ text: '参考图保持身份，换一个姿势' }, { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }, { thoughtSignature: 'private-signature' }] }], params: { n: 3, aspectRatio: '2:3' }, rawResponse: JSON.stringify({ api_key: 'nested-secret', data: [{ b64_json: 'cGljdHVyZQ==' }], text: '测试输出', preview: 'data:image/png;base64,cGljdHVyZQ==' }) }
    const logId = recordCharacterLog({ ...entry, details: body })
    body.params.n = 1
    const log = useCharacterLogStore.getState().entries[0]
    expect(log.details).toContain('"n": 3')
    expect(log.details).toContain('参考图保持身份，换一个姿势')
    expect(log.details).toContain('测试输出')
    for (const secret of ['secret-key', 'secret-token', 'url-secret', 'private-signature', 'nested-secret', 'aW1hZ2U=', 'cGljdHVyZQ==']) expect(log.details).not.toContain(secret)
    expect(body.apiKey).toBe('secret-key')
    expect(body.contents[0].parts[1].inlineData?.data).toBe('aW1hZ2U=')
    updateCharacterLog(logId, { status: 'error', result: { error: new Error('HTTP 400 https://example.com/?key=error-secret') } })
    saveCharacterLogs()
    expect(localStorage.getItem('character-logs-v1')).toContain('HTTP 400')
    expect(localStorage.getItem('character-logs-v1')).not.toContain('error-secret')
  })

  it('流式文字与耗时更新同一条日志，清空当前对话后迟到更新不会复活旧日志', async () => {
    const id = recordCharacterLog(entry)
    await vi.advanceTimersByTimeAsync(1200)
    updateCharacterLog(id, { firstTokenMs: 1200, result: { receivedText: '你好' } })
    await vi.advanceTimersByTimeAsync(600)
    updateCharacterLog(id, { status: 'success', result: { text: '你好，今天过得怎么样？' } })
    expect(useCharacterLogStore.getState().entries).toHaveLength(1)
    expect(useCharacterLogStore.getState().entries[0]).toMatchObject({ firstTokenMs: 1200, durationMs: 1800, status: 'success' })
    recordCharacterLog({ ...entry, conversationId: 'other' })
    clearCharacterLogs('conversation')
    updateCharacterLog(id, { status: 'error', result: '迟到结果' })
    expect(useCharacterLogStore.getState().entries.map((log) => log.conversationId)).toEqual(['other'])
    expect(localStorage.getItem('character-logs-v1')).not.toContain('你好')
  })

  it('数量与容量都有上限，保留最近记录并提示长文本截断', () => {
    for (let idx = 0; idx < 510; idx += 1) recordCharacterLog({ ...entry, title: `消息-${idx}` })
    expect(useCharacterLogStore.getState().entries).toHaveLength(500)
    expect(useCharacterLogStore.getState().entries[0].title).toBe('消息-10')
    for (let idx = 0; idx < 30; idx += 1) recordCharacterLog({ ...entry, details: { text: '字'.repeat(200000) } })
    expect(JSON.stringify(useCharacterLogStore.getState().entries).length).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(useCharacterLogStore.getState().entries.slice(-1)[0]?.details).toContain('已截断')
  })

  it('刷新恢复记录，未结束步骤标记为中断，损坏数据被丢弃', async () => {
    recordCharacterLog({ ...entry, details: { prompt: '原始提示词' } })
    recordCharacterLog({ ...entry, status: 'success', result: { text: '正常回复' } })
    saveCharacterLogs()
    const saved = JSON.parse(localStorage.getItem('character-logs-v1')!)
    localStorage.setItem('character-logs-v1', JSON.stringify([...saved, { bad: true }]))
    vi.resetModules()
    const restored = (await import('./characterLogs')).useCharacterLogStore.getState().entries
    expect(restored).toHaveLength(2)
    expect(restored[0].status).toBe('warning')
    expect(restored[0].result).toContain('尚未结束')
    expect(restored[0].details).toBe(saved[0].details)
    expect(restored[1].result).toBe(saved[1].result)
  })

  it('存储失败仍可继续记录，错误可见并在恢复保存后清除', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    recordCharacterLog(entry)
    expect(() => saveCharacterLogs()).not.toThrow()
    expect(useCharacterLogStore.getState().entries).toHaveLength(1)
    expect(useCharacterLogStore.getState().storageError).toContain('暂未保存')
    expect(warn).toHaveBeenCalledOnce()
    write.mockRestore()
    saveCharacterLogs()
    expect(useCharacterLogStore.getState().storageError).toBeNull()
  })
})
