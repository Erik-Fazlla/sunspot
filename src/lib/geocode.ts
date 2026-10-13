/** A location the planner is focused on. `timezone` is an IANA name when known. */
export interface Place {
  lat: number
  lon: number
  label: string
  timezone?: string
}

export interface PlaceResult extends Place {
  id: string
  /** Street, area and country, shown under the name in the result list. */
  detail: string
}

// Search goes to Photon first: free, no key, built on OpenStreetMap, so it
// knows streets and addresses and understands names in any script, Greek
// included. If Photon cannot be reached, the Open-Meteo city search stands in.
const PHOTON_URL = 'https://photon.komoot.io/api/'
const OPEN_METEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const RESULT_COUNT = 6
/** How strongly results near the map are preferred: about a region, not a street. */
const NEARBY_ZOOM = 10

/** What Photon returns for one place (only the fields used here). */
export interface PhotonFeature {
  geometry?: { coordinates?: number[] }
  properties?: {
    osm_type?: string
    osm_id?: number
    type?: string
    name?: string
    street?: string
    housenumber?: string
    district?: string
    city?: string
    county?: string
    state?: string
    country?: string
  }
}

/**
 * Which language Photon should answer in. A query typed in Greek (or any
 * other non-Latin script) gets the places' own local names; Photon only
 * translates to a few languages, and English is used for everything else.
 */
export function photonLanguage(query: string): 'default' | 'en' {
  return /[Ͱ-￿]/.test(query) ? 'default' : 'en'
}

/** One search result from a Photon feature, or null when it has no usable name or position. */
export function parsePhotonFeature(feature: PhotonFeature): PlaceResult | null {
  const p = feature.properties ?? {}
  const [lon, lat] = feature.geometry?.coordinates ?? []
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  const address = [p.street, p.housenumber].filter(Boolean).join(' ')
  const label = p.name?.trim() || address
  if (!label) return null
  // A street or an address needs its neighbourhood to tell it from its namesakes.
  const local = p.type === 'street' || p.type === 'house'
  const parts = [address, local ? p.district : undefined, p.city ?? p.county ?? p.state, p.country]
  const detail = [...new Set(parts.filter((part): part is string => Boolean(part) && part !== label))]
  return {
    id: `${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lon}`}`,
    lat,
    lon,
    label,
    detail: detail.join(', '),
  }
}

/** Photon lists each stretch of a long street separately; one entry per name and area is enough. */
export function withoutRepeats(results: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = `${result.label}|${result.detail}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function searchPhoton(
  query: string,
  signal?: AbortSignal,
  near?: Pick<Place, 'lat' | 'lon'>,
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    q: query,
    // A few spare, since repeats are dropped afterwards.
    limit: String(RESULT_COUNT + 4),
    lang: photonLanguage(query),
  })
  if (near) {
    params.set('lat', near.lat.toFixed(4))
    params.set('lon', near.lon.toFixed(4))
    params.set('zoom', String(NEARBY_ZOOM))
  }
  const response = await fetch(`${PHOTON_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`Place search failed (${response.status})`)
  const data = (await response.json()) as { features?: PhotonFeature[] }
  const results = (data.features ?? []).map(parsePhotonFeature).filter((r): r is PlaceResult => r !== null)
  return withoutRepeats(results).slice(0, RESULT_COUNT)
}

interface OpenMeteoResponse {
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

/** City search through the Open-Meteo geocoding API: towns and cities only, names in English. */
async function searchOpenMeteo(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ name: query, count: String(RESULT_COUNT), language: 'en', format: 'json' })
  const response = await fetch(`${OPEN_METEO_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`Place search failed (${response.status})`)
  const data = (await response.json()) as OpenMeteoResponse
  return (data.results ?? []).map((r) => ({
    id: String(r.id),
    lat: r.latitude,
    lon: r.longitude,
    label: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    timezone: r.timezone,
  }))
}

/**
 * Place search: cities, areas, streets and addresses, in any language.
 * `near` is where the map is; places around it come first.
 */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  near?: Pick<Place, 'lat' | 'lon'>,
): Promise<PlaceResult[]> {
  try {
    return await searchPhoton(query, signal, near)
  } catch (error) {
    // A cancelled search is not a failure, and must not start another request.
    if (signal?.aborted) throw error
    return searchOpenMeteo(query, signal)
  }
}
