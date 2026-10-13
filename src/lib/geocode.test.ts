import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePhotonFeature, photonLanguage, searchPlaces, withoutRepeats, type PhotonFeature } from './geocode'

const ERMOU: PhotonFeature = {
  geometry: { coordinates: [23.7180227, 37.9778081] },
  properties: {
    osm_type: 'W',
    osm_id: 219361268,
    type: 'street',
    name: 'Ερμού',
    district: 'Πετράλωνα',
    city: 'Αθήνα',
    state: 'Αποκεντρωμένη Διοίκηση Αττικής',
    country: 'Ελλάς',
  },
}

describe('photonLanguage', () => {
  it('asks for local names when the query is typed in Greek', () => {
    expect(photonLanguage('Ερμού')).toBe('default')
    expect(photonLanguage('Πατησίων 76')).toBe('default')
    expect(photonLanguage('Athens Ερμού')).toBe('default')
  })

  it('asks for English otherwise, accents included', () => {
    expect(photonLanguage('Ermou')).toBe('en')
    expect(photonLanguage('Besançon 12')).toBe('en')
  })
})

describe('parsePhotonFeature', () => {
  it('reads a street with its neighbourhood, city and country', () => {
    expect(parsePhotonFeature(ERMOU)).toEqual({
      id: 'W219361268',
      lat: 37.9778081,
      lon: 23.7180227,
      label: 'Ερμού',
      detail: 'Πετράλωνα, Αθήνα, Ελλάς',
    })
  })

  it('names an address by its street and number', () => {
    const result = parsePhotonFeature({
      geometry: { coordinates: [23.7325, 37.9941] },
      properties: { osm_type: 'N', osm_id: 7, type: 'house', street: 'Πατησίων', housenumber: '76', city: 'Αθήνα', country: 'Ελλάς' },
    })
    expect(result?.label).toBe('Πατησίων 76')
    expect(result?.detail).toBe('Αθήνα, Ελλάς')
  })

  it('puts the address under a named building', () => {
    const result = parsePhotonFeature({
      geometry: { coordinates: [23.7325, 37.9941] },
      properties: {
        type: 'house',
        name: 'Athens University of Economics and Business',
        street: 'Patision',
        housenumber: '76',
        district: '1st District of Athens',
        city: 'Athens',
        country: 'Greece',
      },
    })
    expect(result?.detail).toBe('Patision 76, 1st District of Athens, Athens, Greece')
  })

  it('reads a city without repeating its own name', () => {
    const result = parsePhotonFeature({
      geometry: { coordinates: [22.9349, 40.6407] },
      properties: { osm_type: 'R', osm_id: 1, type: 'city', name: 'Thessaloniki', city: 'Thessaloniki', state: 'Macedonia', country: 'Greece' },
    })
    expect(result).toMatchObject({ label: 'Thessaloniki', detail: 'Greece' })
  })

  it('falls back to the region when there is no city', () => {
    const result = parsePhotonFeature({
      geometry: { coordinates: [25.4, 36.4] },
      properties: { type: 'other', name: 'Kamari Beach', state: 'Aegean', country: 'Greece' },
    })
    expect(result?.detail).toBe('Aegean, Greece')
  })

  it('skips anything without a name or a position', () => {
    expect(parsePhotonFeature({ geometry: { coordinates: [23, 37] }, properties: {} })).toBeNull()
    expect(parsePhotonFeature({ properties: { name: 'Nowhere' } })).toBeNull()
    expect(parsePhotonFeature({})).toBeNull()
  })
})

describe('withoutRepeats', () => {
  it('keeps one entry per name and area', () => {
    const first = parsePhotonFeature(ERMOU)!
    const sameStreet = { ...first, id: 'W977757278', lon: 23.7167 }
    const elsewhere = { ...first, id: 'W41822393', detail: 'Νέα Ιωνία, Ελλάς' }
    expect(withoutRepeats([first, sameStreet, elsewhere]).map((r) => r.id)).toEqual(['W219361268', 'W41822393'])
  })
})

describe('searchPlaces', () => {
  afterEach(() => vi.unstubAllGlobals())
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response

  it('asks Photon, in the query’s language and near the map', async () => {
    const fetchMock = vi.fn(async (_url: string) => json({ features: [ERMOU] }))
    vi.stubGlobal('fetch', fetchMock)
    const results = await searchPlaces('Ερμού', undefined, { lat: 37.98381, lon: 23.72752 })
    expect(results.map((r) => r.label)).toEqual(['Ερμού'])
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.host).toBe('photon.komoot.io')
    expect(url.searchParams.get('q')).toBe('Ερμού')
    expect(url.searchParams.get('lang')).toBe('default')
    expect(url.searchParams.get('lat')).toBe('37.9838')
    expect(url.searchParams.get('lon')).toBe('23.7275')
  })

  it('falls back to the city search when Photon is down', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('photon')
        ? json({}, false)
        : json({ results: [{ id: 264371, name: 'Athens', latitude: 37.98, longitude: 23.73, timezone: 'Europe/Athens', admin1: 'Attica', country: 'Greece' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const results = await searchPlaces('Athens')
    expect(results).toEqual([
      { id: '264371', lat: 37.98, lon: 23.73, label: 'Athens', detail: 'Attica, Greece', timezone: 'Europe/Athens' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not start a second search when the first was cancelled', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_url: string) => {
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchPlaces('Ath', controller.signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
