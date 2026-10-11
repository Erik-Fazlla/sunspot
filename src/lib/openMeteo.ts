import type { HourWeather } from './weatherLabel'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const HOURLY_VARIABLES = [
  'cloud_cover',
  'precipitation_probability',
  'precipitation',
  'temperature_2m',
  'direct_radiation',
  'shortwave_radiation',
] as const

export interface Forecast {
  /** IANA timezone Open-Meteo resolved for the coordinates. */
  timezone: string
  /** The 24 hours of the requested date, in that timezone. */
  hours: HourWeather[]
}

interface ForecastResponse {
  timezone: string
  hourly?: { time: string[] } & Record<(typeof HOURLY_VARIABLES)[number], (number | null)[] | undefined>
  error?: boolean
  reason?: string
}

// In-memory caches. Coordinates are rounded to 0.01 degrees (about 1 km, finer
// than the forecast grid) so nearby clicks share one request.
const forecastCache = new Map<string, Promise<Forecast>>()
const timezoneCache = new Map<string, Promise<string>>()

export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100
}

export function forecastCacheKey(lat: number, lon: number, date: string): string {
  return `${roundCoord(lat)},${roundCoord(lon)},${date}`
}

async function request(params: Record<string, string>): Promise<ForecastResponse> {
  const response = await fetch(`${FORECAST_URL}?${new URLSearchParams(params)}`)
  const data = (await response.json().catch(() => null)) as ForecastResponse | null
  if (!response.ok || !data || data.error) {
    throw new Error(data?.reason ?? `Open-Meteo request failed (${response.status})`)
  }
  return data
}

/**
 * Cloud cover is a snapshot on the hour. Averaging it with the next snapshot
 * gives a value for the hour in between, matching the radiation means.
 */
function hourMean(atStart: number | null | undefined, atEnd: number | null | undefined): number | null {
  if (atStart == null) return atEnd ?? null
  return atEnd == null ? atStart : (atStart + atEnd) / 2
}

/** Hourly forecast for one date at a place, cached per (lat, lon, date). */
export function fetchForecast(lat: number, lon: number, date: string): Promise<Forecast> {
  const key = forecastCacheKey(lat, lon, date)
  const cached = forecastCache.get(key)
  if (cached) return cached
  const pending = request({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    hourly: HOURLY_VARIABLES.join(','),
    // "auto" returns hours in the place's own timezone, so nothing here is UTC.
    timezone: 'auto',
    start_date: date,
    end_date: date,
  }).then((data): Forecast => {
    const hourly = data.hourly
    if (!hourly?.time?.length) throw new Error('Open-Meteo returned no hourly data for this date')
    return {
      timezone: data.timezone,
      hours: hourly.time.map((time, i) => ({
        time,
        cloudCover: hourMean(hourly.cloud_cover?.[i], hourly.cloud_cover?.[i + 1]),
        // Open-Meteo reports these four as totals, means or chances for the hour that
        // *ends* at the timestamp. Reading the next row turns them into values
        // for the hour that *starts* at `time`, like everything else here.
        // The 23:00 row has no successor on a one-day request, so it is null.
        precipitationProbability: hourly.precipitation_probability?.[i + 1] ?? null,
        precipitation: hourly.precipitation?.[i + 1] ?? null,
        directRadiation: hourly.direct_radiation?.[i + 1] ?? null,
        shortwaveRadiation: hourly.shortwave_radiation?.[i + 1] ?? null,
        temperature: hourly.temperature_2m?.[i] ?? null,
      })),
    }
  })
  forecastCache.set(key, pending)
  // A failed request must not poison the cache: let the next call retry.
  pending.catch(() => forecastCache.delete(key))
  return pending
}

/** IANA timezone of a coordinate, used when a place did not come with one. */
export function fetchTimezone(lat: number, lon: number): Promise<string> {
  const key = `${roundCoord(lat)},${roundCoord(lon)}`
  const cached = timezoneCache.get(key)
  if (cached) return cached
  const pending = request({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    current: 'temperature_2m',
    timezone: 'auto',
  }).then((data) => data.timezone)
  timezoneCache.set(key, pending)
  pending.catch(() => timezoneCache.delete(key))
  return pending
}

/**
 * Forecast hour covering `minutes` after midnight (14:35 -> the 14:00 row).
 * Null when the forecast has no such hour.
 */
export function hourAt(forecast: Forecast, minutes: number): HourWeather | null {
  return forecast.hours[Math.floor(minutes / 60)] ?? null
}
