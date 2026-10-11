import { useCallback, useEffect, useState } from 'react'
import { fetchForecast, fetchTimezone, forecastCacheKey, type Forecast } from '../lib/openMeteo'

export type ForecastState =
  | { status: 'out-of-range' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'ready'; forecast: Forecast }

/**
 * Hourly forecast for a place and date. `enabled` is false when the date is
 * outside the forecast range, in which case nothing is fetched.
 */
export function useForecast(lat: number, lon: number, date: string, enabled: boolean): ForecastState {
  const key = forecastCacheKey(lat, lon, date)
  const [result, setResult] = useState<{ key: string; forecast?: Forecast; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetchForecast(lat, lon, date)
      .then((forecast) => {
        if (!cancelled) setResult({ key, forecast })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Could not load the forecast'
        setResult({ key, error: message })
      })
    return () => {
      cancelled = true
    }
    // `key` stands in for lat, lon and date (rounded the way the cache rounds them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt])

  if (!enabled) return { status: 'out-of-range' }
  // A result for another place or date is stale: show loading until ours arrives.
  if (!result || result.key !== key) return { status: 'loading' }
  if (result.forecast) return { status: 'ready', forecast: result.forecast }
  return { status: 'error', message: result.error ?? 'Could not load the forecast', retry }
}

/** Timezone looked up from coordinates; null until known (or if the lookup fails). */
export function useTimezone(lat: number, lon: number, known: string | undefined): string | null {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const [found, setFound] = useState<{ key: string; timezone: string } | null>(null)

  useEffect(() => {
    if (known) return
    let cancelled = false
    fetchTimezone(lat, lon)
      .then((timezone) => {
        if (!cancelled) setFound({ key, timezone })
      })
      .catch(() => {
        // Keep the default timezone; the forecast panel reports network errors.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, known])

  if (known) return known
  return found?.key === key ? found.timezone : null
}
