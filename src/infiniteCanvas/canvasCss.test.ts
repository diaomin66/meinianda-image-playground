import { describe, expect, it } from 'vitest'

import canvasCss from './canvas.css?raw'

describe('infinite canvas CSS', () => {
  it('does not constrain SVG width because connections use a fixed canvas-sized SVG', () => {
    const maxWidthRules = [...canvasCss.matchAll(/([^{}]+)\{([^{}]*max-width[^{}]*)\}/g)]
    const constrainedSvgRules = maxWidthRules.filter((match) => match[1].includes('.infinite-canvas-module svg'))

    expect(constrainedSvgRules).toEqual([])
  })
})
