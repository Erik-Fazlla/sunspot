import { describe, expect, it } from 'vitest'
import {
  labelSlug,
  PARTLY_SUNNY_SUN_FACTOR,
  RAINY_PROBABILITY_PCT,
  SUNNY_SUN_FACTOR,
  weatherLabel,
} from './weatherLabel'

describe('weatherLabel thresholds', () => {
  it('are the documented constants', () => {
    expect(RAINY_PROBABILITY_PCT).toBe(60)
    expect(SUNNY_SUN_FACTOR).toBe(0.7)
    expect(PARTLY_SUNNY_SUN_FACTOR).toBe(0.3)
  })
})

describe('weatherLabel', () => {
  it('is Sunny from a sunFactor of 0.7 up', () => {
    expect(weatherLabel(1, 0)).toBe('Sunny')
    expect(weatherLabel(0.85, 10)).toBe('Sunny')
    expect(weatherLabel(SUNNY_SUN_FACTOR, 0)).toBe('Sunny')
  })

  it('is Partly sunny from 0.3 up to just under 0.7', () => {
    expect(weatherLabel(0.69, 0)).toBe('Partly sunny')
    expect(weatherLabel(0.5, 0)).toBe('Partly sunny')
    expect(weatherLabel(PARTLY_SUNNY_SUN_FACTOR, 0)).toBe('Partly sunny')
  })

  it('is Overcast below 0.3', () => {
    expect(weatherLabel(0.29, 0)).toBe('Overcast')
    expect(weatherLabel(0, 0)).toBe('Overcast')
  })

  it('is Rainy from a 60% rain chance up, whatever the sunFactor', () => {
    expect(weatherLabel(1, RAINY_PROBABILITY_PCT)).toBe('Rainy')
    expect(weatherLabel(0.5, 85)).toBe('Rainy')
    expect(weatherLabel(0, 100)).toBe('Rainy')
  })

  it('ignores a rain chance under 60%', () => {
    expect(weatherLabel(1, 59)).toBe('Sunny')
    expect(weatherLabel(0.5, 59)).toBe('Partly sunny')
    expect(weatherLabel(0.1, 59)).toBe('Overcast')
  })

  it('treats an unknown rain chance as none', () => {
    expect(weatherLabel(0.9, null)).toBe('Sunny')
    expect(weatherLabel(0.1, null)).toBe('Overcast')
  })

  it('depends on nothing but those two numbers', () => {
    // Two arguments in, one label out: cloud cover, precipitation amount and
    // radiation only matter through the sunFactor they produce.
    expect(weatherLabel.length).toBe(2)
  })

  it('never returns anything but the four labels across the whole input range', () => {
    const labels = new Set<string>()
    for (let factor = 0; factor <= 1.0001; factor += 0.05) {
      for (const chance of [null, 0, 30, 59, 60, 100]) labels.add(weatherLabel(factor, chance))
    }
    expect([...labels].sort()).toEqual(['Overcast', 'Partly sunny', 'Rainy', 'Sunny'])
  })
})

describe('labelSlug', () => {
  it('makes a CSS-friendly name', () => {
    expect(labelSlug('Partly sunny')).toBe('partly-sunny')
    expect(labelSlug('Rainy')).toBe('rainy')
  })
})
