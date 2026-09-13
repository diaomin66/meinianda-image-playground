import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { MOTION_DURATION } from '../lib/motion'

// 保留关闭时的最后一帧；快速重新打开会取消卸载，关闭期间由调用方禁用交互。
export function useExitPresence<T>(value: T | null) {
  const reduced = usePrefersReducedMotion()
  const [retained, setRetained] = useState(value)
  useEffect(() => {
    if (value !== null) {
      setRetained(value)
      return
    }
    if (reduced) {
      setRetained(null)
      return
    }
    const timer = window.setTimeout(() => setRetained(null), MOTION_DURATION.exit)
    return () => window.clearTimeout(timer)
  }, [value, reduced])
  return { value: value ?? (reduced ? null : retained), closing: value === null && retained !== null }
}
