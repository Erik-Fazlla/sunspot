import { describe, expect, it } from 'vitest'
import { sunDirectionLabel } from './sunIndicator'

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
