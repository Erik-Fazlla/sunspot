/** Free vector style (OpenMapTiles schema) served by OpenFreeMap. No API key. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
/** Vector source and source-layer that hold building footprints in that style. */
export const BUILDING_SOURCE = 'openmaptiles'
export const BUILDING_SOURCE_LAYER = 'building'
export const BUILDING_3D_LAYER = 'building-3d'

/** Athens centre: fallback when geolocation is unavailable or denied. */
export const FALLBACK_PLACE = {
  lat: 37.9838,
  lon: 23.7275,
  label: 'Athens, Greece',
  timezone: 'Europe/Athens',
} as const
export const DEFAULT_TIMEZONE = 'Europe/Athens'
export const DEFAULT_ZOOM = 16.4
export const DEFAULT_PITCH = 52
/** The MapLibre upper limit; lets the camera look along the streets toward the horizon. */
export const MAX_PITCH = 85

/**
 * Free elevation tiles (Mapzen "terrarium" encoding) from the AWS Open Data
 * registry. No key, CORS enabled.
 */
export const TERRAIN_TILES_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const TERRAIN_MAX_ZOOM = 15
export const TERRAIN_ATTRIBUTION =
  'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">Mapzen, AWS Terrain Tiles</a>'

/** Height used when a building has no height and no level count. */
export const FALLBACK_BUILDING_HEIGHT_M = 12
/** Assumed storey height when only a level count is known. */
export const METERS_PER_LEVEL = 3
/** Shadows are capped at this length when the sun is very low. */
export const MAX_SHADOW_LENGTH_M = 300

/** Below this zoom there are too many buildings on screen to shade smoothly. */
export const MIN_SHADOW_ZOOM = 15
/** Upper bound on buildings shaded per frame (nearest to the map centre win). */
export const MAX_SHADOW_BUILDINGS = 2000
export const MOVE_DEBOUNCE_MS = 250

/** Slider step and sampling interval for the point analysis. */
export const STEP_MINUTES = 5
export const PLAY_INTERVAL_MS = 450

/** Open-Meteo serves up to 16 forecast days (today + 15). */
export const FORECAST_DAYS = 16
