import { describe, expect, it, vi } from 'vitest'
import {
  bboxKey,
  buildOverpassQuery,
  fetchStreetFurniture,
  FURNITURE_GRID_DEG,
  FURNITURE_MAX_SPAN_DEG,
  furnitureBBox,
  LAMP_DEFAULT_HEIGHT_M,
  OVERPASS_ENDPOINTS,
  parseMetres,
  parseOverpass,
  TREE_DEFAULT_CROWN_RADIUS_M,
  TREE_DEFAULT_HEIGHT_M,
  type LonLatBox,
  type OverpassResponse,
} from './overpass'

const FIXTURE: OverpassResponse = {
  elements: [
    { type: 'node', id: 1, lat: 37.98, lon: 23.72, tags: { amenity: 'bench', backrest: 'yes' } },
    { type: 'node', id: 2, lat: 37.981, lon: 23.721, tags: { natural: 'tree' } },
    { type: 'node', id: 3, lat: 37.982, lon: 23.722, tags: { natural: 'tree', height: '14 m', diameter_crown: '8' } },
    { type: 'node', id: 4, lat: 37.983, lon: 23.723, tags: { highway: 'street_lamp' } },
    { type: 'node', id: 5, lat: 37.984, lon: 23.724, tags: { highway: 'street_lamp', height: '9.5' } },
    { type: 'node', id: 6, lat: 37.985, lon: 23.725, tags: { amenity: 'cafe' } },
    { type: 'way', id: 7, tags: { natural: 'tree' } },
    { type: 'node', id: 8, lat: 37.986, lon: 23.726, tags: { natural: 'tree', height: '800', diameter_crown: 'big' } },
  ],
}

describe('parseMetres', () => {
  it('reads plain and metre-suffixed numbers', () => {
    expect(parseMetres('8')).toBe(8)
    expect(parseMetres('8.5 m')).toBe(8.5)
    expect(parseMetres('12m')).toBe(12)
    expect(parseMetres('7,5')).toBe(7.5)
  })

  it('rejects anything it cannot be sure about', () => {
    expect(parseMetres(undefined)).toBeNull()
    expect(parseMetres('tall')).toBeNull()
    expect(parseMetres("26'")).toBeNull()
    expect(parseMetres('5-8')).toBeNull()
    expect(parseMetres('0')).toBeNull()
  })
})

describe('parseOverpass', () => {
  const furniture = parseOverpass(FIXTURE)

  it('sorts nodes into benches, trees and lamps and ignores everything else', () => {
    expect(furniture.benches.map((b) => b.id)).toEqual([1])
    expect(furniture.trees.map((t) => t.id)).toEqual([2, 3, 8])
    expect(furniture.lamps.map((l) => l.id)).toEqual([4, 5])
  })

  it('uses 8 m and a 3 m canopy radius for an untagged tree', () => {
    expect(furniture.trees[0]).toEqual({
      id: 2,
      lon: 23.721,
      lat: 37.981,
      height: TREE_DEFAULT_HEIGHT_M,
      crownRadius: TREE_DEFAULT_CROWN_RADIUS_M,
    })
  })

  it('reads height and halves diameter_crown into a radius', () => {
    expect(furniture.trees[1]).toMatchObject({ height: 14, crownRadius: 4 })
  })

  it('clamps absurd sizes and falls back on unreadable ones', () => {
    expect(furniture.trees[2]).toMatchObject({ height: 40, crownRadius: TREE_DEFAULT_CROWN_RADIUS_M })
  })

  it('gives lamps a default or tagged height', () => {
    expect(furniture.lamps[0].height).toBe(LAMP_DEFAULT_HEIGHT_M)
    expect(furniture.lamps[1].height).toBe(9.5)
  })

  it('copes with an empty response', () => {
    expect(parseOverpass({})).toEqual({ benches: [], trees: [], lamps: [] })
  })
})

describe('furnitureBBox', () => {
  const center: [number, number] = [23.7275, 37.9838]

  it('snaps a small view outward to the grid', () => {
    const [west, south, east, north] = furnitureBBox([23.7251, 37.9821, 23.7299, 37.9853], center)
    expect(west).toBeCloseTo(23.724)
    expect(south).toBeCloseTo(37.98)
    expect(east).toBeCloseTo(23.732)
    expect(north).toBeCloseTo(37.988)
  })

  it('caps a huge pitched view to the neighbourhood around the centre', () => {
    const box = furnitureBBox([23.6, 37.9, 23.9, 38.2], center)
    expect(box[2] - box[0]).toBeLessThanOrEqual(FURNITURE_MAX_SPAN_DEG + 2 * FURNITURE_GRID_DEG + 1e-9)
    expect(box[3] - box[1]).toBeLessThanOrEqual(FURNITURE_MAX_SPAN_DEG + 2 * FURNITURE_GRID_DEG + 1e-9)
    expect(box[0]).toBeLessThan(center[0])
    expect(box[2]).toBeGreaterThan(center[0])
  })

  it('gives the same box, and so the same cache key, for a small pan', () => {
    const a = furnitureBBox([23.7251, 37.9821, 23.7299, 37.9853], center)
    const b = furnitureBBox([23.7254, 37.9823, 23.7302, 37.9855], [23.7278, 37.984])
    expect(bboxKey(a)).toBe(bboxKey(b))
  })
})

describe('buildOverpassQuery', () => {
  it('asks for the three kinds of node in south, west, north, east order with limits', () => {
    const query = buildOverpassQuery([23.724, 37.98, 23.732, 37.988])
    expect(query).toContain('[out:json][timeout:10]')
    expect(query).toContain('node["amenity"="bench"](37.98,23.724,37.988,23.732)')
    expect(query).toContain('node["natural"="tree"](37.98,23.724,37.988,23.732)')
    expect(query).toContain('node["highway"="street_lamp"](37.98,23.724,37.988,23.732)')
    expect(query).toMatch(/out body qt \d+;$/)
  })
})

describe('fetchStreetFurniture', () => {
  const ok = () => new Response(JSON.stringify(FIXTURE), { status: 200 })
  // Each test uses its own box so the module cache cannot leak between them.
  let boxCount = 0
  const freshBox = (): LonLatBox => {
    boxCount += 1
    return [10 + boxCount, 50, 10.008 + boxCount, 50.008]
  }

  it('asks the first server and caches the answer by box', async () => {
    const fetchMock = vi.fn(async (_url: string) => ok())
    const box = freshBox()
    const first = await fetchStreetFurniture(box, fetchMock)
    const second = await fetchStreetFurniture(box, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0].startsWith(OVERPASS_ENDPOINTS[0])).toBe(true)
    expect(second).toBe(first)
    expect(first.trees).toHaveLength(3)
  })

  it('falls back to the mirror when the first server fails', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(OVERPASS_ENDPOINTS[0]) ? new Response('busy', { status: 504 }) : ok(),
    )
    const furniture = await fetchStreetFurniture(freshBox(), fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0].startsWith(OVERPASS_ENDPOINTS[1])).toBe(true)
    expect(furniture.benches).toHaveLength(1)
  })

  it('falls back when the first server is unreachable or sends rubbish', async () => {
    const unreachable = vi.fn(async (url: string) => {
      if (url.startsWith(OVERPASS_ENDPOINTS[0])) throw new TypeError('Failed to fetch')
      return ok()
    })
    await expect(fetchStreetFurniture(freshBox(), unreachable)).resolves.toBeDefined()
    const rubbish = vi.fn(async (url: string) =>
      url.startsWith(OVERPASS_ENDPOINTS[0]) ? new Response('<html>rate limited</html>', { status: 200 }) : ok(),
    )
    await expect(fetchStreetFurniture(freshBox(), rubbish)).resolves.toBeDefined()
    expect(rubbish).toHaveBeenCalledTimes(2)
  })

  it('tries each server once, then gives up without caching the failure', async () => {
    const down = vi.fn(async (_url: string) => new Response('busy', { status: 429 }))
    const box = freshBox()
    await expect(fetchStreetFurniture(box, down)).rejects.toThrow('429')
    expect(down).toHaveBeenCalledTimes(OVERPASS_ENDPOINTS.length)
    const up = vi.fn(async (_url: string) => ok())
    await expect(fetchStreetFurniture(box, up)).resolves.toBeDefined()
    expect(up).toHaveBeenCalledTimes(1)
  })
})
