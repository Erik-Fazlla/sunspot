import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import {
  analyzePoint,
  combinedMessage,
  effectiveSunMinutes,
  hoursInWindow,
  type PointAnalysis,
} from './analysis'
import type { Forecast } from './openMeteo'
import { makeBuilding, metersToDegrees, type Ring } from './shadow'
import type { HourWeather } from './weatherLabel'

const ATHENS = { lat: 37.9838, lon: 23.7275 }
const TZ = 'Europe/Athens'

function at(east: number, north: number): Position {
  const { dLon, dLat } = metersToDegrees(east, north, ATHENS.lat)
  return [ATHENS.lon + dLon, ATHENS.lat + dLat]
}

function rect(west: number, south: number, east: number, north: number): Ring {
  return [at(west, south), at(east, south), at(east, north), at(west, north), at(west, south)]
}

function hour(overrides: Partial<HourWeather> = {}): HourWeather {
  return {
    time: '2026-06-21T13:00',
    cloudCover: 5,
    precipitationProbability: 0,
    precipitation: 0,
    temperature: 30,
    directRadiation: 700,
    shortwaveRadiation: 850,
    ...overrides,
  }
}

function result(sun: number, shade: number, night = 0): PointAnalysis {
  const position = { altitudeRad: 0.7, altitudeDeg: 40, bearingDeg: 200 }
  return {
    samples: [],
    totalMinutes: sun + shade + night,
    sunMinutes: sun,
    shadeMinutes: shade,
    nightMinutes: night,
    start: position,
    end: position,
  }
}

describe('analyzePoint', () => {
  // Midsummer, 13:00-14:00 local: the sun is high and roughly in the south.
  const args = ['2026-06-21', 13 * 60, 14 * 60, TZ] as const

  it('counts a full hour of sun on open ground, in twelve 5-minute samples', () => {
    const analysis = analyzePoint(at(0, 0), [], ...args)
    expect(analysis.samples).toHaveLength(12)
    expect(analysis.totalMinutes).toBe(60)
    expect(analysis.sunMinutes).toBe(60)
    expect(analysis.shadeMinutes).toBe(0)
    expect(analysis.start.altitudeDeg).toBeGreaterThan(60)
    expect(analysis.start.bearingDeg).toBeLessThan(analysis.end.bearingDeg)
  })

  it('counts shade behind a tall building to the south', () => {
    // 100 m tower whose north wall is 10 m south of the point.
    const tower = makeBuilding(rect(-20, -50, 20, -10), 100)
    const analysis = analyzePoint(at(0, 0), [tower], ...args)
    expect(analysis.shadeMinutes).toBe(60)
    expect(analysis.sunMinutes).toBe(0)
    expect(analysis.samples.every((s) => s.state === 'shade')).toBe(true)
  })

  it('is not shaded by a building on the far side from the sun', () => {
    const tower = makeBuilding(rect(-20, 10, 20, 50), 100)
    expect(analyzePoint(at(0, 0), [tower], ...args).sunMinutes).toBe(60)
  })

  it('counts samples with the sun below the horizon as no sun', () => {
    const analysis = analyzePoint(at(0, 0), [], '2026-06-21', 23 * 60, 23 * 60 + 30, TZ)
    expect(analysis.nightMinutes).toBe(30)
    expect(analysis.sunMinutes).toBe(0)
    expect(analysis.samples.every((s) => s.state === 'night')).toBe(true)
  })

  it('splits a window that straddles sunset', () => {
    // Sunset in Athens on 21 June is about 20:51 local.
    const analysis = analyzePoint(at(0, 0), [], '2026-06-21', 20 * 60, 21 * 60 + 30, TZ)
    expect(analysis.sunMinutes).toBeGreaterThan(0)
    expect(analysis.nightMinutes).toBeGreaterThan(0)
    expect(analysis.sunMinutes + analysis.shadeMinutes + analysis.nightMinutes).toBe(90)
  })
})

describe('hoursInWindow', () => {
  const forecast: Forecast = {
    timezone: TZ,
    hours: Array.from({ length: 24 }, (_, h) => hour({ time: `2026-06-21T${String(h).padStart(2, '0')}:00` })),
  }

  it('returns the forecast hours the window touches', () => {
    expect(hoursInWindow(forecast, 14 * 60, 15 * 60).map((h) => h.time.slice(11))).toEqual(['14:00'])
    expect(hoursInWindow(forecast, 14 * 60 + 30, 16 * 60 + 15).map((h) => h.time.slice(11))).toEqual([
      '14:00',
      '15:00',
      '16:00',
    ])
  })
})

describe('effectiveSunMinutes', () => {
  // 13:00-14:00 on open ground: twelve unshaded 5-minute samples.
  const open = analyzePoint(at(0, 0), [], '2026-06-21', 13 * 60, 14 * 60, TZ)

  it('equals geometric sun under a clear sky and zero under full cloud', () => {
    expect(effectiveSunMinutes(open, () => 1)).toBe(60)
    expect(effectiveSunMinutes(open, () => 0)).toBe(0)
  })

  it('weights each unshaded sample by its sunFactor', () => {
    expect(effectiveSunMinutes(open, () => 0.3)).toBeCloseTo(18)
  })

  it('uses the sunFactor of the hour each sample falls in', () => {
    // 12:30-13:30: six samples in the 12:00 hour, six in the 13:00 hour.
    const analysis = analyzePoint(at(0, 0), [], '2026-06-21', 12 * 60 + 30, 13 * 60 + 30, TZ)
    const factorAt = (minutes: number) => (minutes < 13 * 60 ? 1 : 0.5)
    expect(effectiveSunMinutes(analysis, factorAt)).toBeCloseTo(30 * 1 + 30 * 0.5)
  })

  it('counts nothing for shaded or night samples, however clear the sky', () => {
    const tower = makeBuilding(rect(-20, -50, 20, -10), 100)
    const shaded = analyzePoint(at(0, 0), [tower], '2026-06-21', 13 * 60, 14 * 60, TZ)
    expect(effectiveSunMinutes(shaded, () => 1)).toBe(0)
    const night = analyzePoint(at(0, 0), [], '2026-06-21', 23 * 60, 23 * 60 + 30, TZ)
    expect(effectiveSunMinutes(night, () => 1)).toBe(0)
  })

  it('counts a short final sample by its real length', () => {
    // 13:00-13:12 -> samples of 5, 5 and 2 minutes.
    const analysis = analyzePoint(at(0, 0), [], '2026-06-21', 13 * 60, 13 * 60 + 12, TZ)
    expect(analysis.samples.map((s) => s.duration)).toEqual([5, 5, 2])
    expect(effectiveSunMinutes(analysis, () => 0.5)).toBeCloseTo(6)
  })
})

describe('combinedMessage', () => {
  const dry = [hour()]

  it('reports both geometric and effective sun when cloud leaves little beam', () => {
    // 11 effective of 40 unshaded minutes is 28% strength, under the Partly sunny floor.
    expect(combinedMessage(result(40, 20), dry, 11)).toBe(
      'Clear of shadows for 40 of 60 min, but cloud cuts the sun to 28% of clear-sky strength, so the light is mostly diffuse: only about 11 min of direct sun.',
    )
  })

  it('says the sun comes and goes at middling strength', () => {
    expect(combinedMessage(result(40, 20), dry, 24)).toBe(
      'Clear of shadows for 40 of 60 min, but cloud cuts the sun to 60% of clear-sky strength, so it comes and goes: about 24 min of direct sun.',
    )
  })

  it('is upbeat when the sun is near full strength', () => {
    expect(combinedMessage(result(60, 0), dry, 57)).toBe(
      'Clear of shadows for all 60 min, and with the sun at 95% of clear-sky strength nearly all of it is direct sun: about 57 min.',
    )
  })

  it('switches wording exactly at the weather label thresholds', () => {
    const at = (strength: number) => combinedMessage(result(60, 0), dry, 60 * strength)
    expect(at(0.7)).toContain('nearly all of it is direct sun')
    expect(at(0.69)).toContain('comes and goes')
    expect(at(0.3)).toContain('comes and goes')
    expect(at(0.29)).toContain('mostly diffuse')
  })

  it('judges the sky by sun strength alone, so heavy cloud cover changes nothing', () => {
    // Thin high cloud: 100% cover, but the beam still gets through.
    const overcastSky = [hour({ cloudCover: 100 })]
    expect(combinedMessage(result(60, 0), overcastSky, 57)).toBe(combinedMessage(result(60, 0), dry, 57))
    expect(combinedMessage(result(60, 0), overcastSky, 24)).toBe(combinedMessage(result(60, 0), dry, 24))
  })

  it('never mentions direct sun without the sun strength beside it', () => {
    const messages = [
      combinedMessage(result(40, 20), dry, 11),
      combinedMessage(result(40, 20), dry, 24),
      combinedMessage(result(60, 0), dry, 57),
      combinedMessage(result(40, 20), null, null),
      combinedMessage(result(40, 20), [hour({ precipitationProbability: 80 })], 10),
    ]
    for (const message of messages) {
      if (message.includes('direct sun')) expect(message).toMatch(/\d+% of clear-sky strength/)
    }
  })

  it('mentions rain first, from a 60% chance in any hour of the window', () => {
    expect(combinedMessage(result(40, 20), [hour(), hour({ precipitationProbability: 60 })], 15)).toContain(
      'rain is likely',
    )
    expect(combinedMessage(result(40, 20), [hour(), hour({ precipitationProbability: 59 })], 15)).not.toContain(
      'rain',
    )
  })

  it('reports full building shade without promising sun', () => {
    expect(combinedMessage(result(0, 60), dry, 0)).toBe(
      'Shadows cover this spot for the whole window, so it gets no direct sun whatever the sky does.',
    )
  })

  it('handles a window entirely after sunset', () => {
    expect(combinedMessage(result(0, 0, 60), dry, 0)).toContain('below the horizon for this whole window')
  })

  it('mentions the horizon only when part of the window is after sunset', () => {
    expect(combinedMessage(result(40, 20), dry, 38)).not.toMatch(/horizon/)
    expect(combinedMessage(result(40, 0, 20), dry, 38)).toContain('below the horizon for 20 min')
  })

  it('does not guess at sunshine when there is no forecast', () => {
    const message = combinedMessage(result(40, 20), null, null)
    expect(message).toContain('forecast is unavailable')
    expect(message).not.toContain('direct sun')
  })
})
