import SunCalc from 'suncalc'
import { MAX_SHADOW_LENGTH_M } from './constants'
import { zonedToUtc } from './time'

const DEG = 180 / Math.PI

export interface SunPosition {
  /** Height above the horizon; zero or negative means the sun is down. */
  altitudeRad: number
  altitudeDeg: number
  /** Compass bearing of the sun: 0 = north, 90 = east, 180 = south, 270 = west. */
  bearingDeg: number
}

/**
 * SunCalc 1.x (pinned in package.json) measures azimuth from SOUTH, positive toward the west, in radians
 * (0 = south, +PI/2 = west, -PI/2 = east). Compass bearings start at north
 * and run clockwise, so the two differ by half a turn.
 */
export function azimuthToBearing(azimuthRad: number): number {
  return (((azimuthRad * DEG + 180) % 360) + 360) % 360
}

export function getSunPosition(instant: Date, lat: number, lon: number): SunPosition {
  const { altitude, azimuth } = SunCalc.getPosition(instant, lat, lon)
  return {
    altitudeRad: altitude,
    altitudeDeg: altitude * DEG,
    bearingDeg: azimuthToBearing(azimuth),
  }
}

/**
 * Length of the shadow a `heightM` tall object casts on flat ground.
 * Zero when the sun is at or below the horizon; capped when it is very low,
 * because height / tan(altitude) grows without bound near sunrise and sunset.
 */
export function shadowLength(heightM: number, altitudeRad: number, maxLengthM = MAX_SHADOW_LENGTH_M): number {
  if (altitudeRad <= 0 || heightM <= 0) return 0
  return Math.min(heightM / Math.tan(altitudeRad), maxLengthM)
}

/** Shadows point directly away from the sun. */
export function shadowBearing(sunBearingDeg: number): number {
  return (sunBearingDeg + 180) % 360
}

/** Ground displacement (metres east / north) of the tip of a shadow, or null when there is none. */
export function shadowVector(
  heightM: number,
  sun: Pick<SunPosition, 'altitudeRad' | 'bearingDeg'>,
): { east: number; north: number } | null {
  const length = shadowLength(heightM, sun.altitudeRad)
  if (length === 0) return null
  const bearing = shadowBearing(sun.bearingDeg) / DEG
  return { east: length * Math.sin(bearing), north: length * Math.cos(bearing) }
}

export interface SunTimes {
  sunrise: Date | null
  sunset: Date | null
}

/** Sunrise and sunset for a calendar date in the place's timezone (null during polar day/night). */
export function getSunTimes(dateStr: string, timeZone: string, lat: number, lon: number): SunTimes {
  // Local noon pins SunCalc to the right calendar day wherever the place is.
  const times = SunCalc.getTimes(zonedToUtc(dateStr, 12 * 60, timeZone), lat, lon)
  const valid = (d: Date) => (Number.isNaN(d.getTime()) ? null : d)
  return { sunrise: valid(times.sunrise), sunset: valid(times.sunset) }
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** 215 -> "SW" */
export function compassPoint(bearingDeg: number): string {
  return COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]
}
