// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExitPresence } from './useExitPresence'
import { MOTION_DURATION } from '../lib/motion'

describe('退出动画挂载状态', () => {
  let root: Root
  let container: HTMLDivElement
  let reduced: boolean
  let listeners: Set<() => void>
  let result: ReturnType<typeof useExitPresence<string>>

  function Harness({ value }: { value: string | null }) {
    result = useExitPresence(value)
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    reduced = false
    listeners = new Set()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({
      matches: reduced,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('关闭期间保留最后内容，动画结束后卸载', () => {
    act(() => root.render(createElement(Harness, { value: '资料' })))
    act(() => root.render(createElement(Harness, { value: null })))
    expect(result).toEqual({ value: '资料', closing: true })
    act(() => vi.advanceTimersByTime(MOTION_DURATION.exit))
    expect(result).toEqual({ value: null, closing: false })
  })

  it('快速关闭、重新打开再关闭时，旧计时器不会提前移除新内容', () => {
    act(() => root.render(createElement(Harness, { value: '资料' })))
    act(() => root.render(createElement(Harness, { value: null })))
    act(() => vi.advanceTimersByTime(100))
    act(() => root.render(createElement(Harness, { value: '相册' })))
    expect(result).toEqual({ value: '相册', closing: false })
    act(() => root.render(createElement(Harness, { value: null })))
    act(() => vi.advanceTimersByTime(40))
    expect(result).toEqual({ value: '相册', closing: true })
    act(() => vi.advanceTimersByTime(100))
    expect(result).toEqual({ value: null, closing: false })
  })

  it('减少动态效果时立即关闭，并响应运行中的系统偏好切换', () => {
    act(() => root.render(createElement(Harness, { value: '资料' })))
    act(() => root.render(createElement(Harness, { value: null })))
    act(() => {
      reduced = true
      listeners.forEach((listener) => listener())
    })
    expect(result).toEqual({ value: null, closing: false })
    act(() => root.render(createElement(Harness, { value: '相册' })))
    act(() => root.render(createElement(Harness, { value: null })))
    expect(result).toEqual({ value: null, closing: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('组件卸载时清理计时器和媒体查询订阅', () => {
    act(() => root.render(createElement(Harness, { value: '资料' })))
    act(() => root.render(createElement(Harness, { value: null })))
    act(() => root.render(null))
    expect(vi.getTimerCount()).toBe(0)
    expect(listeners.size).toBe(0)
  })
})
