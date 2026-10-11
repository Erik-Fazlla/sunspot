import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchForecast, hourAt, parseHourly, type ForecastResponse } from './openMeteo'

/**
 * A synthetic Open-Meteo response for one day. Each variable gets its own
 * offset and the row index is added, so any value names both the variable it
 * came from and the row it was read from: 3014 can only be direct_radiation,
 * row 14.
 */
const OFFSET = {
  cloud_cover: 1000,
  temperature_2m: 2000,
  direct_radiation: 3000,
  shortwave_radiation: 4000,
  precipitation: 5000,
  precipitation_probability: 6000,
} as const

function fixture(): ForecastResponse {
  const rows = Array.from({ length: 24 }, (_, i) => i)
  const column = (offset: number) => rows.map((i) => offset + i)
  return {
    timezone: 'Europe/Athens',
    hourly: {
      time: rows.map((i) => `2026-10-12T${String(i).padStart(2, '0')}:00`),
      cloud_cover: column(OFFSET.cloud_cover),
      temperature_2m: column(OFFSET.temperature_2m),
      direct_radiation: column(OFFSET.direct_radiation),
      shortwave_radiation: column(OFFSET.shortwave_radiation),
      precipitation: column(OFFSET.precipitation),
      precipitation_probability: column(OFFSET.precipitation_probability),
    },
  }
}

describe('parseHourly: which row each variable is read from', () => {
  const forecast = parseHourly(fixture())
  const hour14 = forecast.hours[14]

  it('keeps one entry per timestamp, in order', () => {
    expect(forecast.timezone).toBe('Europe/Athens')
    expect(forecast.hours).toHaveLength(24)
    expect(hour14.time).toBe('2026-10-12T14:00')
  })

  it('reads instantaneous variables from the row at the timestamp', () => {
    expect(hour14.cloudCover).toBe(OFFSET.cloud_cover + 14)
    expect(hour14.temperature).toBe(OFFSET.temperature_2m + 14)
  })

  it('reads preceding-hour variables from the next row, which covers 14:00 to 15:00', () => {
    expect(hour14.directRadiation).toBe(OFFSET.direct_radiation + 15)
    expect(hour14.shortwaveRadiation).toBe(OFFSET.shortwave_radiation + 15)
    expect(hour14.precipitation).toBe(OFFSET.precipitation + 15)
    expect(hour14.precipitationProbability).toBe(OFFSET.precipitation_probability + 15)
  })

  it('applies the same rule to every hour of the day', () => {
    forecast.hours.slice(0, 23).forEach((hour, i) => {
      expect(hour).toEqual({
        time: `2026-10-12T${String(i).padStart(2, '0')}:00`,
        cloudCover: OFFSET.cloud_cover + i,
        temperature: OFFSET.temperature_2m + i,
        directRadiation: OFFSET.direct_radiation + i + 1,
        shortwaveRadiation: OFFSET.shortwave_radiation + i + 1,
        precipitation: OFFSET.precipitation + i + 1,
        precipitationProbability: OFFSET.precipitation_probability + i + 1,
      })
    })
  })

  it('leaves the preceding-hour variables of the last hour unknown rather than guessing', () => {
    expect(forecast.hours[23]).toEqual({
      time: '2026-10-12T23:00',
      cloudCover: OFFSET.cloud_cover + 23,
      temperature: OFFSET.temperature_2m + 23,
      directRadiation: null,
      shortwaveRadiation: null,
      precipitation: null,
      precipitationProbability: null,
    })
  })

  it('maps a slider time to the hour that contains it', () => {
    expect(hourAt(forecast, 14 * 60 + 35)?.time).toBe('2026-10-12T14:00')
    expect(hourAt(forecast, 15 * 60)?.time).toBe('2026-10-12T15:00')
  })

  it('turns missing values and missing variables into null', () => {
    const data = fixture()
    data.hourly!.cloud_cover![14] = null
    data.hourly!.direct_radiation![15] = null
    delete data.hourly!.temperature_2m
    const hour = parseHourly(data).hours[14]
    expect(hour.cloudCover).toBeNull()
    expect(hour.directRadiation).toBeNull()
    expect(hour.temperature).toBeNull()
    expect(hour.shortwaveRadiation).toBe(OFFSET.shortwave_radiation + 15)
  })

  it('rejects a response without hourly data', () => {
    expect(() => parseHourly({ timezone: 'Europe/Athens' })).toThrow(/no hourly data/)
  })
})

describe('fetchForecast', () => {
  afterEach(() => vi.unstubAllGlobals())

  const respond = () =>
    vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(fixture()), { status: 200 }))

  it('asks for one local day in the place timezone and parses it with the row rule', async () => {
    const fetchMock = respond()
    vi.stubGlobal('fetch', fetchMock)
    const forecast = await fetchForecast(11.111, 22.222, '2026-10-12')

    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('timezone')).toBe('auto')
    expect(url.searchParams.get('start_date')).toBe('2026-10-12')
    expect(url.searchParams.get('end_date')).toBe('2026-10-12')
    expect(url.searchParams.get('hourly')?.split(',').sort()).toEqual(Object.keys(OFFSET).sort())
    expect(forecast.hours[14].directRadiation).toBe(OFFSET.direct_radiation + 15)
    expect(forecast.hours[14].cloudCover).toBe(OFFSET.cloud_cover + 14)
  })

  it('caches per (lat, lon, date)', async () => {
    const fetchMock = respond()
    vi.stubGlobal('fetch', fetchMock)
    await fetchForecast(33.333, 44.444, '2026-10-12')
    await fetchForecast(33.334, 44.441, '2026-10-12') // same 0.01 degree cell
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await fetchForecast(33.333, 44.444, '2026-10-13')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure', async () => {
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: true, reason: 'boom' }), { status: 400 }))
    vi.stubGlobal('fetch', failing)
    await expect(fetchForecast(55.555, 66.666, '2026-10-12')).rejects.toThrow('boom')
    const fetchMock = respond()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchForecast(55.555, 66.666, '2026-10-12')).resolves.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
