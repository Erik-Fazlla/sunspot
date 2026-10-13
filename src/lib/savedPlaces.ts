// Places saved for use without a connection. Saving a place stores, on the
// device, the map around it (tiles, which include the buildings), the map's
// style, fonts and icons, and the forecast for the coming days. The list of
// saved places itself lives in localStorage.

import { MAP_STYLE_URL } from './constants'
import type { Place } from './geocode'
import { keepStorage, removeFromStore, saveToStore, storedFetch } from './mapCache'
import {
  fillTileUrl,
  fontStacks,
  glyphUrls,
  SAVE_RADIUS_M,
  spriteUrls,
  tilesForArea,
} from './offlineArea'
import { fetchForecast } from './openMeteo'

export interface SavedPlace {
  id: string
  label: string
  lat: number
  lon: number
  timezone?: string
  /** When it was saved, as an ISO timestamp. */
  savedAt: string
  /** Store names of its files, so they can be removed with it. */
  keys: string[]
  bytes: number
}

export const SAVED_PLACES_KEY = 'sunspot:saved-places'
/** Days of forecast kept with a saved place, starting today. */
export const SAVED_FORECAST_DAYS = 7

/** One saved place per spot: coordinates rounded to about 100 m. */
export function savedPlaceId(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

/** Reads the stored list, dropping anything that is not a complete saved place. */
export function parseSavedPlaces(stored: string | null): SavedPlace[] {
  if (!stored) return []
  let data: unknown
  try {
    data = JSON.parse(stored)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const places: SavedPlace[] = []
  for (const entry of data as Record<string, unknown>[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { label, lat, lon, timezone, savedAt, keys, bytes } = entry
    if (!isCoordinate(lat, 90) || !isCoordinate(lon, 180)) continue
    if (typeof label !== 'string' || !label.trim() || typeof savedAt !== 'string') continue
    places.push({
      id: savedPlaceId(lat, lon),
      label,
      lat,
      lon,
      ...(typeof timezone === 'string' && timezone ? { timezone } : {}),
      savedAt,
      keys: Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [],
      bytes: typeof bytes === 'number' && bytes > 0 ? bytes : 0,
    })
  }
  return places
}

export function readSavedPlaces(): SavedPlace[] {
  try {
    return parseSavedPlaces(window.localStorage.getItem(SAVED_PLACES_KEY))
  } catch {
    return []
  }
}

export function writeSavedPlaces(places: SavedPlace[]): void {
  try {
    window.localStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(places))
  } catch {
    // The list stays for this visit only.
  }
}

/** The list with `place` added, replacing an earlier save of the same spot. Newest first. */
export function withSavedPlace(places: SavedPlace[], place: SavedPlace): SavedPlace[] {
  return [place, ...places.filter((other) => other.id !== place.id)]
}

/**
 * The files of `removed` that no remaining place uses. Neighbouring places
 * share map tiles, and every place shares the style, fonts and icons.
 */
export function unsharedKeys(removed: SavedPlace, remaining: SavedPlace[]): string[] {
  const inUse = new Set(remaining.flatMap((place) => place.keys))
  return removed.keys.filter((key) => !inUse.has(key))
}

/** "2.4 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface StyleJson {
  sources?: Record<string, { url?: string; tiles?: string[] } | undefined>
  glyphs?: string
  sprite?: string
  layers?: { layout?: Record<string, unknown> }[]
}

/** The addresses of every file the map needs to draw the area around a place. */
export async function mapFilesFor(lat: number, lon: number): Promise<string[]> {
  const style = (await (await storedFetch(MAP_STYLE_URL)).json()) as StyleJson
  const indexUrl = style.sources?.openmaptiles?.url
  if (!indexUrl) throw new Error('The map style has no tile source to save')
  const index = (await (await storedFetch(indexUrl)).json()) as { tiles?: string[] }
  const template = index.tiles?.[0]
  if (!template) throw new Error('The map’s tile index is empty')
  return [
    MAP_STYLE_URL,
    indexUrl,
    ...(style.sprite ? spriteUrls(style.sprite) : []),
    ...(style.glyphs ? glyphUrls(style.glyphs, fontStacks(style)) : []),
    ...tilesForArea(lat, lon, SAVE_RADIUS_M).map((tile) => fillTileUrl(template, tile)),
  ]
}

/**
 * Save the area around a place for offline use. Rejects when the map files
 * cannot be fetched; a missing forecast alone does not stop the save.
 * `dates` are the days (YYYY-MM-DD) whose forecast is kept.
 */
export async function savePlaceOffline(
  place: Place,
  dates: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<SavedPlace> {
  keepStorage()
  const urls = await mapFilesFor(place.lat, place.lon)
  const total = urls.length + dates.length
  const result = await saveToStore(urls, (done) => onProgress?.(done, total))
  if (result.failed > 0) throw new Error(`${result.failed} of ${urls.length} map files could not be saved`)
  // Fetching a forecast also keeps it on the device (see openMeteo.ts).
  let done = urls.length
  await Promise.all(
    dates.map((date) =>
      fetchForecast(place.lat, place.lon, date)
        .catch(() => null)
        .then(() => onProgress?.(++done, total)),
    ),
  )
  return {
    id: savedPlaceId(place.lat, place.lon),
    label: place.label,
    lat: place.lat,
    lon: place.lon,
    ...(place.timezone ? { timezone: place.timezone } : {}),
    savedAt: new Date().toISOString(),
    keys: result.keys,
    bytes: result.bytes,
  }
}

/** Remove a saved place's files, keeping those other saved places still need. */
export function forgetPlaceOffline(removed: SavedPlace, remaining: SavedPlace[]): Promise<void> {
  return removeFromStore(unsharedKeys(removed, remaining))
}
