import { compassPoint, type SunPosition } from './sun'

/**
 * Text for the sun direction indicator, e.g. "Sun from SW, 25° up, 48% strength".
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

/** Parts of the map area covered by other UI (the panel), in pixels. */
export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Where to draw the sun icon: on an ellipse inside the free part of the map,
 * in the screen direction the sunlight comes from. `angleRad` is that
 * direction as a screen angle (0 = right, PI/2 = down, as in CSS).
 */
export function sunIndicatorPosition(
  angleRad: number,
  width: number,
  height: number,
  insets: Insets,
  margin = 120,
): { x: number; y: number } {
  const freeWidth = Math.max(0, width - insets.left - insets.right)
  const freeHeight = Math.max(0, height - insets.top - insets.bottom)
  const radiusX = Math.max(30, freeWidth / 2 - margin)
  const radiusY = Math.max(30, freeHeight / 2 - margin)
  return {
    x: insets.left + freeWidth / 2 + radiusX * Math.cos(angleRad),
    y: insets.top + freeHeight / 2 + radiusY * Math.sin(angleRad),
  }
}
