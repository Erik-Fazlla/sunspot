import { useEffect, useState } from 'react'
import {
  bboxKey,
  fetchStreetFurniture,
  furnitureBBox,
  STREET_DETAILS_MIN_ZOOM,
  type LonLatBox,
  type StreetFurniture,
} from '../lib/overpass'

/** What the map is looking at, reported after it stops moving. */
export interface MapViewState {
  zoom: number
  /** [west, south, east, north] */
  bounds: LonLatBox
  center: [number, number]
}

export type StreetDetailsStatus = 'off' | 'zoom' | 'loading' | 'ready' | 'unavailable'

export interface StreetDetails {
  status: StreetDetailsStatus
  /** The last furniture that loaded. Kept while a new area loads or fails, so the map never blanks. */
  furniture: StreetFurniture | null
}

/** Wait this long after the map settles before asking Overpass, so a string of pans costs one request. */
const REQUEST_DELAY_MS = 600

/**
 * Street furniture around the map centre. Never throws and never blocks:
 * a failed request only sets the status to "unavailable".
 */
export function useStreetFurniture(view: MapViewState | null, enabled: boolean): StreetDetails {
  const [loaded, setLoaded] = useState<{ key: string; furniture: StreetFurniture } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const zoomedIn = view !== null && view.zoom >= STREET_DETAILS_MIN_ZOOM
  const box = enabled && zoomedIn ? furnitureBBox(view.bounds, view.center) : null
  const key = box ? bboxKey(box) : null

  useEffect(() => {
    if (!box || !key || loaded?.key === key) return
    let cancelled = false
    const timer = setTimeout(() => {
      fetchStreetFurniture(box)
        .then((furniture) => {
          if (cancelled) return
          setLoaded({ key, furniture })
          setFailedKey(null)
        })
        .catch(() => {
          if (!cancelled) setFailedKey(key)
        })
    }, REQUEST_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `key` identifies `box`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!enabled) return { status: 'off', furniture: null }
  const furniture = loaded?.furniture ?? null
  if (!zoomedIn) return { status: 'zoom', furniture }
  if (loaded?.key === key) return { status: 'ready', furniture }
  if (failedKey === key) return { status: 'unavailable', furniture }
  return { status: 'loading', furniture }
}
