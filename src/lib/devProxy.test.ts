import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApiUrl } from './devProxy'

afterEach(() => { vi.unstubAllGlobals() })

describe('buildApiUrl', () => {
  it('本地固定服务商走同源转发，保留 v1beta 和 v1，不修改其他供应商', () => {
    vi.stubGlobal('__LOCAL_API_RELAY__', true)
    expect(buildApiUrl('https://meinianda.top/v1beta', 'models/gemini-image:streamGenerateContent?alt=sse&key=test')).toBe('/__local-api/v1beta/models/gemini-image:streamGenerateContent?alt=sse&key=test')
    expect(buildApiUrl('https://meinianda.top/v1', 'responses')).toBe('/__local-api/v1/responses')
    expect(buildApiUrl('https://api.example.com/v1beta', 'models/gemini-image:generateContent')).toBe('https://api.example.com/v1beta/models/gemini-image:generateContent')
    expect(buildApiUrl('https://meinianda.top.evil.example/v1', 'responses')).toBe('https://meinianda.top.evil.example/v1/responses')
    expect(buildApiUrl('https://meinianda.top/v1', 'responses', null, true)).toBe('/api-proxy/responses')
  })
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('leaves API versioning to the proxy target when proxying', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })

  it('preserves Gemini v1beta base URLs', () => {
    expect(buildApiUrl('https://api.example.com/v1beta', 'models/gemini-image:generateContent?key=test', null, false)).toBe(
      'https://api.example.com/v1beta/models/gemini-image:generateContent?key=test',
    )
  })
})
