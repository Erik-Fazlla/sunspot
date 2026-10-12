import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import type { BBox, Ring } from './shadow'
import {
  extentCorners,
  extentProjector,
  paintShadows,
  SHADE_EDGE,
  SHADE_FILL,
  shadowExtent,
  type ShadowExtent,
  type ShadowPainter,
} from './shadowCanvas'

const EXTENT: ShadowExtent = { west: 23.72, south: 37.98, east: 23.73, north: 37.99 }

/** A stand-in for a canvas context that records what was drawn, in order. */
function recorder() {
  const calls: string[] = []
  const paths: [number, number][][] = []
  const painter: ShadowPainter = {
    lineWidth: 0,
    lineJoin: '',
    strokeStyle: '',
    fillStyle: '',
    globalCompositeOperation: '',
    clearRect: () => calls.push('clear'),
    beginPath: () => calls.push('begin'),
    moveTo: (x, y) => paths.push([[x, y]]),
    lineTo: (x, y) => paths[paths.length - 1].push([x, y]),
    closePath: () => calls.push('close'),
    stroke: () => calls.push(`stroke:${String(painter.strokeStyle)}`),
    fill: () => calls.push(`fill:${String(painter.fillStyle)}:${painter.globalCompositeOperation}`),
  }
  return { painter, calls, paths }
}

const square = (lon: number, lat: number, size = 0.001): Ring => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
]

describe('extentProjector', () => {
  const project = extentProjector(EXTENT, 1000, 500)

  it('puts the corners of the extent on the corners of the canvas, north at the top', () => {
    const at = (p: Position) => project(p).map((v) => Math.round(v))
    expect(at([EXTENT.west, EXTENT.north])).toEqual([0, 0])
    expect(at([EXTENT.east, EXTENT.north])).toEqual([1000, 0])
    expect(at([EXTENT.east, EXTENT.south])).toEqual([1000, 500])
    expect(at([EXTENT.west, EXTENT.south])).toEqual([0, 500])
  })

  it('is linear in longitude and follows the Mercator scale in latitude', () => {
    expect(project([23.725, 37.985])[0]).toBeCloseTo(500)
    // Over one hundredth of a degree the Mercator stretch is tiny but not zero.
    const y = project([23.725, 37.985])[1]
    expect(y).toBeGreaterThan(249.9)
    expect(y).toBeLessThan(250.1)
    expect(y).not.toBe(250)
  })
})

describe('shadowExtent', () => {
  const view: BBox = [23.7, 37.97, 23.75, 38.0]
  const margin = { dLon: 0.003, dLat: 0.002 }

  it('covers the buildings plus the reach of their shadows', () => {
    const extent = shadowExtent(view, [[23.72, 37.98, 23.721, 37.981], [23.728, 37.985, 23.729, 37.986]], margin)!
    expect(extent.west).toBeCloseTo(23.717)
    expect(extent.east).toBeCloseTo(23.732)
    expect(extent.south).toBeCloseTo(37.978)
    expect(extent.north).toBeCloseTo(37.988)
  })

  it('does not paint far beyond the view', () => {
    const extent = shadowExtent(view, [[23.0, 37.0, 24.5, 39.0]], margin)!
    expect(extent.west).toBeCloseTo(view[0] - margin.dLon)
    expect(extent.north).toBeCloseTo(view[3] + margin.dLat)
  })

  it('is null when there is nothing to shade', () => {
    expect(shadowExtent(view, [], margin)).toBeNull()
  })
})

describe('extentCorners', () => {
  it('lists top-left, top-right, bottom-right, bottom-left', () => {
    expect(extentCorners(EXTENT)).toEqual([
      [23.72, 37.99],
      [23.73, 37.99],
      [23.73, 37.98],
      [23.72, 37.98],
    ])
  })
})

describe('paintShadows', () => {
  it('clears, strokes every outline, and only then fills, so fills cover the seams', () => {
    const { painter, calls } = recorder()
    paintShadows(painter, 800, 800, EXTENT, [square(23.722, 37.982), square(23.7225, 37.9825)])
    expect(calls[0]).toBe('clear')
    const drawn = calls.filter((c) => c.startsWith('stroke') || c.startsWith('fill'))
    expect(drawn).toEqual([
      `stroke:${SHADE_EDGE}`,
      `stroke:${SHADE_EDGE}`,
      `fill:${SHADE_FILL}:source-over`,
      `fill:${SHADE_FILL}:source-over`,
    ])
  })

  it('draws each ring as its own small path', () => {
    const { painter, calls, paths } = recorder()
    const rings = [square(23.722, 37.982), square(23.7225, 37.9825), square(23.726, 37.986)]
    paintShadows(painter, 800, 800, EXTENT, rings)
    // Once for the stroke and once for the fill, per ring.
    expect(calls.filter((c) => c === 'begin')).toHaveLength(rings.length * 2)
    expect(paths).toHaveLength(rings.length * 2)
    expect(paths[0]).toHaveLength(5)
  })

  it('uses one opaque colour for every fill, so overlapping shadows merge', () => {
    const { painter, calls } = recorder()
    paintShadows(painter, 800, 800, EXTENT, [square(23.722, 37.982), [...square(23.7225, 37.9825)].reverse()])
    const fills = new Set(calls.filter((c) => c.startsWith('fill')))
    expect([...fills]).toEqual([`fill:${SHADE_FILL}:source-over`])
    expect(SHADE_FILL).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('cuts the building footprints back out, so only the ground is shaded', () => {
    const { painter, calls } = recorder()
    paintShadows(painter, 800, 800, EXTENT, [square(23.722, 37.982, 0.002)], [square(23.722, 37.982)])
    const fills = calls.filter((c) => c.startsWith('fill'))
    expect(fills).toHaveLength(2)
    expect(fills[0].endsWith(':source-over')).toBe(true)
    expect(fills[1].endsWith(':destination-out')).toBe(true)
    // Later drawing is not left in erase mode.
    expect(painter.globalCompositeOperation).toBe('source-over')
  })

  it('only clears when there are no shadows (night, or zoomed out)', () => {
    const { painter, calls } = recorder()
    paintShadows(painter, 800, 800, EXTENT, [])
    expect(calls).toEqual(['clear'])
  })
})
