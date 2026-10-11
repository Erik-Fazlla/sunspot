// Street furniture (benches, trees, street lamps) from OpenStreetMap, fetched
// through the public Overpass API. These servers are free, shared and run by
// volunteers, so everything here is built to ask rarely and ask small:
// one request per map area, cached, capped in size, never retried in a loop.

/** Tried in order; the second is only used when the first fails. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
] as const

/** Street details are only requested when zoomed in this far. */
export const STREET_DETAILS_MIN_ZOOM = 16
/** Request boxes snap outward to this grid, so small pans reuse the cache. */
export const FURNITURE_GRID_DEG = 0.004
/** Largest box ever requested, per side (about 1.3 km east-west and 1.8 km north-south at Athens). */
export const FURNITURE_MAX_SPAN_DEG = 0.016
/** Server-side time limit written into the query, seconds. */
export const OVERPASS_QUERY_TIMEOUT_S = 10
/** How long the browser waits for one server before trying the next, ms. */
export const OVERPASS_CLIENT_TIMEOUT_MS = 8_000
/** Most elements a response may carry. */
export const OVERPASS_MAX_ELEMENTS = 4000

export const TREE_DEFAULT_HEIGHT_M = 8
export const TREE_DEFAULT_CROWN_RADIUS_M = 3
export const LAMP_DEFAULT_HEIGHT_M = 6

/** [west, south, east, north] in degrees. */
export type LonLatBox = [number, number, number, number]

export interface Bench {
  id: number
  lon: number
  lat: number
}

export interface Tree extends Bench {
  /** Total height, metres. */
  height: number
  /** Canopy radius, metres. */
  crownRadius: number
}

export interface Lamp extends Bench {
  height: number
}

export interface StreetFurniture {
  benches: Bench[]
  trees: Tree[]
  lamps: Lamp[]
}

/**
 * The box to request for a view: the view's bounding box, shrunk around the
 * centre to at most FURNITURE_MAX_SPAN_DEG per side, then snapped outward to
 * the grid. A pitched view can see kilometres into the distance; this keeps
 * the request to the neighbourhood around the centre.
 */
export function furnitureBBox(view: LonLatBox, center: [number, number]): LonLatBox {
  const half = FURNITURE_MAX_SPAN_DEG / 2
  const west = Math.max(view[0], center[0] - half)
  const south = Math.max(view[1], center[1] - half)
  const east = Math.min(view[2], center[0] + half)
  const north = Math.min(view[3], center[1] + half)
  const down = (value: number) => Math.floor(value / FURNITURE_GRID_DEG) * FURNITURE_GRID_DEG
  const up = (value: number) => Math.ceil(value / FURNITURE_GRID_DEG) * FURNITURE_GRID_DEG
  const round = (value: number) => Math.round(value * 1e6) / 1e6
  return [round(down(west)), round(down(south)), round(up(east)), round(up(north))]
}

/** Cache key for a request box. */
export function bboxKey(box: LonLatBox): string {
  return box.map((value) => value.toFixed(3)).join(',')
}

/** Overpass QL for the three kinds of node in a box. Overpass wants south, west, north, east. */
export function buildOverpassQuery([west, south, east, north]: LonLatBox): string {
  const box = `(${south},${west},${north},${east})`
  return (
    `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];` +
    `(node["amenity"="bench"]${box};node["natural"="tree"]${box};node["highway"="street_lamp"]${box};);` +
    `out body qt ${OVERPASS_MAX_ELEMENTS};`
  )
}

/** "8", "8.5 m", "8m" -> metres. Null for anything else (feet, ranges, words). */
export function parseMetres(value: string | undefined): number | null {
  if (!value) return null
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(m|metres?|meters?)?\s*$/i.exec(value)
  if (!match) return null
  const metres = Number.parseFloat(match[1].replace(',', '.'))
  return Number.isFinite(metres) && metres > 0 ? metres : null
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

export interface OverpassResponse {
  elements?: OverpassElement[]
}

/** Sort an Overpass response into benches, trees and lamps, filling in missing sizes. */
export function parseOverpass(data: OverpassResponse): StreetFurniture {
  const furniture: StreetFurniture = { benches: [], trees: [], lamps: [] }
  for (const element of data.elements ?? []) {
    if (element.type !== 'node' || typeof element.lat !== 'number' || typeof element.lon !== 'number') continue
    const tags = element.tags ?? {}
    const position = { id: element.id, lon: element.lon, lat: element.lat }
    if (tags.amenity === 'bench') {
      furniture.benches.push(position)
    } else if (tags.natural === 'tree') {
      const crownDiameter = parseMetres(tags.diameter_crown)
      furniture.trees.push({
        ...position,
        // Clamped: a typo such as height=800 must not shade a whole district.
        height: clamp(parseMetres(tags.height) ?? TREE_DEFAULT_HEIGHT_M, 2, 40),
        crownRadius: clamp(crownDiameter ? crownDiameter / 2 : TREE_DEFAULT_CROWN_RADIUS_M, 0.5, 15),
      })
    } else if (tags.highway === 'street_lamp') {
      furniture.lamps.push({
        ...position,
        height: clamp(parseMetres(tags.height) ?? LAMP_DEFAULT_HEIGHT_M, 2, 20),
      })
    }
  }
  return furniture
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

async function queryOverpass(query: string, fetchImpl: Fetch): Promise<StreetFurniture> {
  let lastError: unknown = new Error('No Overpass server configured')
  // One attempt per server, in order. No retry loop: if both are busy, give up quietly.
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchImpl(`${endpoint}?data=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(OVERPASS_CLIENT_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`Overpass answered ${response.status}`)
      const data = (await response.json()) as OverpassResponse
      if (!Array.isArray(data.elements)) throw new Error('Overpass sent no element list')
      return parseOverpass(data)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

const cache = new Map<string, Promise<StreetFurniture>>()

/**
 * Street furniture for a request box (see `furnitureBBox`), cached in memory
 * by that box. Falls back to the second server when the first fails.
 */
export function fetchStreetFurniture(box: LonLatBox, fetchImpl: Fetch = fetch): Promise<StreetFurniture> {
  const key = bboxKey(box)
  const cached = cache.get(key)
  if (cached) return cached
  const pending = queryOverpass(buildOverpassQuery(box), fetchImpl)
  cache.set(key, pending)
  // A failure is not cached, so a later visit to the same area asks again.
  pending.catch(() => cache.delete(key))
  return pending
}
