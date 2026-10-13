import { describe, expect, it } from 'vitest'
import {
  fillTileUrl,
  fontStacks,
  GLYPH_RANGES,
  glyphUrls,
  spriteUrls,
  storeKey,
  storePolicy,
  tileAt,
  tilesForArea,
} from './offlineArea'

const ATHENS = { lat: 37.9838, lon: 23.7275 }

describe('tileAt', () => {
  it('finds the tile holding a coordinate', () => {
    // Athens sits in tile 14/9271/6320 of the standard web map tiling.
    expect(tileAt(ATHENS.lat, ATHENS.lon, 14)).toEqual({ z: 14, x: 9271, y: 6320 })
    expect(tileAt(ATHENS.lat, ATHENS.lon, 0)).toEqual({ z: 0, x: 0, y: 0 })
    expect(tileAt(ATHENS.lat, ATHENS.lon, 1)).toEqual({ z: 1, x: 1, y: 0 })
  })

  it('stays inside the tiling at the edges of the world', () => {
    expect(tileAt(89.9, 180, 3)).toEqual({ z: 3, x: 7, y: 0 })
    expect(tileAt(-89.9, -180, 3)).toEqual({ z: 3, x: 0, y: 7 })
  })
})

describe('tilesForArea', () => {
  const tiles = tilesForArea(ATHENS.lat, ATHENS.lon)

  it('includes the place’s own tile at every zoom', () => {
    for (let z = 0; z <= 14; z++) {
      const own = tileAt(ATHENS.lat, ATHENS.lon, z)
      expect(tiles).toContainEqual(own)
    }
  })

  it('covers the corners of the saved square at the deepest zoom', () => {
    // 1200 m is about 0.0108 degrees of latitude and 0.0137 of longitude here.
    for (const [dLat, dLon] of [[0.0107, 0.0136], [0.0107, -0.0136], [-0.0107, 0.0136], [-0.0107, -0.0136]]) {
      expect(tiles).toContainEqual(tileAt(ATHENS.lat + dLat, ATHENS.lon + dLon, 14))
    }
  })

  it('is a small download: a handful of tiles per zoom, never a whole city', () => {
    expect(tiles.length).toBeGreaterThanOrEqual(15)
    expect(tiles.length).toBeLessThan(60)
    expect(tiles.filter((tile) => tile.z === 14).length).toBeLessThanOrEqual(9)
    expect(new Set(tiles.map((tile) => `${tile.z}/${tile.x}/${tile.y}`)).size).toBe(tiles.length)
  })

  it('grows with the radius', () => {
    expect(tilesForArea(ATHENS.lat, ATHENS.lon, 5000).length).toBeGreaterThan(tiles.length)
  })
})

describe('file addresses', () => {
  it('fills a tile address', () => {
    expect(fillTileUrl('https://t.example/planet/v1/{z}/{x}/{y}.pbf', { z: 14, x: 9271, y: 6320 })).toBe(
      'https://t.example/planet/v1/14/9271/6320.pbf',
    )
  })

  it('lists the fonts a style uses, once each', () => {
    const style = {
      layers: [
        { layout: { 'text-font': ['Noto Sans Regular'] } },
        { layout: { 'text-font': ['Noto Sans Bold'] } },
        { layout: { 'text-font': ['Noto Sans Regular'] } },
        { layout: {} },
        {},
      ],
    }
    expect(fontStacks(style)).toEqual(['Noto Sans Bold', 'Noto Sans Regular'])
    expect(fontStacks({})).toEqual([])
  })

  it('builds one font file per font and character block, Greek included', () => {
    const urls = glyphUrls('https://t.example/fonts/{fontstack}/{range}.pbf', ['Noto Sans Regular'])
    expect(urls).toHaveLength(GLYPH_RANGES.length)
    expect(urls).toContain('https://t.example/fonts/Noto%20Sans%20Regular/768-1023.pbf')
    expect(urls[0]).toBe('https://t.example/fonts/Noto%20Sans%20Regular/0-255.pbf')
  })

  it('lists the icon sheet in both sharpness levels', () => {
    expect(spriteUrls('https://t.example/sprites/ofm')).toEqual([
      'https://t.example/sprites/ofm.json',
      'https://t.example/sprites/ofm.png',
      'https://t.example/sprites/ofm@2x.json',
      'https://t.example/sprites/ofm@2x.png',
    ])
  })
})

describe('storeKey', () => {
  it('drops the release date from a map tile address', () => {
    const a = storeKey('https://tiles.openfreemap.org/planet/20261004_113936_pt/14/9271/6320.pbf')
    const b = storeKey('https://tiles.openfreemap.org/planet/20261101_090000_pt/14/9271/6320.pbf')
    expect(a).toBe('https://tiles.openfreemap.org/planet/14/9271/6320.pbf')
    expect(b).toBe(a)
  })

  it('leaves every other address alone', () => {
    for (const url of [
      'https://tiles.openfreemap.org/planet',
      'https://tiles.openfreemap.org/styles/liberty',
      'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf',
      'https://tiles.openfreemap.org/natural_earth/ne2sr/3/4/2.png',
    ]) {
      expect(storeKey(url)).toBe(url)
    }
  })
})

describe('storePolicy', () => {
  it('serves tiles, fonts and icons from the device first', () => {
    expect(storePolicy('https://tiles.openfreemap.org/planet/20261004_113936_pt/14/9271/6320.pbf')).toBe('tile')
    expect(storePolicy('https://tiles.openfreemap.org/natural_earth/ne2sr/3/4/2.png')).toBe('tile')
    expect(storePolicy('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf')).toBe('fixed')
    expect(storePolicy('https://tiles.openfreemap.org/sprites/ofm_f384/ofm@2x.png')).toBe('fixed')
  })

  it('asks the network first for the style and the tile index', () => {
    expect(storePolicy('https://tiles.openfreemap.org/styles/liberty')).toBe('fresh')
    expect(storePolicy('https://tiles.openfreemap.org/planet')).toBe('fresh')
  })
})
