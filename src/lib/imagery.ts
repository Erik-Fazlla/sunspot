// Satellite imagery for the optional "Satellite" basemap: Esri World Imagery.
//
// The tiles load without a key, which is fine for local development. Esri's
// terms expect public sites to use an account, so a key can be supplied at
// build time (VITE_ESRI_KEY) and is then sent with every tile request.

/** Keyless endpoint, used when no key is configured. */
const KEYLESS_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
/** Endpoint Esri documents for key-based access from third-party map libraries. */
const KEYED_TILES =
  'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

/** Deepest zoom level Esri serves; MapLibre stretches these tiles beyond it. */
export const IMAGERY_MAX_ZOOM = 19
/** The photo never fades out completely, or the switch would look broken. */
export const IMAGERY_MIN_OPACITY = 0.3
/** Slightly see-through by default, so computed shadows read clearly over the photo. */
export const IMAGERY_DEFAULT_OPACITY = 0.85

/** Shown on the map, in the panel and in the README whenever imagery is used. */
export const ESRI_ATTRIBUTION =
  'Imagery: Powered by <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community'

/**
 * Tile URL template for Esri World Imagery. With a key, requests go to the
 * key-based endpoint with the key appended as `token`; without one, to the
 * keyless endpoint. Note the {z}/{y}/{x} order: row before column.
 */
export function esriImageryTileUrl(key?: string | null): string {
  const trimmed = key?.trim()
  return trimmed ? `${KEYED_TILES}?token=${encodeURIComponent(trimmed)}` : KEYLESS_TILES
}

/** Keep a stored or typed opacity inside the allowed range. */
export function clampImageryOpacity(value: number): number {
  if (!Number.isFinite(value)) return IMAGERY_DEFAULT_OPACITY
  return Math.min(1, Math.max(IMAGERY_MIN_OPACITY, value))
}

/** At or below this photo strength the photo is fully muted. */
export const IMAGERY_MUTED_UNTIL = 0.85
/** How far a fully muted photo is pushed: greyer, flatter and lighter. */
export const IMAGERY_MUTED = { saturation: -0.55, contrast: -0.3, brightnessMin: 0.2 } as const

/**
 * A photo carries the real shadows of the moment it was taken, and they never
 * move. Muting it (less colour, less contrast, lifted blacks) pushes those old
 * shadows back so the computed shade reads as the only shade on screen.
 * `strength` is the photo slider: fully muted up to 85%, untouched at 100%.
 */
export function imageryTone(strength: number): { saturation: number; contrast: number; brightnessMin: number } {
  const muting = Math.min(1, Math.max(0, (1 - strength) / (1 - IMAGERY_MUTED_UNTIL)))
  return {
    saturation: IMAGERY_MUTED.saturation * muting,
    contrast: IMAGERY_MUTED.contrast * muting,
    brightnessMin: IMAGERY_MUTED.brightnessMin * muting,
  }
}
