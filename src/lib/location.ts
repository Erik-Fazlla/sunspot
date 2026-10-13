// Finding where the user is. In a browser this is the page's own location
// request. Inside the Android app the request goes to Android itself through
// the Capacitor plugin: the web view's version gives up after a few seconds,
// often while the permission question is still on screen.

import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export type LocationFailure = 'denied' | 'switched-off' | 'unavailable'

/** What the user is told when the location cannot be found. */
export const LOCATION_MESSAGES: Record<LocationFailure, string> = {
  denied: 'Location permission was denied, so the map stays where it is.',
  'switched-off': 'Location is switched off on this device. Turn it on, or search for a place instead.',
  unavailable: 'Could not get your location. Search for a place instead.',
}

export class LocationError extends Error {
  readonly reason: LocationFailure
  /** What the device itself reported, for telling one failure from another. */
  readonly detail: string | null
  constructor(reason: LocationFailure, detail: string | null = null) {
    super(LOCATION_MESSAGES[reason])
    this.reason = reason
    this.detail = detail
  }
}

/** A phone may need a while for its first fix, more so indoors. */
const TIMEOUT_MS = 20_000
/** How long the quick, network-based attempt gets before GPS is tried. */
const QUICK_TIMEOUT_MS = 8_000
/** A position this recent is good enough to centre a map on. */
const MAX_AGE_MS = 10 * 60 * 1000

export interface Position {
  lat: number
  lon: number
}

/** The text a failed location request came with, if any. */
export function failureDetail(error: unknown): string | null {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

/** Turns whatever a location request failed with into one of the three reasons. */
export function locationFailure(error: unknown): LocationFailure {
  const details = error as { code?: unknown } | null
  const message = failureDetail(error) ?? ''
  if (/not enabled|disabled|switched off/i.test(message)) return 'switched-off'
  // Browsers report a denied permission as code 1.
  if (details?.code === 1 || /denied|permission/i.test(message)) return 'denied'
  return 'unavailable'
}

async function nativePosition(): Promise<Position> {
  // Asks Android for the permission if it has not been answered yet.
  const permission = await Geolocation.requestPermissions()
  if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') throw new LocationError('denied')
  const attempt = (enableHighAccuracy: boolean, timeout: number) =>
    Geolocation.getCurrentPosition({ enableHighAccuracy, timeout, maximumAge: MAX_AGE_MS })
  try {
    // Wi-Fi and mobile masts first: quick, and precise enough to centre a map.
    const { coords } = await attempt(false, QUICK_TIMEOUT_MS)
    return { lat: coords.latitude, lon: coords.longitude }
  } catch (error) {
    if (locationFailure(error) !== 'unavailable') throw error
    // Some phones have that switched off and only answer through GPS.
    const { coords } = await attempt(true, TIMEOUT_MS)
    return { lat: coords.latitude, lon: coords.longitude }
  }
}

function browserPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError('unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      reject,
      { timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    )
  })
}

/** Where the device is now. Rejects with a `LocationError` that says why not. */
export async function currentPosition(): Promise<Position> {
  try {
    return await (Capacitor.isNativePlatform() ? nativePosition() : browserPosition())
  } catch (error) {
    throw error instanceof LocationError ? error : new LocationError(locationFailure(error), failureDetail(error))
  }
}
