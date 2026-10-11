import { featureCollection, polygon } from '@turf/helpers'
import { union } from '@turf/union'
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import { FALLBACK_BUILDING_HEIGHT_M, METERS_PER_LEVEL } from './constants'
import { shadowVector, type SunPosition } from './sun'

/** Closed ring of [lon, lat] positions (first point repeated at the end). */
export type Ring = Position[]
/** [west, south, east, north] */
export type BBox = [number, number, number, number]

export interface Building {
  id?: string | number
  /** Outer footprint ring. Courtyards (holes) are not modelled. */
  ring: Ring
  height: number
  /**
   * Height of the underside above the ground, in metres. 0 or absent for a
   * building; the trunk height for a tree canopy, which floats above the ground.
   */
  base?: number
  convex: boolean
  bbox: BBox
}

/** Shift applied to a footprint to get the far end of its shadow, in degrees. */
export interface GroundOffset {
  dLon: number
  dLat: number
}

type Sun = Pick<SunPosition, 'altitudeRad' | 'bearingDeg'>

const METERS_PER_DEG_LAT = 111_320

/**
 * Building height in metres from OpenMapTiles / OSM properties:
 * render_height or height from the tiles, else levels x 3 m, else the fallback.
 */
export function buildingHeight(props: Record<string, unknown> | null | undefined): number {
  const num = (value: unknown) => {
    const n = typeof value === 'string' ? Number.parseFloat(value) : (value as number)
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
  }
  const height = num(props?.render_height) ?? num(props?.height)
  if (height !== null) return height
  const levels = num(props?.levels) ?? num(props?.['building:levels'])
  if (levels !== null) return levels * METERS_PER_LEVEL
  return FALLBACK_BUILDING_HEIGHT_M
}

/** Metres on the ground -> degrees, using a local flat-earth approximation (fine over ~300 m). */
export function metersToDegrees(eastM: number, northM: number, lat: number): GroundOffset {
  return {
    dLon: eastM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)),
    dLat: northM / METERS_PER_DEG_LAT,
  }
}

/** Offset of a building's shadow for the given sun, or null when it casts none. */
export function shadowOffset(heightM: number, sun: Sun, lat: number): GroundOffset | null {
  const vector = shadowVector(heightM, sun)
  return vector ? metersToDegrees(vector.east, vector.north, lat) : null
}

export function translateRing(ring: Ring, offset: GroundOffset): Ring {
  return ring.map(([lon, lat]) => [lon + offset.dLon, lat + offset.dLat])
}

function signedArea(ring: Ring): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return sum / 2
}

export function isConvexRing(ring: Ring): boolean {
  const n = ring.length - 1
  let sign = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const c = ring[(i + 2) % n]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cross) < 1e-14) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** Convex hull (Andrew's monotone chain) as a closed counter-clockwise ring. */
export function convexHull(points: Position[]): Ring {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Position, a: Position, b: Position) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Position[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Position[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  return [...hull, hull[0]]
}

/**
 * The parts whose union is the shadow of an extruded footprint: the footprint
 * plus one quad per *leading* wall (a wall facing the way the shadow falls),
 * swept along the shadow direction.
 *
 * Trailing walls and the translated roof outline add nothing: any shaded point
 * outside the footprint lies on a line that leaves the footprint through a
 * leading wall, so that wall's quad already covers it.
 */
export function shadowPieces(ring: Ring, offset: GroundOffset): Ring[] {
  const orientation = Math.sign(signedArea(ring))
  const pieces: Ring[] = [ring]
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]
    const b = ring[i + 1]
    // Cross product of the wall with the shadow direction: its sign, compared
    // with the ring's winding, says which way the wall faces. Zero means the
    // wall is parallel to the shadow and sweeps no area.
    const cross = (b[0] - a[0]) * offset.dLat - (b[1] - a[1]) * offset.dLon
    if (cross * orientation > -MIN_SWEPT_AREA_DEG2) continue
    pieces.push([a, b, shift(b, offset), shift(a, offset), a])
  }
  return pieces
}

/** Roughly 1 cm x 1 cm in square degrees: anything smaller is rounding noise. */
const MIN_SWEPT_AREA_DEG2 = 1e-14

// About 1 cm. Short coordinates keep the GeoJSON handed to the map small.
const round7 = (value: number) => Math.round(value * 1e7) / 1e7

function shift([lon, lat]: Position, offset: GroundOffset): Position {
  return [round7(lon + offset.dLon), round7(lat + offset.dLat)]
}

/**
 * Shadow of one building as a single polygon.
 * Convex footprints: the convex hull of the footprint and its translated copy
 * is exact and fast. Others: the union of the pieces above (exact, slower).
 */
export function buildShadowPolygon(
  building: Pick<Building, 'ring' | 'convex'>,
  offset: GroundOffset,
): Feature<Polygon | MultiPolygon> {
  const hull = () => polygon([convexHull([...building.ring, ...translateRing(building.ring, offset)])])
  if (building.convex) return hull()
  try {
    const pieces = shadowPieces(building.ring, offset).map((ring) => polygon([ring]))
    return union(featureCollection(pieces)) ?? hull()
  } catch {
    // Degenerate footprints can trip the clipper; an over-estimate beats a crash.
    return hull()
  }
}

/**
 * Cheap shadow geometry for drawing a whole viewport: the un-merged pieces as
 * one MultiPolygon (or the hull, for convex footprints). The map layer flattens
 * overlaps, so no union is needed.
 */
export function shadowRenderGeometry(
  building: Pick<Building, 'ring' | 'convex'>,
  offset: GroundOffset,
): Polygon | MultiPolygon {
  if (building.convex) {
    const far = building.ring.map((position) => shift(position, offset))
    return { type: 'Polygon', coordinates: [convexHull([...building.ring, ...far])] }
  }
  return { type: 'MultiPolygon', coordinates: shadowPieces(building.ring, offset).map((ring) => [ring]) }
}

function ringBBox(ring: Ring): BBox {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return [west, south, east, north]
}

export function makeBuilding(ring: Ring, height: number, id?: string | number, base = 0): Building {
  return { id, ring, height, base, convex: isConvexRing(ring), bbox: ringBBox(ring) }
}

/**
 * The footprint and displacement whose sweep is the shadow of a caster.
 *
 * A solid standing on the ground (base 0) sweeps its footprint from where it
 * stands to the shadow of its top edge. A solid floating between `base` and
 * `height`, such as a tree canopy, sweeps from the shadow of its underside to
 * the shadow of its top: the same construction, started further out.
 */
export function shadowSweep(
  caster: Pick<Building, 'ring' | 'height' | 'base' | 'convex'>,
  sun: Sun,
  lat: number,
): { ring: Ring; offset: GroundOffset; convex: boolean } | null {
  const top = shadowOffset(caster.height, sun, lat)
  if (!top) return null
  const bottom = caster.base && caster.base > 0 ? shadowOffset(caster.base, sun, lat) : null
  if (!bottom) return { ring: caster.ring, offset: top, convex: caster.convex }
  return {
    ring: translateRing(caster.ring, bottom),
    offset: { dLon: top.dLon - bottom.dLon, dLat: top.dLat - bottom.dLat },
    convex: caster.convex,
  }
}

/** Is `point` inside `ring`? Even-odd ray casting; the ring is closed. */
export function pointInRing(point: Position, ring: Ring): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const side = (p: Position, q: Position, r: Position) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)
}

/**
 * Does `caster` shade `point`? Exact and cheap: the point is shaded when the
 * line from it toward the sun, as long as the shadow, touches the footprint.
 * That is the same region as the shadow polygon, without building the polygon.
 */
export function isShadedBy(
  point: Position,
  caster: Pick<Building, 'ring' | 'height' | 'base' | 'convex'>,
  sun: Sun,
): boolean {
  const sweep = shadowSweep(caster, sun, point[1])
  if (!sweep) return false
  const { ring, offset } = sweep
  const towardSun: Position = [point[0] - offset.dLon, point[1] - offset.dLat]
  if (pointInRing(point, ring) || pointInRing(towardSun, ring)) return true
  for (let i = 0; i < ring.length - 1; i++) {
    if (segmentsCross(point, towardSun, ring[i], ring[i + 1])) return true
  }
  return false
}

interface TileFeature {
  id?: string | number
  properties: Record<string, unknown> | null
  geometry: Geometry
}

/**
 * Turn building features from vector tiles into buildings. Tiles overlap at
 * their edges, so the same footprint can arrive more than once; those are
 * dropped. A building cut by a tile edge arrives as separate pieces.
 */
export function buildingsFromFeatures(features: TileFeature[]): Building[] {
  const seen = new Set<string>()
  const buildings: Building[] = []
  for (const feature of features) {
    if (feature.properties?.hide_3d) continue
    const { geometry } = feature
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : []
    for (const rings of polygons) {
      const ring = rings[0]
      if (!ring || ring.length < 4) continue
      const key = `${ring.length}:${ring[0][0].toFixed(7)},${ring[0][1].toFixed(7)}:${ring[1][0].toFixed(7)}`
      if (seen.has(key)) continue
      seen.add(key)
      const rounded = ring.map(([lon, lat]) => [round7(lon), round7(lat)])
      buildings.push(makeBuilding(rounded, buildingHeight(feature.properties), feature.id))
    }
  }
  return buildings
}

function inBBox(point: Position, [west, south, east, north]: BBox): boolean {
  return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north
}

/**
 * Is `point` ([lon, lat]) inside the shadow of any caster (building or tree)?
 * The building the point stands in (or on) is ignored: its own footprint
 * always "contains" the point and would shade every rooftop and doorway.
 * A floating caster such as a tree canopy is never "own": a point under it
 * is on the ground, and the canopy shades it only when the sun says so.
 * Returns false when the sun is down; callers treat night separately.
 */
export function isPointInShade(point: Position, buildings: Building[], sun: Sun): boolean {
  if (sun.altitudeRad <= 0) return false
  const own = new Set<Building>()
  const ownIds = new Set<string | number>()
  for (const building of buildings) {
    if (building.base && building.base > 0) continue
    if (inBBox(point, building.bbox) && pointInRing(point, building.ring)) {
      own.add(building)
      // The same id marks the other pieces of a building split by a tile edge.
      if (building.id !== undefined) ownIds.add(building.id)
    }
  }
  for (const building of buildings) {
    if (own.has(building) || (building.id !== undefined && ownIds.has(building.id))) continue
    const offset = shadowOffset(building.height, sun, point[1])
    if (!offset) continue
    // The whole shadow, grounded or floating, lies within the footprint's box stretched by the top offset.
    const [west, south, east, north] = building.bbox
    const reach: BBox = [
      west + Math.min(0, offset.dLon),
      south + Math.min(0, offset.dLat),
      east + Math.max(0, offset.dLon),
      north + Math.max(0, offset.dLat),
    ]
    if (!inBBox(point, reach)) continue
    if (isShadedBy(point, building, sun)) return true
  }
  return false
}
