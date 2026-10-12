import { compassPoint, type SunPosition } from './sun'

/**
 * Text shown next to the sun on its path, e.g. "Sun from SW, 25° up, 48% strength".
 * `strength` is the sunFactor (0 to 1) for the hour, or null when there is no
 * forecast, in which case the cloud effect is left out rather than guessed.
 */
export function sunDirectionLabel(
  sun: Pick<SunPosition, 'altitudeDeg' | 'bearingDeg'>,
  strength: number | null,
): string {
  if (sun.altitudeDeg <= 0) return 'Sun below the horizon'
  const base = `Sun from ${compassPoint(sun.bearingDeg)}, ${Math.round(sun.altitudeDeg)}° up`
  if (strength === null || !Number.isFinite(strength)) return base
  const percent = Math.round(Math.min(1, Math.max(0, strength)) * 100)
  return `${base}, ${percent}% strength`
}
