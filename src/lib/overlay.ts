/** Colour of the sunlight overlay: a warm yellow that reads clearly over the muted basemap. */
export const SUNLIGHT_COLOR = '#ffc21f'
/**
 * Overlay opacity while the sun is up and the sky is fully overcast. A floor,
 * so that turning the overlay on always shows something during the day.
 */
export const SUNLIGHT_MIN_OPACITY = 0.12
/** Overlay opacity under a clear sky (sunFactor 1). */
export const SUNLIGHT_MAX_OPACITY = 0.35

/**
 * Opacity of the shade layer on each basemap. It is constant: where shade
 * falls is geometry, and must stay readable whatever the forecast says. How
 * strong the sun is shows in the weather panel and the sun label instead.
 * Over a photo it is stronger, to stand out from the picture.
 */
export const SHADE_OPACITY = { map: 0.46, satellite: 0.62 } as const

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
