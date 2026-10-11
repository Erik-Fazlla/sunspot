import { describe, expect, it } from 'vitest'
import { labelSlug, weatherLabel, type HourWeather } from './weatherLabel'

function hour(overrides: Partial<HourWeather>): HourWeather {
  return {
    time: '2026-10-12T14:00',
    cloudCover: 0,
    precipitationProbability: 0,
    precipitation: 0,
    temperature: 22,
    directRadiation: 500,
    shortwaveRadiation: 650,
    ...overrides,
  }
}

describe('weatherLabel', () => {
  it('is Sunny with clear sky and a strong direct beam', () => {
    expect(weatherLabel(hour({ cloudCover: 10 }))).toBe('Sunny')
    expect(weatherLabel(hour({ cloudCover: 25 }))).toBe('Sunny')
  })

  it('is Partly sunny with moderate cloud', () => {
    expect(weatherLabel(hour({ cloudCover: 26 }))).toBe('Partly sunny')
    expect(weatherLabel(hour({ cloudCover: 60, directRadiation: 250, shortwaveRadiation: 450 }))).toBe('Partly sunny')
  })

  it('is Partly sunny when the sky is clear but the direct beam is weak (haze)', () => {
    expect(weatherLabel(hour({ cloudCover: 10, directRadiation: 120, shortwaveRadiation: 400 }))).toBe('Partly sunny')
  })

  it('is Overcast with heavy cloud or almost no direct beam', () => {
    expect(weatherLabel(hour({ cloudCover: 80 }))).toBe('Overcast')
    expect(weatherLabel(hour({ cloudCover: 100, directRadiation: 5, shortwaveRadiation: 120 }))).toBe('Overcast')
    expect(weatherLabel(hour({ cloudCover: 55, directRadiation: 10, shortwaveRadiation: 200 }))).toBe('Overcast')
  })

  it('is Rainy when it rains or rain is likely, whatever the cloud cover', () => {
    expect(weatherLabel(hour({ precipitation: 0.2 }))).toBe('Rainy')
    expect(weatherLabel(hour({ precipitationProbability: 60 }))).toBe('Rainy')
    expect(weatherLabel(hour({ cloudCover: 100, precipitation: 1.4 }))).toBe('Rainy')
  })

  it('does not call a trace of drizzle or a small chance rainy', () => {
    expect(weatherLabel(hour({ precipitation: 0.1, precipitationProbability: 59 }))).toBe('Sunny')
  })

  it('judges night hours on cloud cover alone', () => {
    const night = { directRadiation: 0, shortwaveRadiation: 0 }
    expect(weatherLabel(hour({ ...night, cloudCover: 5 }))).toBe('Sunny')
    expect(weatherLabel(hour({ ...night, cloudCover: 50 }))).toBe('Partly sunny')
    expect(weatherLabel(hour({ ...night, cloudCover: 95 }))).toBe('Overcast')
  })

  it('treats missing values as zero', () => {
    expect(
      weatherLabel(
        hour({
          cloudCover: null,
          precipitation: null,
          precipitationProbability: null,
          directRadiation: null,
          shortwaveRadiation: null,
        }),
      ),
    ).toBe('Sunny')
  })
})

describe('labelSlug', () => {
  it('makes a CSS-friendly name', () => {
    expect(labelSlug('Partly sunny')).toBe('partly-sunny')
    expect(labelSlug('Rainy')).toBe('rainy')
  })
})
