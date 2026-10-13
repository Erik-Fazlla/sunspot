// Which files a place needs to work without a connection: the map tiles that
// cover it (they also carry the buildings), plus the map's fonts and icons.
// Pure address arithmetic; fetching and storing is in mapCache.ts.

/** Everything from the map's tile server goes through the on-device store. */
export const TILE_HOST = 'https://tiles.openfreemap.org/'
/** How far around a saved place the map is kept, in metres. */
export const SAVE_RADIUS_M = 1200
/** Deepest zoom the map's tiles exist at; closer views are drawn from these. */
export const TILE_MAX_ZOOM = 14

export interface TileId {
  z: number
  x: number
  y: number
}

const METERS_PER_DEG_LAT = 111_320

/** The tile holding a coordinate at zoom `z` (standard web map tiling). */
export function tileAt(lat: number, lon: number, z: number): TileId {
  const count = 2 ** z
  const clampedLat = Math.min(85.0511, Math.max(-85.0511, lat))
  const latRad = (clampedLat * Math.PI) / 180
  const x = Math.floor(((lon + 180) / 360) * count)
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * count)
  const wrap = (value: number) => Math.min(count - 1, Math.max(0, value))
  return { z, x: wrap(x), y: wrap(y) }
}

/** Every tile, at every zoom from `minZoom` to `maxZoom`, touching the square `radiusM` around a place. */
export function tilesForArea(
  lat: number,
  lon: number,
  radiusM = SAVE_RADIUS_M,
  maxZoom = TILE_MAX_ZOOM,
  minZoom = 0,
): TileId[] {
  const dLat = radiusM / METERS_PER_DEG_LAT
  const dLon = radiusM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))
  const tiles: TileId[] = []
  for (let z = minZoom; z <= maxZoom; z++) {
    // North-west and south-east corners; tile y grows southward.
    const first = tileAt(lat + dLat, lon - dLon, z)
    const last = tileAt(lat - dLat, lon + dLon, z)
    for (let x = first.x; x <= last.x; x++) {
      for (let y = first.y; y <= last.y; y++) tiles.push({ z, x, y })
    }
  }
  return tiles
}

/** "…/{z}/{x}/{y}.pbf" with a tile's numbers filled in. */
export function fillTileUrl(template: string, tile: TileId): string {
  return template.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y))
}

/**
 * Blocks of characters whose letter shapes are saved: Latin, accented Latin,
 * Greek, Greek with breathing marks, and general punctuation. Labels in other
 * scripts show without letters when offline.
 */
export const GLYPH_RANGES = ['0-255', '256-511', '768-1023', '7936-8191', '8192-8447']

interface StyleLike {
  layers?: { layout?: Record<string, unknown> }[]
}

/** The font names a map style writes its labels in. */
export function fontStacks(style: StyleLike): string[] {
  const stacks = new Set<string>()
  for (const layer of style.layers ?? []) {
    const font = layer.layout?.['text-font']
    if (Array.isArray(font) && font.every((name) => typeof name === 'string')) stacks.add(font.join(','))
  }
  return [...stacks].sort()
}

/** One font file address per font and character block. */
export function glyphUrls(template: string, stacks: string[], ranges = GLYPH_RANGES): string[] {
  return stacks.flatMap((stack) =>
    ranges.map((range) => template.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range)),
  )
}

/** The icon sheet in both sharpness levels: its picture and its index. */
export function spriteUrls(sprite: string): string[] {
  return ['', '@2x'].flatMap((scale) => [`${sprite}${scale}.json`, `${sprite}${scale}.png`])
}

/**
 * The name a file is stored under. Map tiles carry a release date in their
 * address (…/planet/20261004_113936_pt/14/…); it is dropped, so a place saved
 * under one release is still found after the server moves to the next.
 */
export function storeKey(url: string): string {
  return url.replace(/^(https:\/\/tiles\.openfreemap\.org\/planet\/)[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, '$1$2')
}

/**
 * How a file is looked up:
 *
 *   tile    map tiles: from the store when there, else the network
 *   fixed   fonts and icons: the same, they do not change
 *   fresh   the style and the tile index: the network first, so a new map
 *           release is noticed, and the store when the network does not answer
 */
export type StorePolicy = 'tile' | 'fixed' | 'fresh'

export function storePolicy(url: string): StorePolicy {
  if (/\/\d+\/\d+\/\d+\.(pbf|png)$/.test(url)) return 'tile'
  if (/\/(fonts|sprites)\//.test(url)) return 'fixed'
  return 'fresh'
}
