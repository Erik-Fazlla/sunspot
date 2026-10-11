import type { Feature, FeatureCollection, Position } from 'geojson'
import type { Bench, StreetFurniture, Tree } from './overpass'
import { isPointInShade, makeBuilding, metersToDegrees, type Building, type Ring } from './shadow'
import type { SunPosition } from './sun'

/** Share of a tree's height that is bare trunk; the canopy fills the rest. */
export const TRUNK_SHARE = 0.4
/** Sides of the polygon that stands in for a round canopy. */
export const CANOPY_SIDES = 12
/** Most trees that cast shadows and are drawn at once (nearest the centre win). */
export const MAX_TREES = 1500
/** Most benches whose sun state is tracked at once. */
export const MAX_BENCHES = 400

const TRUNK_RADIUS_M = 0.2
const LAMP_POST_RADIUS_M = 0.14
const LAMP_HEAD_RADIUS_M = 0.4
const LAMP_HEAD_HEIGHT_M = 0.35

export const FURNITURE_COLORS = {
  trunk: '#8a6b4b',
  canopy: '#86a871',
  lampPost: '#6f7683',
  lampHead: '#f4e7b3',
} as const

export type BenchState = 'sun' | 'shade' | 'night' | 'unknown'

export const BENCH_COLORS: Record<BenchState, string> = {
  sun: '#f59e0b',
  shade: '#3d4c86',
  night: '#5d6475',
  unknown: '#a9a59d',
}

/** A regular polygon around a point: closed, counter-clockwise, radius in metres. */
export function circleRing(lon: number, lat: number, radiusM: number, sides = CANOPY_SIDES): Ring {
  const ring: Ring = []
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * 2 * Math.PI
    const { dLon, dLat } = metersToDegrees(radiusM * Math.cos(angle), radiusM * Math.sin(angle), lat)
    ring.push([lon + dLon, lat + dLat])
  }
  ring.push(ring[0])
  return ring
}

/** Height at which a tree's canopy starts. */
export function canopyBase(tree: Pick<Tree, 'height'>): number {
  return tree.height * TRUNK_SHARE
}

/**
 * A tree as a shadow caster for the building shadow pipeline: its canopy is a
 * circular footprint floating between the top of the trunk and the top of the
 * tree. The trunk is too thin to matter and casts nothing.
 */
export function treeCaster(tree: Tree): Building {
  return makeBuilding(circleRing(tree.lon, tree.lat, tree.crownRadius), tree.height, `tree-${tree.id}`, canopyBase(tree))
}

/** The `limit` items nearest to `center` ([lon, lat]); all of them when there are fewer. */
export function nearest<T extends { lon: number; lat: number }>(items: T[], center: Position, limit: number): T[] {
  if (items.length <= limit) return items
  const distance = (item: T) => (item.lon - center[0]) ** 2 + (item.lat - center[1]) ** 2
  return [...items].sort((a, b) => distance(a) - distance(b)).slice(0, limit)
}

function prism(ring: Ring, base: number, height: number, color: string): Feature {
  return {
    type: 'Feature',
    properties: { base, height, color },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

/**
 * 3D shapes for trees and lamps, for one fill-extrusion layer that reads
 * `base`, `height` and `color` from each feature: a trunk and a canopy per
 * tree, a thin post and a small head per lamp.
 */
export function furnitureFeatures(furniture: Pick<StreetFurniture, 'trees' | 'lamps'>): FeatureCollection {
  const features: Feature[] = []
  for (const tree of furniture.trees) {
    const trunkTop = canopyBase(tree)
    features.push(prism(circleRing(tree.lon, tree.lat, TRUNK_RADIUS_M, 6), 0, trunkTop, FURNITURE_COLORS.trunk))
    features.push(prism(circleRing(tree.lon, tree.lat, tree.crownRadius), trunkTop, tree.height, FURNITURE_COLORS.canopy))
  }
  for (const lamp of furniture.lamps) {
    const headBase = lamp.height - LAMP_HEAD_HEIGHT_M
    features.push(prism(circleRing(lamp.lon, lamp.lat, LAMP_POST_RADIUS_M, 6), 0, headBase, FURNITURE_COLORS.lampPost))
    features.push(prism(circleRing(lamp.lon, lamp.lat, LAMP_HEAD_RADIUS_M, 8), headBase, lamp.height, FURNITURE_COLORS.lampHead))
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Sun or shade for each bench at one moment. `castersNear[i]` lists the
 * buildings and trees close enough to shade bench i; working that out once per
 * view keeps this cheap enough to run on every slider step.
 */
export function benchStates(
  benches: Bench[],
  castersNear: Building[][],
  sun: Pick<SunPosition, 'altitudeRad' | 'bearingDeg'>,
): BenchState[] {
  if (sun.altitudeRad <= 0) return benches.map(() => 'night')
  return benches.map((bench, i) =>
    isPointInShade([bench.lon, bench.lat], castersNear[i] ?? [], sun) ? 'shade' : 'sun',
  )
}

/** Casters whose shadow could reach each bench: those within `reachM` of it. */
export function castersNearBenches(benches: Bench[], casters: Building[], reachM: number): Building[][] {
  return benches.map((bench) => {
    const reach = metersToDegrees(reachM, reachM, bench.lat)
    return casters.filter(
      ({ bbox }) =>
        bbox[2] >= bench.lon - reach.dLon &&
        bbox[0] <= bench.lon + reach.dLon &&
        bbox[3] >= bench.lat - reach.dLat &&
        bbox[1] <= bench.lat + reach.dLat,
    )
  })
}

/** Benches as points carrying their sun state, for a circle layer coloured by `state`. */
export function benchFeatures(benches: Bench[], states: BenchState[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: benches.map((bench, i) => ({
      type: 'Feature',
      properties: { state: states[i] ?? 'unknown' },
      geometry: { type: 'Point', coordinates: [bench.lon, bench.lat] },
    })),
  }
}
