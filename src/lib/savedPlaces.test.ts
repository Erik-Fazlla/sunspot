import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  parseSavedPlaces,
  savedPlaceId,
  unsharedKeys,
  withSavedPlace,
  type SavedPlace,
} from './savedPlaces'

const place = (label: string, lat: number, lon: number, keys: string[] = []): SavedPlace => ({
  id: savedPlaceId(lat, lon),
  label,
  lat,
  lon,
  savedAt: '2026-10-13T09:00:00.000Z',
  keys,
  bytes: 2_400_000,
})

describe('savedPlaceId', () => {
  it('is the same for spots a few steps apart and different further away', () => {
    expect(savedPlaceId(37.98381, 23.72752)).toBe(savedPlaceId(37.98402, 23.7277))
    expect(savedPlaceId(37.98381, 23.72752)).not.toBe(savedPlaceId(37.99, 23.72752))
  })
})

describe('parseSavedPlaces', () => {
  it('is empty when nothing is stored', () => {
    expect(parseSavedPlaces(null)).toEqual([])
    expect(parseSavedPlaces('')).toEqual([])
  })

  it('reads back what was stored', () => {
    const list = [
      { ...place('Omonia', 37.984, 23.728, ['a', 'b']), timezone: 'Europe/Athens' },
      place('Thessaloniki', 40.641, 22.935),
    ]
    expect(parseSavedPlaces(JSON.stringify(list))).toEqual(list)
  })

  it('drops broken entries and keeps the good ones', () => {
    const stored = JSON.stringify([
      null,
      'x',
      { label: 'No position', savedAt: '2026-10-13T09:00:00.000Z' },
      { label: 'Off the map', lat: 137, lon: 23, savedAt: '2026-10-13T09:00:00.000Z' },
      { label: '', lat: 37, lon: 23, savedAt: '2026-10-13T09:00:00.000Z' },
      { label: 'No date', lat: 37, lon: 23 },
      { label: 'Good', lat: 37.5, lon: 23.5, savedAt: '2026-10-13T09:00:00.000Z', keys: ['a', 7], bytes: -3 },
    ])
    expect(parseSavedPlaces(stored)).toEqual([
      { id: '37.500,23.500', label: 'Good', lat: 37.5, lon: 23.5, savedAt: '2026-10-13T09:00:00.000Z', keys: ['a'], bytes: 0 },
    ])
  })

  it('treats anything that is not a list as empty', () => {
    expect(parseSavedPlaces('not json')).toEqual([])
    expect(parseSavedPlaces('{"label":"x"}')).toEqual([])
  })
})

describe('withSavedPlace', () => {
  it('puts the newest first and replaces an earlier save of the same spot', () => {
    const first = place('Omonia', 37.984, 23.728)
    const other = place('Thessaloniki', 40.641, 22.935)
    const again = { ...place('Omonia again', 37.984, 23.728), bytes: 1 }
    expect(withSavedPlace([first, other], again)).toEqual([again, other])
    expect(withSavedPlace([], first)).toEqual([first])
  })
})

describe('unsharedKeys', () => {
  it('only gives up the files no other saved place needs', () => {
    const removed = place('A', 37.984, 23.728, ['style', 'font', 'tile-1', 'tile-2'])
    const neighbour = place('B', 37.99, 23.74, ['style', 'font', 'tile-2', 'tile-3'])
    expect(unsharedKeys(removed, [neighbour])).toEqual(['tile-1'])
    expect(unsharedKeys(removed, [])).toEqual(['style', 'font', 'tile-1', 'tile-2'])
  })
})

describe('formatBytes', () => {
  it('writes sizes the way people read them', () => {
    expect(formatBytes(2_400_000)).toBe('2.3 MB')
    expect(formatBytes(350_000)).toBe('342 KB')
    expect(formatBytes(10)).toBe('1 KB')
  })
})
