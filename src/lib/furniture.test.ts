import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
import { polygon } from '@turf/helpers'
import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import {
  benchFeatures,
  benchStates,
  CANOPY_SIDES,
  canopyBase,
  castersNearBenches,
  circleRing,
  furnitureFeatures,
  nearest,
  treeCaster,
  TRUNK_SHARE,
} from './furniture'
import type { Tree } from './overpass'
import {
  buildShadowPolygon,
  isConvexRing,
  isPointInShade,
  isShadedBy,
  makeBuilding,
  metersToDegrees,
  shadowOffset,
  shadowRenderGeometry,
  shadowSweep,
  type Ring,
} from './shadow'

const ORIGIN = { lat: 37.98, lon: 23.72 }
const rad = (deg: number) => (deg * Math.PI) / 180

/** A point `east` / `north` metres from the test origin. */
function at(east: number, north: number): Position {
  const { dLon, dLat } = metersToDegrees(east, north, ORIGIN.lat)
  return [ORIGIN.lon + dLon, ORIGIN.lat + dLat]
}

/** Metres east / north of the origin for a position. */
function metres([lon, lat]: Position): [number, number] {
  const one = metersToDegrees(1, 1, ORIGIN.lat)
  return [(lon - ORIGIN.lon) / one.dLon, (lat - ORIGIN.lat) / one.dLat]
}

// A 10 m tree with a 3 m canopy radius at the origin: canopy from 4 m to 10 m.
const TREE: Tree = { id: 1, lon: ORIGIN.lon, lat: ORIGIN.lat, height: 10, crownRadius: 3 }
const SUN_SOUTH_45 = { altitudeRad: rad(45), bearingDeg: 180 }

describe('circleRing', () => {
  it('is a closed, convex, counter-clockwise polygon of the requested radius', () => {
    const ring = circleRing(ORIGIN.lon, ORIGIN.lat, 3)
    expect(ring).toHaveLength(CANOPY_SIDES + 1)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(isConvexRing(ring)).toBe(true)
    for (const position of ring) {
      const [east, north] = metres(position)
      expect(Math.hypot(east, north)).toBeCloseTo(3, 5)
    }
    // Counter-clockwise: positive signed area.
    let area = 0
    for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    expect(area).toBeGreaterThan(0)
  })
})

describe('treeCaster', () => {
  const caster = treeCaster(TREE)

  it('is a canopy footprint floating between the trunk top and the tree top', () => {
    expect(canopyBase(TREE)).toBeCloseTo(10 * TRUNK_SHARE)
    expect(caster.base).toBeCloseTo(4)
    expect(caster.height).toBe(10)
    expect(caster.convex).toBe(true)
    expect(caster.id).toBe('tree-1')
  })
})

describe('tree shadow geometry', () => {
  const caster = treeCaster(TREE)
  // Sun 45 degrees up in the south: the underside (4 m) lands 4 m north, the top (10 m) 10 m north.
  const sweep = shadowSweep(caster, SUN_SOUTH_45, ORIGIN.lat)!
  const shadow = buildShadowPolygon(sweep, sweep.offset)
  const inShadow = (east: number, north: number) => booleanPointInPolygon(at(east, north), shadow)

  it('starts where the underside of the canopy lands, not at the trunk', () => {
    const [east, north] = metres(sweep.ring[0])
    // First canopy vertex is 3 m east of the trunk, moved 4 m north.
    expect(east).toBeCloseTo(3, 4)
    expect(north).toBeCloseTo(4, 4)
    const length = metres([ORIGIN.lon + sweep.offset.dLon, ORIGIN.lat + sweep.offset.dLat])
    expect(length[0]).toBeCloseTo(0, 4)
    expect(length[1]).toBeCloseTo(6, 4) // 10 m - 4 m
  })

  it('covers the ground from 1 m to 13 m north of the trunk, 3 m either side', () => {
    expect(inShadow(0, 2)).toBe(true) // just inside the near edge (4 - 3 = 1 m)
    expect(inShadow(0, 7)).toBe(true) // middle
    expect(inShadow(0, 12.5)).toBe(true) // just inside the far edge (10 + 3 = 13 m)
    expect(inShadow(2.5, 7)).toBe(true)
    expect(inShadow(-2.5, 7)).toBe(true)
  })

  it('leaves the trunk and everything outside the sweep in the sun', () => {
    expect(inShadow(0, 0)).toBe(false) // at the trunk: the canopy shadow has moved away
    expect(inShadow(0, 0.5)).toBe(false)
    expect(inShadow(0, 13.5)).toBe(false)
    expect(inShadow(3.5, 7)).toBe(false)
    expect(inShadow(0, -2)).toBe(false) // on the sunny side
  })

  it('falls straight under the canopy when the sun is overhead', () => {
    const overhead = shadowSweep(caster, { altitudeRad: rad(89.9), bearingDeg: 180 }, ORIGIN.lat)!
    const below = buildShadowPolygon(overhead, overhead.offset)
    expect(booleanPointInPolygon(at(0, 0), below)).toBe(true)
    expect(booleanPointInPolygon(at(2.5, 0), below)).toBe(true)
    expect(booleanPointInPolygon(at(4, 0), below)).toBe(false)
  })

  it('casts nothing when the sun is down', () => {
    expect(shadowSweep(caster, { altitudeRad: -0.1, bearingDeg: 180 }, ORIGIN.lat)).toBeNull()
  })

  it('renders as one hull polygon, the same shape the point test uses', () => {
    const geometry = shadowRenderGeometry(sweep, sweep.offset)
    expect(geometry.type).toBe('Polygon')
    const rendered = polygon(geometry.coordinates as Position[][])
    for (const [east, north] of [[0, 2], [0, 7], [2.5, 7], [0, 0], [0, 13.5], [3.5, 7]]) {
      expect(booleanPointInPolygon(at(east, north), rendered)).toBe(inShadow(east, north))
    }
  })

  it('goes through the shared point-in-shade test, including under the canopy', () => {
    expect(isPointInShade(at(0, 7), [caster], SUN_SOUTH_45)).toBe(true)
    expect(isPointInShade(at(0, 14), [caster], SUN_SOUTH_45)).toBe(false)
    // Standing at the trunk: inside the canopy footprint, but a tree is not a building to stand "in".
    expect(isPointInShade(at(0, 0), [caster], SUN_SOUTH_45)).toBe(false)
    expect(isPointInShade(at(0, 0), [caster], { altitudeRad: rad(89.9), bearingDeg: 180 })).toBe(true)
  })

  it('stretches with a lower sun', () => {
    const lowSun = { altitudeRad: rad(20), bearingDeg: 180 }
    // Underside lands 4 / tan(20) = 11 m out, top 27.5 m out.
    expect(isShadedBy(at(0, 20), caster, lowSun)).toBe(true)
    expect(isShadedBy(at(0, 5), caster, lowSun)).toBe(false)
    expect(isShadedBy(at(0, 20), caster, SUN_SOUTH_45)).toBe(false)
  })
})

describe('isShadedBy agrees with the shadow polygon', () => {
  const lShape: Ring = [at(0, 0), at(20, 0), at(20, 10), at(10, 10), at(10, 20), at(0, 20), at(0, 0)]
  const casters = [makeBuilding(lShape, 15), treeCaster({ ...TREE, lon: at(40, 0)[0] })]
  const suns = [
    SUN_SOUTH_45,
    { altitudeRad: rad(20), bearingDeg: 250 },
    { altitudeRad: rad(60), bearingDeg: 100 },
  ]

  it('for a grid of points around a concave building and a tree', () => {
    for (const sun of suns) {
      for (const caster of casters) {
        const sweep = shadowSweep(caster, sun, ORIGIN.lat)!
        const shadow = buildShadowPolygon(sweep, sweep.offset)
        for (let east = -45; east <= 85; east += 3.7) {
          for (let north = -45; north <= 65; north += 3.7) {
            const point = at(east, north)
            expect(isShadedBy(point, caster, sun), `${east},${north}`).toBe(booleanPointInPolygon(point, shadow))
          }
        }
      }
    }
  })

  it('matches the shadow offset used for buildings', () => {
    const offset = shadowOffset(15, SUN_SOUTH_45, ORIGIN.lat)!
    const sweep = shadowSweep(casters[0], SUN_SOUTH_45, ORIGIN.lat)!
    expect(sweep.offset).toEqual(offset)
    expect(sweep.ring).toBe(lShape)
  })
})

describe('benches', () => {
  const tower = makeBuilding([at(-10, -30), at(10, -30), at(10, -10), at(-10, -10), at(-10, -30)], 30)
  const benches = [
    { id: 1, lon: at(0, 0)[0], lat: at(0, 0)[1] }, // 10 m north of the tower: shaded
    { id: 2, lon: at(60, 0)[0], lat: at(60, 0)[1] }, // well to the east: sunny
    { id: 3, lon: at(0, 2000)[0], lat: at(0, 2000)[1] }, // far away
  ]
  const near = castersNearBenches(benches, [tower], 300)

  it('pairs each bench with the casters within reach', () => {
    expect(near.map((list) => list.length)).toEqual([1, 1, 0])
  })

  it('marks benches sun or shade for the sun position', () => {
    expect(benchStates(benches, near, SUN_SOUTH_45)).toEqual(['shade', 'sun', 'sun'])
  })

  it('marks every bench night when the sun is down', () => {
    expect(benchStates(benches, near, { altitudeRad: -0.2, bearingDeg: 0 })).toEqual(['night', 'night', 'night'])
  })

  it('turns them into point features carrying the state', () => {
    const collection = benchFeatures(benches, ['shade', 'sun'])
    expect(collection.features.map((f) => f.properties?.state)).toEqual(['shade', 'sun', 'unknown'])
    expect(collection.features[0].geometry).toEqual({ type: 'Point', coordinates: [benches[0].lon, benches[0].lat] })
  })
})

describe('furnitureFeatures', () => {
  it('draws a trunk and a canopy per tree and a post and a head per lamp', () => {
    const { features } = furnitureFeatures({
      trees: [TREE],
      lamps: [{ id: 9, lon: ORIGIN.lon, lat: ORIGIN.lat, height: 6 }],
    })
    expect(features).toHaveLength(4)
    const [trunk, canopy, post, head] = features.map((f) => f.properties!)
    expect(trunk).toMatchObject({ base: 0, height: 4 })
    expect(canopy).toMatchObject({ base: 4, height: 10 })
    expect(post.base).toBe(0)
    expect(head.height).toBe(6)
    expect(post.height).toBe(head.base)
  })
})

describe('nearest', () => {
  const items = [0, 1, 2, 3, 4].map((i) => ({ id: i, lon: ORIGIN.lon + i * 0.001, lat: ORIGIN.lat }))

  it('returns everything under the limit, untouched', () => {
    expect(nearest(items, [ORIGIN.lon, ORIGIN.lat], 10)).toBe(items)
  })

  it('keeps the items closest to the centre when over the limit', () => {
    const kept = nearest(items, [ORIGIN.lon + 0.004, ORIGIN.lat], 2)
    expect(kept.map((item) => item.id)).toEqual([4, 3])
  })
})
