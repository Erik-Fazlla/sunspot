import { describe, expect, it } from 'vitest'
import { sunDirectionLabel, sunIndicatorPosition } from './sunIndicator'

describe('sunDirectionLabel', () => {
  it('gives direction, height and cloud-reduced strength', () => {
    expect(sunDirectionLabel({ bearingDeg: 225, altitudeDeg: 25.2 }, 0.48)).toBe('Sun from SW, 25° up, 48% strength')
    expect(sunDirectionLabel({ bearingDeg: 180, altitudeDeg: 61.6 }, 1)).toBe('Sun from S, 62° up, 100% strength')
    expect(sunDirectionLabel({ bearingDeg: 95, altitudeDeg: 8 }, 0)).toBe('Sun from E, 8° up, 0% strength')
  })

  it('leaves the strength out when there is no forecast', () => {
    expect(sunDirectionLabel({ bearingDeg: 225, altitudeDeg: 25 }, null)).toBe('Sun from SW, 25° up')
    expect(sunDirectionLabel({ bearingDeg: 225, altitudeDeg: 25 }, Number.NaN)).toBe('Sun from SW, 25° up')
  })

  it('clamps an out-of-range strength', () => {
    expect(sunDirectionLabel({ bearingDeg: 0, altitudeDeg: 10 }, 1.4)).toBe('Sun from N, 10° up, 100% strength')
    expect(sunDirectionLabel({ bearingDeg: 0, altitudeDeg: 10 }, -0.2)).toBe('Sun from N, 10° up, 0% strength')
  })

  it('says so when the sun is down, whatever the strength', () => {
    expect(sunDirectionLabel({ bearingDeg: 300, altitudeDeg: -4 }, 0.9)).toBe('Sun below the horizon')
    expect(sunDirectionLabel({ bearingDeg: 300, altitudeDeg: 0 }, null)).toBe('Sun below the horizon')
  })
})

describe('sunIndicatorPosition', () => {
  const none = { left: 0, right: 0, top: 0, bottom: 0 }

  it('puts the sun toward the screen direction the light comes from', () => {
    // 1000 x 600 map, margin 100 -> ellipse radii 400 and 200 around (500, 300).
    expect(sunIndicatorPosition(0, 1000, 600, none, 100)).toEqual({ x: 900, y: 300 })
    const down = sunIndicatorPosition(Math.PI / 2, 1000, 600, none, 100)
    expect(down.x).toBeCloseTo(500)
    expect(down.y).toBeCloseTo(500)
    const upLeft = sunIndicatorPosition(-Math.PI * 0.75, 1000, 600, none, 100)
    expect(upLeft.x).toBeLessThan(500)
    expect(upLeft.y).toBeLessThan(300)
  })

  it('stays clear of the area covered by the panel', () => {
    const insets = { left: 400, right: 0, top: 0, bottom: 0 }
    for (let angle = 0; angle < Math.PI * 2; angle += 0.3) {
      const { x, y } = sunIndicatorPosition(angle, 1400, 800, insets)
      expect(x).toBeGreaterThan(400)
      expect(x).toBeLessThan(1400)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(800)
    }
  })

  it('keeps a usable ellipse on a very small map', () => {
    const { x, y } = sunIndicatorPosition(0, 120, 120, none)
    expect(x).toBeCloseTo(90)
    expect(y).toBeCloseTo(60)
  })
})
