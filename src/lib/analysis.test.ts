import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import { analyzePoint, combinedMessage, hoursInWindow, type PointAnalysis } from './analysis'
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

describe('combinedMessage', () => {
  it('warns about diffuse light under heavy cloud', () => {
    expect(combinedMessage(result(40, 20), [hour({ cloudCover: 80, directRadiation: 60, shortwaveRadiation: 300 })])).toBe(
      'In direct sun for 40 of 60 min, but 80% cloud cover, so expect diffuse light.',
    )
  })

  it('is upbeat under a clear sky', () => {
    expect(combinedMessage(result(60, 0), [hour()])).toBe('In direct sun for all 60 min, and the sky should be clear.')
  })

  it('mentions rain first', () => {
    expect(combinedMessage(result(40, 20), [hour(), hour({ precipitationProbability: 80 })])).toContain(
      'rain is likely',
    )
  })

  it('reports full shade', () => {
    expect(combinedMessage(result(0, 60), [hour()])).toBe(
      'No direct sun in these 60 min, even though the sky should be clear.',
    )
  })

  it('handles a window entirely after sunset', () => {
    expect(combinedMessage(result(0, 0, 60), [hour()])).toContain('below the horizon for this whole window')
  })

  it('says so when there is no forecast', () => {
    expect(combinedMessage(result(40, 20), null)).toContain('forecast is unavailable')
  })
})
