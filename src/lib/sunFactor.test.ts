import { describe, expect, it } from 'vitest'
import { clearSkyDirectHorizontal, hourSunFactor, MIN_CLEAR_SKY_DIRECT_WM2, sunFactor } from './sunFactor'
import type { HourWeather } from './weatherLabel'

const rad = (deg: number) => (deg * Math.PI) / 180

function hour(overrides: Partial<HourWeather> = {}): HourWeather {
  return {
    time: '2026-06-21T13:00',
    cloudCover: 0,
    precipitationProbability: 0,
    precipitation: 0,
    temperature: 30,
    directRadiation: 0,
    shortwaveRadiation: 0,
    ...overrides,
  }
}

describe('clearSkyDirectHorizontal', () => {
  it('is zero with the sun at or below the horizon', () => {
    expect(clearSkyDirectHorizontal(0)).toBe(0)
    expect(clearSkyDirectHorizontal(rad(-10))).toBe(0)
  })

  it('matches the Meinel model: 1361 * 0.7^(AM^0.678) * sin(altitude)', () => {
    // Sun overhead: air mass 1, so 1361 * 0.7 = 952.7 W/m2.
    expect(clearSkyDirectHorizontal(rad(90))).toBeCloseTo(952.7, 1)
    // 30 degrees up: air mass 2 -> 1361 * 0.7^1.6 * 0.5 = 384.6 W/m2.
    expect(clearSkyDirectHorizontal(rad(30))).toBeCloseTo(384.6, 0)
  })

  it('grows with the height of the sun', () => {
    const values = [5, 15, 30, 45, 60, 90].map((deg) => clearSkyDirectHorizontal(rad(deg)))
    expect([...values].sort((a, b) => a - b)).toEqual(values)
  })
})

describe('sunFactor', () => {
  const altitude = rad(45)
  const clearSky = clearSkyDirectHorizontal(altitude)

  it('is forecast direct radiation over the clear-sky estimate', () => {
    expect(sunFactor(hour({ directRadiation: clearSky / 2 }), altitude)).toBeCloseTo(0.5)
    expect(sunFactor(hour({ directRadiation: clearSky * 0.2, cloudCover: 0 }), altitude)).toBeCloseTo(0.2)
  })

  it('is 0 under thick cloud and 1 under a clear sky', () => {
    expect(sunFactor(hour({ directRadiation: 0, cloudCover: 100 }), altitude)).toBe(0)
    expect(sunFactor(hour({ directRadiation: clearSky }), altitude)).toBeCloseTo(1)
  })

  it('never leaves the 0 to 1 range', () => {
    // Forecasts can beat the clear-sky estimate on very clean days.
    expect(sunFactor(hour({ directRadiation: clearSky * 1.3 }), altitude)).toBe(1)
    expect(sunFactor(hour({ directRadiation: -5 }), altitude)).toBe(0)
  })

  it('prefers radiation over cloud cover when both are present', () => {
    // Thin high cloud: 90% cover but most of the beam still gets through.
    expect(sunFactor(hour({ directRadiation: clearSky * 0.8, cloudCover: 90 }), altitude)).toBeCloseTo(0.8)
  })

  it('falls back to 1 - cloud_cover / 100 when direct radiation is missing', () => {
    expect(sunFactor(hour({ directRadiation: null, cloudCover: 30 }), altitude)).toBeCloseTo(0.7)
    expect(sunFactor(hour({ directRadiation: null, cloudCover: 100 }), altitude)).toBe(0)
  })

  it('falls back to cloud cover when the sun is too low for the ratio to be reliable', () => {
    const lowSun = rad(1)
    expect(clearSkyDirectHorizontal(lowSun)).toBeLessThan(MIN_CLEAR_SKY_DIRECT_WM2)
    expect(sunFactor(hour({ directRadiation: 2, cloudCover: 40 }), lowSun)).toBeCloseTo(0.6)
    expect(sunFactor(hour({ directRadiation: 0, cloudCover: 25 }), rad(-5))).toBeCloseTo(0.75)
  })

  it('assumes a clear sky when nothing is known', () => {
    expect(sunFactor({ directRadiation: null, cloudCover: null }, altitude)).toBe(1)
  })
})

describe('hourSunFactor', () => {
  const ATHENS = { lat: 37.9838, lon: 23.7275 }

  it('uses the sun height at the middle of the forecast hour', () => {
    // 13:30 local on 21 June in Athens: sun about 75 degrees up, clear sky about 890 W/m2.
    const factor = hourSunFactor(hour({ directRadiation: 445 }), ATHENS.lat, ATHENS.lon, 'Europe/Athens')
    expect(factor).toBeGreaterThan(0.45)
    expect(factor).toBeLessThan(0.55)
  })

  it('uses cloud cover for a night hour', () => {
    const night = hour({ time: '2026-06-21T23:00', directRadiation: 0, cloudCover: 20 })
    expect(hourSunFactor(night, ATHENS.lat, ATHENS.lon, 'Europe/Athens')).toBeCloseTo(0.8)
  })
})
