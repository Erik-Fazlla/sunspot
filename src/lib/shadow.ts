import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
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
 * The parts whose union is the shadow of an extruded footprint: the footprint,
 * its translated copy (the roof outline projected on the ground) and one quad
 * per edge (the wall swept along the shadow direction).
 */
export function shadowPieces(ring: Ring, offset: GroundOffset): Ring[] {
  const far = translateRing(ring, offset)
  const pieces: Ring[] = [ring, far]
  for (let i = 0; i < ring.length - 1; i++) {
    const quad: Ring = [ring[i], ring[i + 1], far[i + 1], far[i], ring[i]]
    const area = signedArea(quad)
    // Walls parallel to the shadow direction sweep no area.
    if (Math.abs(area) < 1e-16) continue
    pieces.push(area < 0 ? [...quad].reverse() : quad)
  }
  return pieces
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
 * one MultiPolygon. The map layer flattens overlaps, so no union is needed.
 */
export function shadowRenderGeometry(building: Building, offset: GroundOffset): Polygon | MultiPolygon {
  if (building.convex) {
    return { type: 'Polygon', coordinates: [convexHull([...building.ring, ...translateRing(building.ring, offset)])] }
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

export function makeBuilding(ring: Ring, height: number, id?: string | number): Building {
  return { id, ring, height, convex: isConvexRing(ring), bbox: ringBBox(ring) }
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
      buildings.push(makeBuilding(ring, buildingHeight(feature.properties), feature.id))
    }
  }
  return buildings
}

function inBBox(point: Position, [west, south, east, north]: BBox): boolean {
  return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north
}

/**
 * Is `point` ([lon, lat]) inside the shadow of any building?
 * The building the point stands in (or on) is ignored: its own footprint
 * always "contains" the point and would shade every rooftop and doorway.
 * Returns false when the sun is down; callers treat night separately.
 */
export function isPointInShade(point: Position, buildings: Building[], sun: Sun): boolean {
  if (sun.altitudeRad <= 0) return false
  const own = new Set<Building>()
  const ownIds = new Set<string | number>()
  for (const building of buildings) {
    if (inBBox(point, building.bbox) && booleanPointInPolygon(point, polygon([building.ring]))) {
      own.add(building)
      // The same id marks the other pieces of a building split by a tile edge.
      if (building.id !== undefined) ownIds.add(building.id)
    }
  }
  for (const building of buildings) {
    if (own.has(building) || (building.id !== undefined && ownIds.has(building.id))) continue
    const offset = shadowOffset(building.height, sun, point[1])
    if (!offset) continue
    const [west, south, east, north] = building.bbox
    const reach: BBox = [
      west + Math.min(0, offset.dLon),
      south + Math.min(0, offset.dLat),
      east + Math.max(0, offset.dLon),
      north + Math.max(0, offset.dLat),
    ]
    if (!inBBox(point, reach)) continue
    if (booleanPointInPolygon(point, buildShadowPolygon(building, offset))) return true
  }
  return false
}
