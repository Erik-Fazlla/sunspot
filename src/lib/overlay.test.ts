import { describe, expect, it } from 'vitest'
import { SHADE_OPACITY, SUN_HOURS_OPACITY } from './overlay'

describe('SHADE_OPACITY', () => {
  it('is a fixed, clearly visible value per basemap, stronger over a photo', () => {
    expect(SHADE_OPACITY.map).toBeGreaterThanOrEqual(0.4)
    expect(SHADE_OPACITY.satellite).toBeGreaterThan(SHADE_OPACITY.map)
    expect(SHADE_OPACITY.satellite).toBeLessThan(0.8)
  })
})

describe('SUN_HOURS_OPACITY', () => {
  it('is strong on both basemaps, and not weaker over a photo', () => {
    expect(SUN_HOURS_OPACITY.map).toBeGreaterThanOrEqual(0.7)
    expect(SUN_HOURS_OPACITY.satellite).toBeGreaterThanOrEqual(SUN_HOURS_OPACITY.map)
    expect(SUN_HOURS_OPACITY.satellite).toBeLessThanOrEqual(1)
  })
})
