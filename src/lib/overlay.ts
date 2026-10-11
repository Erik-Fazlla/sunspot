/** Colour of the sunlight overlay: a warm yellow that reads clearly over the muted basemap. */
export const SUNLIGHT_COLOR = '#ffc21f'
/**
 * Overlay opacity while the sun is up and the sky is fully overcast. A floor,
 * so that turning the overlay on always shows something during the day.
 */
export const SUNLIGHT_MIN_OPACITY = 0.12
/** Overlay opacity under a clear sky (sunFactor 1). */
export const SUNLIGHT_MAX_OPACITY = 0.35

/** Shadow darkness under a clear sky. */
export const SHADOW_MAX_OPACITY = 0.42
/** Share of that darkness kept under full cloud, so the geometry stays readable. */
export const SHADOW_MIN_SHARE = 0.25

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

/**
 * Opacity of the sunlight overlay.
 *
 *   sun down                  0
 *   sun up, sunFactor 0       SUNLIGHT_MIN_OPACITY (0.12)
 *   sun up, sunFactor 1       SUNLIGHT_MAX_OPACITY (0.35)
 *
 * and a straight line in between.
 */
export function sunlightOpacity(sunFactor: number, sunUp: boolean): number {
  if (!sunUp) return 0
  return SUNLIGHT_MIN_OPACITY + (SUNLIGHT_MAX_OPACITY - SUNLIGHT_MIN_OPACITY) * clamp01(sunFactor)
}

/** Opacity of the shadow layer: full strength under a clear sky, a quarter of it under full cloud. */
export function shadowOpacity(sunFactor: number): number {
  return SHADOW_MAX_OPACITY * (SHADOW_MIN_SHARE + (1 - SHADOW_MIN_SHARE) * clamp01(sunFactor))
}
