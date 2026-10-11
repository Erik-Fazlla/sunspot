import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import { FALLBACK_BUILDING_HEIGHT_M } from './constants'
import {
  buildingHeight,
  buildingsFromFeatures,
  buildShadowPolygon,
  convexHull,
  isConvexRing,
  isPointInShade,
  makeBuilding,
  metersToDegrees,
  shadowOffset,
  shadowPieces,
  type Ring,
} from './shadow'

const ORIGIN = { lat: 37.98, lon: 23.72 }
const rad = (deg: number) => (deg * Math.PI) / 180

/** A point `east` / `north` metres from the test origin. */
function at(east: number, north: number): Position {
  const { dLon, dLat } = metersToDegrees(east, north, ORIGIN.lat)
  return [ORIGIN.lon + dLon, ORIGIN.lat + dLat]
}

function ringOf(points: [number, number][]): Ring {
  const ring = points.map(([e, n]) => at(e, n))
  return [...ring, ring[0]]
}

// 20 m x 20 m square with its south-west corner at the origin.
const SQUARE = ringOf([
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
])
// L-shape: a 20 x 20 square with the north-east 10 x 10 quarter cut out.
const L_SHAPE = ringOf([
  [0, 0],
  [20, 0],
  [20, 10],
  [10, 10],
  [10, 20],
  [0, 20],
])

const SUN_SOUTH_45 = { altitudeRad: rad(45), bearingDeg: 180 }
const SUN_EAST_45 = { altitudeRad: rad(45), bearingDeg: 90 }

describe('buildingHeight', () => {
  it('prefers render_height, then height', () => {
    expect(buildingHeight({ render_height: 21, height: 30, levels: 2 })).toBe(21)
    expect(buildingHeight({ height: '18.5' })).toBe(18.5)
  })

  it('falls back to levels x 3 m', () => {
    expect(buildingHeight({ levels: 4 })).toBe(12)
    expect(buildingHeight({ 'building:levels': '6' })).toBe(18)
  })

  it('uses the fallback constant when nothing is known', () => {
    expect(buildingHeight({})).toBe(FALLBACK_BUILDING_HEIGHT_M)
    expect(buildingHeight(null)).toBe(FALLBACK_BUILDING_HEIGHT_M)
    expect(buildingHeight({ render_height: 0, height: 'tall' })).toBe(FALLBACK_BUILDING_HEIGHT_M)
  })
})

describe('geometry helpers', () => {
  it('tells convex footprints from concave ones', () => {
    expect(isConvexRing(SQUARE)).toBe(true)
    expect(isConvexRing(L_SHAPE)).toBe(false)
  })

  it('builds a closed convex hull', () => {
    const hull = convexHull([...L_SHAPE])
    expect(hull[0]).toEqual(hull[hull.length - 1])
    // The inner corner of the L is not on the hull.
    expect(hull).toHaveLength(6)
  })

  it('splits a shadow into the footprint and one quad per leading wall', () => {
    const offset = shadowOffset(10, SUN_SOUTH_45, ORIGIN.lat)!
    // Sun in the south: only the north wall faces the way the shadow falls.
    expect(shadowPieces(SQUARE, offset)).toHaveLength(1 + 1)
    // The winding of the footprint must not matter.
    expect(shadowPieces([...SQUARE].reverse(), offset)).toHaveLength(1 + 1)
    // Sun in the east: of the L-shape, only the long west wall leads.
    expect(shadowPieces(L_SHAPE, shadowOffset(10, SUN_EAST_45, ORIGIN.lat)!)).toHaveLength(1 + 1)
    // Sun in the west: the east wall and the notch wall both lead.
    const sunWest = { altitudeRad: rad(45), bearingDeg: 270 }
    expect(shadowPieces(L_SHAPE, shadowOffset(10, sunWest, ORIGIN.lat)!)).toHaveLength(1 + 2)
  })
})

describe('buildShadowPolygon', () => {
  it('extends a 10 m building 10 m north when the sun is 45 degrees up in the south', () => {
    const offset = shadowOffset(10, SUN_SOUTH_45, ORIGIN.lat)!
    const shadow = buildShadowPolygon(makeBuilding(SQUARE, 10), offset)
    expect(booleanPointInPolygon(at(10, 29), shadow)).toBe(true)
    expect(booleanPointInPolygon(at(10, 31), shadow)).toBe(false)
    expect(booleanPointInPolygon(at(10, -1), shadow)).toBe(false)
    expect(booleanPointInPolygon(at(21, 25), shadow)).toBe(false)
  })

  it('keeps the notch of a concave footprint lit when the sun shines into it', () => {
    // Sun in the east: shadows fall 10 m to the west.
    const building = makeBuilding(L_SHAPE, 10)
    const shadow = buildShadowPolygon(building, shadowOffset(10, SUN_EAST_45, ORIGIN.lat)!)
    expect(booleanPointInPolygon(at(15, 15), shadow)).toBe(false) // inside the notch
    expect(booleanPointInPolygon(at(-5, 15), shadow)).toBe(true) // west of the building
    expect(booleanPointInPolygon(at(-11, 15), shadow)).toBe(false) // beyond the shadow tip
  })
})

describe('isPointInShade', () => {
  const building = makeBuilding(SQUARE, 10, 1)

  it('is true inside a shadow and false outside it', () => {
    expect(isPointInShade(at(10, 25), [building], SUN_SOUTH_45)).toBe(true)
    expect(isPointInShade(at(10, 35), [building], SUN_SOUTH_45)).toBe(false)
    expect(isPointInShade(at(10, -5), [building], SUN_SOUTH_45)).toBe(false)
    expect(isPointInShade(at(30, 25), [building], SUN_SOUTH_45)).toBe(false)
  })

  it('follows the sun: a lower sun reaches further', () => {
    const lowSun = { altitudeRad: rad(15), bearingDeg: 180 }
    expect(isPointInShade(at(10, 50), [building], SUN_SOUTH_45)).toBe(false)
    expect(isPointInShade(at(10, 50), [building], lowSun)).toBe(true)
  })

  it('ignores the building the point is in', () => {
    expect(isPointInShade(at(10, 10), [building], SUN_SOUTH_45)).toBe(false)
  })

  it('still counts another building that shades the one the point is in', () => {
    const tallNeighbour = makeBuilding(
      ringOf([
        [0, -30],
        [20, -30],
        [20, -10],
        [0, -10],
      ]),
      60,
      2,
    )
    expect(isPointInShade(at(10, 10), [building, tallNeighbour], SUN_SOUTH_45)).toBe(true)
  })

  it('ignores every piece of a building that a tile edge split in two', () => {
    const south = makeBuilding(ringOf([[0, 0], [20, 0], [20, 10], [0, 10]]), 30, 7)
    const north = makeBuilding(ringOf([[0, 10], [20, 10], [20, 20], [0, 20]]), 30, 7)
    // In the north piece; the south piece (same id) would otherwise shade it.
    expect(isPointInShade(at(10, 15), [south, north], SUN_SOUTH_45)).toBe(false)
  })

  it('is false when the sun is below the horizon', () => {
    expect(isPointInShade(at(10, 25), [building], { altitudeRad: -0.05, bearingDeg: 180 })).toBe(false)
  })
})

describe('buildingsFromFeatures', () => {
  it('reads polygons and multipolygons, skips hidden parts and drops tile-overlap duplicates', () => {
    const square = { type: 'Polygon' as const, coordinates: [SQUARE] }
    const buildings = buildingsFromFeatures([
      { id: 1, properties: { render_height: 9 }, geometry: square },
      { id: 1, properties: { render_height: 9 }, geometry: square },
      { id: 2, properties: { hide_3d: true }, geometry: { type: 'Polygon', coordinates: [L_SHAPE] } },
      { id: 3, properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[L_SHAPE]] } },
    ])
    expect(buildings).toHaveLength(2)
    expect(buildings[0]).toMatchObject({ id: 1, height: 9, convex: true })
    expect(buildings[1]).toMatchObject({ id: 3, height: FALLBACK_BUILDING_HEIGHT_M, convex: false })
  })
})
