import { recallJson, rememberJson } from './mapCache'
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
  /** Set when this is a copy kept on the device because the network did not answer: when it was fetched. */
  savedAt?: string
}

export interface ForecastResponse {
  timezone: string
  /** Added here, not by Open-Meteo: see `Forecast.savedAt`. */
  savedAt?: string
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
  const url = `${FORECAST_URL}?${new URLSearchParams(params)}`
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    // No connection: an answer kept on the device from an earlier time will do.
    const kept = await recallJson<ForecastResponse>(url)
    if (kept) return { ...kept.data, savedAt: kept.savedAt }
    throw error
  }
  const data = (await response.json().catch(() => null)) as ForecastResponse | null
  if (!response.ok || !data || data.error) {
    throw new Error(data?.reason ?? `Open-Meteo request failed (${response.status})`)
  }
  void rememberJson(url, data)
  return data
}

/**
 * Turn an Open-Meteo hourly block into forecast hours, reading each variable
 * from the row that describes the hour starting at the timestamp.
 *
 * Open-Meteo uses two conventions:
 *
 * - Snapshots (cloud_cover, temperature_2m) are instantaneous values at the
 *   timestamp: read row i.
 * - Preceding-hour values (direct_radiation, shortwave_radiation,
 *   precipitation, precipitation_probability) are a mean, total or chance for
 *   the hour that ENDS at the timestamp. The hour that starts at row i is
 *   therefore described by row i + 1.
 *
 * The last row has no successor on a one-day request, so its preceding-hour
 * fields are null (23:00 to midnight: dark almost everywhere).
 */
export function parseHourly(data: ForecastResponse): Forecast {
  const hourly = data.hourly
  if (!hourly?.time?.length) throw new Error('Open-Meteo returned no hourly data for this date')
  return {
    timezone: data.timezone,
    ...(data.savedAt ? { savedAt: data.savedAt } : {}),
    hours: hourly.time.map((time, i) => ({
      time,
      cloudCover: hourly.cloud_cover?.[i] ?? null,
      temperature: hourly.temperature_2m?.[i] ?? null,
      precipitationProbability: hourly.precipitation_probability?.[i + 1] ?? null,
      precipitation: hourly.precipitation?.[i + 1] ?? null,
      directRadiation: hourly.direct_radiation?.[i + 1] ?? null,
      shortwaveRadiation: hourly.shortwave_radiation?.[i + 1] ?? null,
    })),
  }
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
  }).then(parseHourly)
  forecastCache.set(key, pending)
  // A failed request must not poison the cache: let the next call retry. Nor
  // must an old copy from the device: the next call should try the network again.
  pending.then(
    (forecast) => {
      if (forecast.savedAt) forecastCache.delete(key)
    },
    () => forecastCache.delete(key),
  )
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
