import { describe, expect, it } from 'vitest'
import {
  colouriseSunHours,
  SUN_HOURS_BANDS,
  SUN_HOURS_MAX_SAMPLES,
  sunHoursBandIndex,
  sunHoursLegend,
  sunHoursSampleMinutes,
  sunHoursWindowLabel,
} from './sunHours'

describe('sunHoursSampleMinutes', () => {
  it('samples a one-hour window every 5 minutes, both ends included', () => {
    const minutes = sunHoursSampleMinutes(14 * 60, 15 * 60)
    expect(minutes).toHaveLength(13)
    expect(minutes[0]).toBe(14 * 60)
    expect(minutes[1]).toBe(14 * 60 + 5)
    expect(minutes[12]).toBe(15 * 60)
  })

  it('samples long windows more coarsely, never more often than the cap', () => {
    const fourHours = sunHoursSampleMinutes(10 * 60, 14 * 60)
    expect(fourHours).toHaveLength(13)
    expect(fourHours[1] - fourHours[0]).toBe(20)
    for (const span of [5, 35, 65, 125, 480, 1435]) {
      const minutes = sunHoursSampleMinutes(0, span)
      expect(minutes.length).toBeLessThanOrEqual(SUN_HOURS_MAX_SAMPLES)
      expect(minutes.length).toBeGreaterThanOrEqual(2)
      expect((minutes[1] - minutes[0]) % 5).toBe(0)
      expect(minutes[minutes.length - 1]).toBeLessThanOrEqual(span)
    }
  })

  it('gives a single sample for an empty or inverted window', () => {
    expect(sunHoursSampleMinutes(600, 600)).toEqual([600])
    expect(sunHoursSampleMinutes(600, 540)).toEqual([600])
  })
})

describe('sunHoursBandIndex', () => {
  it('keeps "no sun" and "sun the whole time" apart from everything in between', () => {
    expect(SUN_HOURS_BANDS.map((band) => band.id)).toEqual(['none', 'little', 'part', 'most', 'all'])
    expect(sunHoursBandIndex(0)).toBe(0)
    expect(sunHoursBandIndex(1)).toBe(4)
    expect(sunHoursBandIndex(1 / 13)).toBe(1)
    expect(sunHoursBandIndex(12 / 13)).toBe(3)
  })

  it('splits the rest into thirds', () => {
    expect(sunHoursBandIndex(0.2)).toBe(1)
    expect(sunHoursBandIndex(0.34)).toBe(2)
    expect(sunHoursBandIndex(0.5)).toBe(2)
    expect(sunHoursBandIndex(0.67)).toBe(3)
  })

  it('treats broken input as no sun', () => {
    expect(sunHoursBandIndex(Number.NaN)).toBe(0)
    expect(sunHoursBandIndex(-0.2)).toBe(0)
  })
})

describe('colouriseSunHours', () => {
  /** One pixel per opacity value given. */
  const colourise = (alphas: number[], samples: number) => {
    const pixels = new Uint8ClampedArray(alphas.length * 4)
    alphas.forEach((alpha, i) => (pixels[i * 4 + 3] = alpha))
    colouriseSunHours(pixels, samples)
    return alphas.map((_, i) => Array.from(pixels.slice(i * 4, i * 4 + 4)))
  }
  const band = (id: string) => SUN_HOURS_BANDS.find((b) => b.id === id)!.rgba

  it('colours never-shaded ground as sun the whole time and always-shaded ground as no sun', () => {
    const [clear, shaded] = colourise([0, 255], 13)
    expect(clear).toEqual(band('all'))
    expect(shaded).toEqual(band('none'))
  })

  it('reads the shaded share out of the opacity', () => {
    // 13 samples: each adds about 20 to the opacity.
    const [one, six, twelve] = colourise([20, 120, 240], 13)
    expect(one).toEqual(band('most'))
    expect(six).toEqual(band('part'))
    expect(twelve).toEqual(band('little'))
  })

  it('absorbs the rounding of 8-bit opacity at both ends', () => {
    // Twelve samples of 21 add up to 252, not 255: still shaded every time.
    expect(colourise([252], 12)[0]).toEqual(band('none'))
    expect(colourise([4], 12)[0]).toEqual(band('all'))
  })

  it('leaves ground that is sunny throughout clear, and colours everything else', () => {
    expect(band('all')[3]).toBe(0)
    for (const other of SUN_HOURS_BANDS.filter((b) => b.id !== 'all')) expect(other.rgba[3]).toBeGreaterThan(120)
  })
})

describe('sunHoursLegend', () => {
  it('labels the bands in minutes of sun for the window', () => {
    expect(sunHoursLegend(14 * 60, 15 * 60).map((item) => item.label)).toEqual([
      'no sun',
      'under 20 min',
      '20–40 min',
      'over 40 min',
      'all 60 min (no colour)',
    ])
    expect(sunHoursLegend(9 * 60, 12 * 60)[4].label).toBe('all 180 min (no colour)')
  })

  it('carries each band colour, and none for ground the map leaves clear', () => {
    expect(sunHoursLegend(0, 60)[0].color).toBe('rgb(52, 48, 140)')
    expect(sunHoursLegend(0, 60)[4].color).toBeNull()
  })
})

describe('sunHoursWindowLabel', () => {
  it('writes the window as clock times', () => {
    expect(sunHoursWindowLabel(14 * 60, 15 * 60 + 30)).toBe('14:00–15:30')
  })
})
