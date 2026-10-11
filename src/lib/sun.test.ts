import { describe, expect, it } from 'vitest'
import { MAX_SHADOW_LENGTH_M } from './constants'
import {
  azimuthToBearing,
  compassPoint,
  getSunPosition,
  getSunTimes,
  shadowBearing,
  shadowLength,
  shadowVector,
} from './sun'

const ATHENS = { lat: 37.9838, lon: 23.7275 }
const rad = (deg: number) => (deg * Math.PI) / 180

describe('azimuthToBearing', () => {
  it('converts SunCalc azimuth (from south, toward west) to a compass bearing', () => {
    expect(azimuthToBearing(0)).toBeCloseTo(180) // due south
    expect(azimuthToBearing(Math.PI / 2)).toBeCloseTo(270) // west
    expect(azimuthToBearing(-Math.PI / 2)).toBeCloseTo(90) // east
    expect(azimuthToBearing(Math.PI) % 360).toBeCloseTo(0) // north
    expect(azimuthToBearing(-Math.PI) % 360).toBeCloseTo(0)
  })

  it('always returns a bearing in [0, 360)', () => {
    for (let az = -2 * Math.PI; az <= 2 * Math.PI; az += 0.1) {
      const bearing = azimuthToBearing(az)
      expect(bearing).toBeGreaterThanOrEqual(0)
      expect(bearing).toBeLessThan(360)
    }
  })
})

describe('getSunPosition', () => {
  // Guards the azimuth convention against a SunCalc upgrade: the real sun
  // rises in the east, is due south at solar noon in Athens and sets in the west.
  it('puts the Athens sun in the east in the morning, south at noon, west in the evening', () => {
    const morning = getSunPosition(new Date('2026-06-21T04:30:00Z'), ATHENS.lat, ATHENS.lon)
    const noon = getSunPosition(new Date('2026-06-21T10:27:00Z'), ATHENS.lat, ATHENS.lon)
    const evening = getSunPosition(new Date('2026-06-21T16:30:00Z'), ATHENS.lat, ATHENS.lon)
    expect(morning.bearingDeg).toBeGreaterThan(45)
    expect(morning.bearingDeg).toBeLessThan(110)
    expect(noon.bearingDeg).toBeGreaterThan(170)
    expect(noon.bearingDeg).toBeLessThan(190)
    expect(noon.altitudeDeg).toBeGreaterThan(70)
    expect(evening.bearingDeg).toBeGreaterThan(250)
    expect(evening.bearingDeg).toBeLessThan(315)
  })

  it('reports a negative altitude at night', () => {
    const night = getSunPosition(new Date('2026-06-21T22:00:00Z'), ATHENS.lat, ATHENS.lon)
    expect(night.altitudeRad).toBeLessThan(0)
  })
})

describe('shadowLength', () => {
  it('is height / tan(altitude)', () => {
    expect(shadowLength(10, rad(45))).toBeCloseTo(10)
    expect(shadowLength(10, rad(30))).toBeCloseTo(17.3205, 3)
    expect(shadowLength(20, rad(60))).toBeCloseTo(11.547, 3)
  })

  it('is zero when the sun is at or below the horizon', () => {
    expect(shadowLength(10, 0)).toBe(0)
    expect(shadowLength(10, rad(-5))).toBe(0)
  })

  it('is capped when the sun is very low', () => {
    expect(shadowLength(30, rad(0.5))).toBe(MAX_SHADOW_LENGTH_M)
    expect(shadowLength(30, rad(0.5), 120)).toBe(120)
  })
})

describe('shadow direction', () => {
  it('points away from the sun', () => {
    expect(shadowBearing(180)).toBe(0)
    expect(shadowBearing(270)).toBe(90)
    expect(shadowBearing(90)).toBe(270)
  })

  it('falls north when the sun is in the south and east when it is in the west', () => {
    const south = shadowVector(10, { altitudeRad: rad(45), bearingDeg: 180 })!
    expect(south.north).toBeCloseTo(10)
    expect(south.east).toBeCloseTo(0)
    const west = shadowVector(10, { altitudeRad: rad(45), bearingDeg: 270 })!
    expect(west.east).toBeCloseTo(10)
    expect(west.north).toBeCloseTo(0)
  })

  it('has no vector when the sun is down', () => {
    expect(shadowVector(10, { altitudeRad: -0.1, bearingDeg: 180 })).toBeNull()
  })
})

describe('getSunTimes', () => {
  it('returns sunrise and sunset on the requested local date', () => {
    const { sunrise, sunset } = getSunTimes('2026-06-21', 'Europe/Athens', ATHENS.lat, ATHENS.lon)
    // Athens midsummer: sunrise about 06:03 and sunset about 20:51 local (UTC+3).
    expect(sunrise!.toISOString().slice(0, 13)).toBe('2026-06-21T03')
    expect(sunset!.toISOString().slice(0, 13)).toBe('2026-06-21T17')
  })
})

describe('compassPoint', () => {
  it('names the eight compass points', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(215)).toBe('SW')
    expect(compassPoint(359)).toBe('N')
    expect(compassPoint(90)).toBe('E')
  })
})
