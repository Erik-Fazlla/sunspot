// Where the map opens each time the app starts: wherever the user is, or one
// fixed place they picked. Asked once, on the first visit, and kept in the
// browser's storage on this device.

import type { Place } from './geocode'

export type StartChoice = { mode: 'gps' } | { mode: 'place'; place: Place }

export const START_STORAGE_KEY = 'sunspot:start'

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

/** Reads a stored choice. Null for nothing stored or anything that is not a valid choice. */
export function parseStartChoice(stored: string | null): StartChoice | null {
  if (!stored) return null
  let data: unknown
  try {
    data = JSON.parse(stored)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { mode, place } = data as { mode?: unknown; place?: unknown }
  if (mode === 'gps') return { mode: 'gps' }
  if (mode !== 'place' || typeof place !== 'object' || place === null) return null
  const { lat, lon, label, timezone } = place as Record<string, unknown>
  if (!isCoordinate(lat, 90) || !isCoordinate(lon, 180)) return null
  if (typeof label !== 'string' || label.trim() === '') return null
  return {
    mode: 'place',
    place: { lat, lon, label, ...(typeof timezone === 'string' && timezone ? { timezone } : {}) },
  }
}

export function formatStartChoice(choice: StartChoice): string {
  return JSON.stringify(choice)
}

/** The stored choice, or null on a first visit or when storage is blocked. */
export function readStartChoice(): StartChoice | null {
  try {
    return parseStartChoice(window.localStorage.getItem(START_STORAGE_KEY))
  } catch {
    return null
  }
}

export function writeStartChoice(choice: StartChoice): void {
  try {
    window.localStorage.setItem(START_STORAGE_KEY, formatStartChoice(choice))
  } catch {
    // The choice still applies for this visit; the question comes back next time.
  }
}

/** Short text for the choice, e.g. "My location" or "Athens, Greece". */
export function startChoiceLabel(choice: StartChoice): string {
  return choice.mode === 'gps' ? 'My location' : choice.place.label
}

/** True when `place` is the saved start place. */
export function isStartPlace(choice: StartChoice | null, place: Pick<Place, 'lat' | 'lon'>): boolean {
  return (
    choice?.mode === 'place' &&
    Math.abs(choice.place.lat - place.lat) < 1e-6 &&
    Math.abs(choice.place.lon - place.lon) < 1e-6
  )
}
