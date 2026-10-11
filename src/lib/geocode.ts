/** A location the planner is focused on. `timezone` is an IANA name when known. */
export interface Place {
  lat: number
  lon: number
  label: string
  timezone?: string
}

export interface PlaceResult extends Place {
  id: number
  /** Region and country, shown under the name in the result list. */
  detail: string
}

interface GeocodingResponse {
  results?: {
    id: number
    name: string
    latitude: number
    longitude: number
    timezone?: string
    admin1?: string
    country?: string
  }[]
}

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

/** Place search through the Open-Meteo geocoding API (free, no key). */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' })
  const response = await fetch(`${GEOCODING_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`Place search failed (${response.status})`)
  const data = (await response.json()) as GeocodingResponse
  return (data.results ?? []).map((r) => ({
    id: r.id,
    lat: r.latitude,
    lon: r.longitude,
    label: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    timezone: r.timezone,
  }))
}
