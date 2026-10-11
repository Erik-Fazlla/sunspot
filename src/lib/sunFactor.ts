import { getSunPosition } from './sun'
import { zonedToUtc } from './time'
import type { HourWeather } from './weatherLabel'

/** Solar irradiance at the top of the atmosphere, W/m2. */
const SOLAR_CONSTANT_WM2 = 1361
/** Share of the direct beam that survives one air mass of clear, clean air. */
const CLEAR_SKY_TRANSMITTANCE = 0.7
/**
 * Below this clear-sky value (sun under about 3 degrees) the ratio divides two
 * tiny, noisy numbers, so cloud cover is used instead.
 */
export const MIN_CLEAR_SKY_DIRECT_WM2 = 30

/**
 * Clear-sky direct radiation on a horizontal surface, W/m2, for a sun
 * `altitudeRad` above the horizon (Meinel & Meinel 1976):
 *
 *   airMass      = 1 / sin(altitude)
 *   directNormal = 1361 * 0.7 ^ (airMass ^ 0.678)
 *   horizontal   = directNormal * sin(altitude)
 */
export function clearSkyDirectHorizontal(altitudeRad: number): number {
  if (altitudeRad <= 0) return 0
  const sinAltitude = Math.sin(altitudeRad)
  const airMass = 1 / sinAltitude
  return SOLAR_CONSTANT_WM2 * CLEAR_SKY_TRANSMITTANCE ** (airMass ** 0.678) * sinAltitude
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * How much of the clear-sky direct beam gets through the weather, 0 to 1.
 *
 *   sunFactor = forecast direct_radiation / clear-sky direct radiation
 *
 * clamped to [0, 1]. When the forecast has no direct radiation, or the sun is
 * too low for the ratio to mean anything, it falls back to
 *
 *   sunFactor = 1 - cloud_cover / 100
 *
 * and to 1 (assume clear) when cloud cover is missing too.
 */
export function sunFactor(
  hour: Pick<HourWeather, 'directRadiation' | 'cloudCover'>,
  altitudeRad: number,
): number {
  const clearSky = clearSkyDirectHorizontal(altitudeRad)
  if (hour.directRadiation !== null && clearSky >= MIN_CLEAR_SKY_DIRECT_WM2) {
    return clamp01(hour.directRadiation / clearSky)
  }
  if (hour.cloudCover !== null) return clamp01(1 - hour.cloudCover / 100)
  return 1
}

/**
 * sunFactor for one forecast hour at a place. The forecast's radiation is the
 * mean over the hour starting at `hour.time`, so the clear-sky estimate uses
 * the sun's height at the middle of that hour.
 */
export function hourSunFactor(hour: HourWeather, lat: number, lon: number, timeZone: string): number {
  const date = hour.time.slice(0, 10)
  const minutes = Number(hour.time.slice(11, 13)) * 60 + 30
  const sun = getSunPosition(zonedToUtc(date, minutes, timeZone), lat, lon)
  return sunFactor(hour, sun.altitudeRad)
}
