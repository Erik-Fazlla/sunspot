import { describe, expect, it } from 'vitest'
import {
  SHADE_OPACITY,
  SUNLIGHT_MAX_OPACITY,
  SUNLIGHT_MIN_OPACITY,
  sunlightOpacity,
} from './overlay'

describe('sunlightOpacity', () => {
  it('uses the documented constants', () => {
    expect(SUNLIGHT_MIN_OPACITY).toBe(0.12)
    expect(SUNLIGHT_MAX_OPACITY).toBe(0.35)
  })

  it('is zero whenever the sun is down, whatever the sunFactor', () => {
    expect(sunlightOpacity(1, false)).toBe(0)
    expect(sunlightOpacity(0.5, false)).toBe(0)
    expect(sunlightOpacity(0, false)).toBe(0)
  })

  it('keeps a visible floor while the sun is up, even under full cloud', () => {
    expect(sunlightOpacity(0, true)).toBe(SUNLIGHT_MIN_OPACITY)
  })

  it('reaches the maximum under a clear sky', () => {
    expect(sunlightOpacity(1, true)).toBeCloseTo(SUNLIGHT_MAX_OPACITY)
  })

  it('scales linearly in between', () => {
    expect(sunlightOpacity(0.5, true)).toBeCloseTo((SUNLIGHT_MIN_OPACITY + SUNLIGHT_MAX_OPACITY) / 2)
    expect(sunlightOpacity(0.25, true)).toBeCloseTo(0.12 + 0.23 * 0.25)
  })

  it('never decreases as the sun gets stronger', () => {
    let previous = -1
    for (let factor = 0; factor <= 1.0001; factor += 0.05) {
      const opacity = sunlightOpacity(factor, true)
      expect(opacity).toBeGreaterThanOrEqual(previous)
      previous = opacity
    }
  })

  it('stays within the floor and the maximum for out-of-range or broken input', () => {
    expect(sunlightOpacity(-1, true)).toBe(SUNLIGHT_MIN_OPACITY)
    expect(sunlightOpacity(7, true)).toBeCloseTo(SUNLIGHT_MAX_OPACITY)
    expect(sunlightOpacity(Number.NaN, true)).toBe(SUNLIGHT_MIN_OPACITY)
  })
})

describe('SHADE_OPACITY', () => {
  it('is a fixed, clearly visible value per basemap, stronger over a photo', () => {
    expect(SHADE_OPACITY.map).toBeGreaterThanOrEqual(0.4)
    expect(SHADE_OPACITY.satellite).toBeGreaterThan(SHADE_OPACITY.map)
    expect(SHADE_OPACITY.satellite).toBeLessThan(0.8)
  })
})
